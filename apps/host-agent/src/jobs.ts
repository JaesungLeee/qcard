import type { QcardApi } from '@qcard/data';
import { ClaudeCodeSetupError, PlanLimitError, UsageMeter, withUsage, type LlmClient } from '@qcard/llm';
import { generateQaDoc } from '@qcard/qadoc';
import type { Host, Job, JobErrorKind, QADocument, QaDocJob, SpecBundle } from '@qcard/shared';
import { readBundle, type SpecBundle as ParsedBundle } from '@qcard/spec';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { getBytes, ref, type FirebaseStorage } from 'firebase/storage';

/*
 * 호스트 에이전트의 작업 처리 (PRD §5.2, §6.2): 웹에서 요청한 "QA 문서 생성"을 요청자 본인의 PC에서,
 * 본인 Claude Code(플랜)로 만든다. 로그인한 사용자 권한으로 Firestore·Storage에 쓰므로 보안 규칙을 그대로 따른다.
 *
 *   pendingJobs → claimJob(대기 → 생성 중, 트랜잭션) → processJob(스펙 읽기 → 생성 → 저장 → 완료)
 * 플랜 한도·Claude Code 문제면 "일시정지"로 남기고, 웹에서 다시 시도하면 같은 호스트가 이어서 한다
 * (작업마다 호출을 녹화해 두므로 끝난 호출은 다시 부르지 않는다 — cli의 llmFor).
 */

export type JobDeps = {
  db: Firestore;
  storage: FirebaseStorage;
  /** 로그인한 사용자로 만든 웹 API (이전 QA 문서·준비 플로우 읽기) */
  api: QcardApi;
  uid: string;
  /** 처리하는 호스트 이름 (웹에 보인다) */
  host: string;
  /** 작업용 LLM. 작업마다 녹화 폴더를 따로 둔다 */
  llmFor: (job: QaDocJob) => LlmClient;
  now?: () => string;
  log?: (line: string) => void;
};

const jobRef = (db: Firestore, j: Pick<Job, 'projectId' | 'id'>) => doc(db, 'projects', j.projectId, 'jobs', j.id);
/** Firestore는 undefined를 저장하지 못한다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 내가 요청한 대기 작업 (오래된 것 먼저). 다른 사람의 작업은 규칙상 보이지도 않는다 */
export async function pendingJobs(db: Firestore, uid: string): Promise<Job[]> {
  const snap = await getDocs(query(collectionGroup(db, 'jobs'), where('requestedBy', '==', uid)));
  return snap.docs
    .map((d) => d.data() as Job)
    .filter((j) => j.status === 'queued')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** 대기 → 생성 중. 다른 호스트(같은 사용자의 다른 PC)가 먼저 가져갔으면 undefined */
export async function claimJob<J extends Job>(db: Firestore, job: J, host: string, now: string): Promise<J | undefined> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(jobRef(db, job));
    const current = snap.data() as J | undefined;
    if (!current || current.status !== 'queued') return undefined;
    const next = {
      ...current,
      status: 'running',
      host,
      startedAt: current.startedAt ?? now,
      progress: { phase: 'plan', done: 0, total: 0 },
    } as J;
    tx.set(jobRef(db, job), clean(next));
    return next;
  });
}

async function loadBundle(db: Firestore, storage: FirebaseStorage, projectId: string, id: string) {
  const snap = await getDoc(doc(db, 'projects', projectId, 'specBundles', id));
  if (!snap.exists()) return undefined;
  const meta = snap.data() as SpecBundle;
  const files = await Promise.all(
    meta.specs.map(async (s) => ({
      path: `${s.name}/spec.md`,
      content: new TextDecoder().decode(await getBytes(ref(storage, s.path))),
    })),
  );
  return { meta, parsed: readBundle(files) };
}

/** 같은 앱 버전 문서가 이미 있으면 뒤에 작업 id를 붙인다 */
async function docIdFor(db: Firestore, job: QaDocJob): Promise<string> {
  const base = `doc-${job.input.appVersion.replace(/[^\w.-]+/g, '-')}`;
  const taken = (await getDoc(doc(db, 'projects', job.projectId, 'qaDocs', base))).exists();
  return taken ? `${base}-${job.id.slice(0, 6)}` : base;
}

const errorKind = (e: unknown): JobErrorKind | undefined =>
  e instanceof PlanLimitError
    ? 'plan_limit'
    : e instanceof ClaudeCodeSetupError
      ? e.reason === 'outdated'
        ? 'claude_outdated'
        : 'not_logged_in'
      : undefined;

/** 생성 중인 작업 하나를 끝까지 처리한다. 결과 작업 상태를 돌려준다 (완료·일시정지·실패) */
export async function processJob(deps: JobDeps, job: QaDocJob): Promise<Job> {
  const { db, storage, api } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const r = jobRef(db, job);
  const meter = new UsageMeter();
  try {
    const bundle = await loadBundle(db, storage, job.projectId, job.input.bundleId);
    if (!bundle) throw new Error(`스펙 묶음이 없습니다: ${job.input.bundleId}`);
    const prev: QADocument | undefined = job.input.prevDocId
      ? await api.getQaDoc({ projectId: job.projectId, docId: job.input.prevDocId })
      : undefined;
    const prevBundle: ParsedBundle | undefined = prev
      ? (await loadBundle(db, storage, job.projectId, prev.specBundleId))?.parsed
      : undefined;
    const prepFlows = await api.listPrepFlows(job.projectId);
    const docId = await docIdFor(db, job);
    log(`${job.input.appVersion}: 스펙 ${bundle.parsed.specs.length}개${prev ? ` · 이전 ${prev.appVersion}` : ''}`);

    // 진행률은 스펙 계획(바뀐 스펙 수) → 케이스 변환(행 수) 순서로 보인다
    const result = await generateQaDoc({
      bundle: bundle.parsed,
      prev,
      prevBundle,
      prepFlows,
      llm: withUsage(deps.llmFor(job), meter),
      meta: {
        id: docId,
        projectId: job.projectId,
        appVersion: job.input.appVersion,
        specBundleId: job.input.bundleId,
        createdAt: now(),
        ...(prev ? { prevDocId: prev.id } : {}),
      },
      onProgress: (e) => {
        const progress =
          e.kind === 'plan'
            ? { phase: 'plan' as const, done: e.index, total: e.total, spec: e.spec }
            : { phase: 'cases' as const, done: e.done, total: e.total, spec: e.spec };
        log(`  ${progress.phase} ${progress.done}/${progress.total} ${progress.spec}`);
        void updateDoc(r, { progress }).catch(() => {});
      },
    });

    // 저장: 문서 → 케이스(순서 _i) → 새 준비 플로우. 한 번에 500개까지라 나눠 쓴다
    await updateDoc(r, { progress: { phase: 'save', done: 0, total: result.doc.cases.length } });
    const { cases, ...meta } = result.doc;
    const base = ['projects', job.projectId, 'qaDocs', docId] as const;
    const writes: [ReturnType<typeof doc>, unknown][] = [
      ...cases.map((c, i) => [doc(db, ...base, 'cases', c.tcId), { ...c, _i: i }] as [ReturnType<typeof doc>, unknown]),
      ...result.prepFlows.map(
        (f, i) =>
          [doc(db, 'projects', job.projectId, 'prepFlows', f.id), { ...f, _i: prepFlows.length + i }] as [
            ReturnType<typeof doc>,
            unknown,
          ],
      ),
    ];
    for (let i = 0; i < writes.length; i += 450) {
      const batch = writeBatch(db);
      for (const [d, data] of writes.slice(i, i + 450)) batch.set(d, clean(data) as Record<string, unknown>);
      await batch.commit();
    }
    // 문서 머리는 마지막에 쓴다 — 목록에 보이는 순간 케이스가 다 있다
    await setDoc(doc(db, ...base), clean(meta));

    const done: QaDocJob = {
      ...job,
      status: 'done',
      finishedAt: now(),
      progress: { phase: 'save', done: cases.length, total: cases.length },
      result: {
        docId,
        cases: cases.length,
        generated: cases.filter((c) => c.change === 'new' || c.change === 'changed').length,
        questions: result.doc.questions.filter((q) => q.status === 'open').length,
        newPrepFlows: result.prepFlows.length,
        tokens: meter.run.tokens,
        costUsd: meter.run.costUsd,
      },
    };
    await setDoc(r, clean(done));
    log(`완료: ${docId} · 케이스 ${cases.length} · 토큰 ${meter.run.tokens.toLocaleString()}`);
    return done;
  } catch (e) {
    const kind = errorKind(e);
    const message = (e as Error).message ?? String(e);
    const latest = ((await getDoc(r)).data() as QaDocJob | undefined) ?? job;
    const next: QaDocJob = {
      ...latest,
      status: kind ? 'paused' : 'failed',
      finishedAt: now(),
      error: { kind: kind ?? 'failed', message },
    };
    await setDoc(r, clean(next));
    log(`${kind ? '일시정지' : '실패'}: ${message}`);
    return next;
  }
}

/** 호스트 연결 신호 (웹의 "호스트 연결됨" 표시, F-DB-09) */
export async function heartbeat(db: Firestore, uid: string, host: Host): Promise<void> {
  await setDoc(doc(collection(db, 'users', uid, 'hosts'), host.id), clean(host));
}
