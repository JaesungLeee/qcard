import type { QcardApi } from '@qcard/data';
import { ClaudeCodeSetupError, PlanLimitError, UsageMeter, withUsage, type LlmClient } from '@qcard/llm';
import { generateQaDoc, reviseCase, type GenerateProgress } from '@qcard/qadoc';
import { draftIssue } from '@qcard/reporter';
import {
  hash,
  ISSUE_DRAFTS,
  type Build,
  type CaseReviseJob,
  type Defect,
  type IssueDraftJob,
  type TestCase,
  type TestCycle,
  type Host,
  type Job,
  type JobErrorKind,
  type QADocument,
  type QaDocJob,
  type QaDocJobEvent,
  type RunCycleJob,
  type SpecBundle,
} from '@qcard/shared';
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
import { CLAUDE_SETUP_REASON } from './runCycle';

/*
 * 호스트 에이전트의 작업 처리 (docs/product/qa-doc.md, docs/architecture.md): 웹에서 요청한 "QA 문서 생성"·"케이스 수정안"을
 * 요청자 본인의 PC에서, 본인 Claude Code(플랜)로 만든다. 로그인한 사용자 권한으로 Firestore·Storage에 쓰므로 보안 규칙을 그대로 따른다.
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
  llmFor: (job: QaDocJob | CaseReviseJob | IssueDraftJob) => LlmClient;
  now?: () => string;
  log?: (line: string) => void;
};

/** 이 호스트가 처리하는 작업 종류. 연결 신호에 실어 보내 웹이 옛 호스트를 알아본다 (Host.jobs) */
export const HOST_JOBS: Job['kind'][] = ['qa_doc_generate', 'run_cycle', 'case_revise', 'issue_draft'];

const jobRef = (db: Firestore, j: Pick<Job, 'projectId' | 'id' | 'kind'>) =>
  doc(db, 'projects', j.projectId, j.kind === 'issue_draft' ? ISSUE_DRAFTS : 'jobs', j.id);
/** Firestore는 undefined를 저장하지 못한다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * 내가 요청한 대기 작업. 케이스 수정안(짧다)을 QA 문서 생성(길다)보다 먼저, 그 안에서는 오래된 것 먼저.
 * 다른 사람의 작업은 규칙상 보이지도 않는다
 */
export async function pendingJobs(db: Firestore, uid: string): Promise<Job[]> {
  const snap = await getDocs(query(collectionGroup(db, 'jobs'), where('requestedBy', '==', uid)));
  const rank = (j: Job) => (j.kind === 'case_revise' ? 0 : 1);
  return snap.docs
    .map((d) => d.data() as Job)
    .filter((j) => j.status === 'queued')
    .sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? -1 : 1));
}

/** 내 이슈 초안 대기열 (작업과 따로 둔다 — `ISSUE_DRAFTS`). 오래된 것부터 */
export async function pendingDrafts(db: Firestore, uid: string): Promise<IssueDraftJob[]> {
  const snap = await getDocs(query(collectionGroup(db, ISSUE_DRAFTS), where('requestedBy', '==', uid)));
  return snap.docs
    .map((d) => d.data() as IssueDraftJob)
    .filter((j) => j.status === 'queued')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** 대기 → 생성 중. 다른 호스트(같은 사용자의 다른 PC)가 먼저 가져갔으면 undefined */
export async function claimJob<J extends Job>(
  db: Firestore,
  job: J,
  host: string,
  now: string,
): Promise<J | undefined> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(jobRef(db, job));
    const current = snap.data() as J | undefined;
    if (!current || current.status !== 'queued') return undefined;
    const next = {
      ...current,
      status: 'running',
      host,
      startedAt: current.startedAt ?? now,
      ...(current.kind === 'qa_doc_generate' ? { progress: { phase: 'plan', done: 0, total: 0 } } : {}),
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
      ? CLAUDE_SETUP_REASON[e.reason]
      : undefined;

/** 생성 중인 작업 하나를 끝까지 처리한다. 결과 작업 상태를 돌려준다 (완료·일시정지·실패) */
export async function processJob(deps: JobDeps, job: QaDocJob): Promise<Job> {
  const { db, storage, api } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const r = jobRef(db, job);
  const meter = new UsageMeter();
  let rec: ProgressRecorder | undefined;
  try {
    const bundle = await loadBundle(db, storage, job.projectId, job.input.bundleId);
    if (!bundle) throw new Error(`스펙 묶음이 없습니다: ${job.input.bundleId}`);
    const prev: QADocument | undefined = job.input.prevDocId
      ? await api.getQaDoc({ projectId: job.projectId, docId: job.input.prevDocId })
      : undefined;
    const prevBundle: ParsedBundle | undefined = prev
      ? (await loadBundle(db, storage, job.projectId, prev.specBundleId))?.parsed
      : undefined;
    // 이전 버전의 준비 플로우를 이어받는다. 첫 버전은 빈 목록에서 시작
    const prepFlows = prev ? await api.listPrepFlows({ projectId: job.projectId, docId: prev.id }) : [];
    const docId = await docIdFor(db, job);
    log(`${job.input.appVersion}: 스펙 ${bundle.parsed.specs.length}개${prev ? ` · 이전 ${prev.appVersion}` : ''}`);

    // 진행률은 스펙 계획(바뀐 스펙 수) → 케이스 변환(행 수) 순서로 보인다. 계획·초안·기록은 작업 상세 화면용
    const recorder = await progressRecorder(db, job, now, meter, prev);
    rec = recorder;
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
        recorder.on(e);
        if (e.kind === 'plan') log(`  plan ${e.index}/${e.total} ${e.spec}`);
        if (e.kind === 'batch') log(`  cases ${e.done}/${e.total} ${e.spec}`);
      },
    });

    // 저장: 케이스(순서 _i) → 이 버전의 준비 플로우 → 문서 머리. 한 번에 500개까지라 나눠 쓴다
    recorder.progress({ phase: 'save', done: 0, total: result.doc.cases.length, active: [] });
    await recorder.flush();
    const { cases, ...meta } = result.doc;
    const base = ['projects', job.projectId, 'qaDocs', docId] as const;
    const writes: [ReturnType<typeof doc>, unknown][] = [
      ...cases.map((c, i) => [doc(db, ...base, 'cases', c.tcId), { ...c, _i: i }] as [ReturnType<typeof doc>, unknown]),
      ...result.prepFlows.map(
        (f, i) => [doc(db, ...base, 'prepFlows', f.id), { ...f, _i: i }] as [ReturnType<typeof doc>, unknown],
      ),
    ];
    for (let i = 0; i < writes.length; i += 450) {
      const batch = writeBatch(db);
      for (const [d, data] of writes.slice(i, i + 450)) batch.set(d, clean(data) as Record<string, unknown>);
      await batch.commit();
    }
    // 문서 머리는 마지막에 쓴다 — 목록에 보이는 순간 케이스가 다 있다
    await setDoc(doc(db, ...base), clean(meta));

    const questions = result.doc.questions.filter((q) => q.status === 'open').length;
    recorder.event(
      'done',
      'done',
      `케이스 ${cases.length}개 · 확인 질문 ${questions}개 · 새 준비 플로우 ${result.newPrepFlows.length}개 → QA 문서 ${job.input.appVersion}`,
    );
    await recorder.flush();
    const latest = (await getDoc(r)).data() as QaDocJob | undefined;
    const done: QaDocJob = {
      ...job,
      ...(latest?.plan ? { plan: latest.plan } : {}),
      status: 'done',
      finishedAt: now(),
      progress: { ...recorder.current(), phase: 'save', done: cases.length, total: cases.length },
      result: {
        docId,
        cases: cases.length,
        generated: cases.filter((c) => c.change === 'new' || c.change === 'changed').length,
        questions,
        newPrepFlows: result.newPrepFlows.length,
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
    if (rec) {
      rec.progress({ active: [] });
      rec.stop(`${kind ? '일시정지' : '실패'} · ${message}`);
      await rec.flush();
    }
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

/**
 * 케이스 수정안 작업 하나를 처리한다: 케이스·답변된 질문·출처 스펙 행으로 수정안을 만들어 작업 결과에 쓴다.
 * 케이스는 바꾸지 않는다 — 요청자가 웹에서 보고 적용한다
 */
export async function processReviseJob(deps: JobDeps, job: CaseReviseJob): Promise<Job> {
  const { db, storage, api } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const r = jobRef(db, job);
  const meter = new UsageMeter();
  try {
    const d = await api.getQaDoc({ projectId: job.projectId, docId: job.input.docId });
    const current = d.cases.find((c) => c.tcId === job.input.tcId);
    if (!current) throw new Error(`케이스가 문서에 없습니다: ${job.input.tcId}`);
    const bundle = await loadBundle(db, storage, job.projectId, d.specBundleId);
    const spec = bundle?.parsed.specs.find((s) => s.name === current.sourceRef.spec);
    if (!spec) throw new Error(`출처 스펙을 찾지 못했습니다: ${current.sourceRef.spec}`);
    const out = await reviseCase({
      current,
      spec,
      questions: d.questions.filter((q) => job.input.questionIds.includes(q.id)),
      prepFlows: await api.listPrepFlows({ projectId: job.projectId, docId: d.id }),
      llm: withUsage(deps.llmFor(job), meter),
    });
    const usage = { tokens: meter.run.tokens, costUsd: meter.run.costUsd };
    const done: CaseReviseJob = {
      ...job,
      status: 'done',
      finishedAt: now(),
      result: { ...out, ...usage },
    };
    await setDoc(r, clean(done));
    log(
      `수정안 ${job.input.tcId}: ${out.kind === 'revise' ? '수정안' : '수정 불필요'} · 토큰 ${usage.tokens.toLocaleString()}`,
    );
    return done;
  } catch (e) {
    const kind = errorKind(e);
    const message = (e as Error).message ?? String(e);
    const next: CaseReviseJob = {
      ...job,
      status: kind ? 'paused' : 'failed',
      finishedAt: now(),
      error: { kind: kind ?? 'failed', message },
    };
    await setDoc(r, clean(next));
    log(`${kind ? '일시정지' : '실패'}: ${message}`);
    return next;
  }
}

/**
 * 이슈 초안 작업 하나를 처리한다 (docs/product/issues.md#초안): 결함·케이스 사본·빌드·대상 디바이스 텍스트와
 * 웹이 넘긴 템플릿으로 초안을 만들어 작업 결과에 쓴다. 스크린샷·화면 구조는 읽지도 넘기지도 않는다
 */
/** 맡은 작업을 시작하지 못하고 실패로 남긴다 (웹에서 이유를 보고 다시 요청한다) */
export async function failJob<J extends Job>(db: Firestore, job: J, message: string, now: string): Promise<J> {
  const next = { ...job, status: 'failed', finishedAt: now, error: { kind: 'failed', message } } as J;
  await setDoc(jobRef(db, job), clean(next));
  return next;
}

export async function processDraftJob(deps: JobDeps, job: IssueDraftJob): Promise<Job> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const r = jobRef(db, job);
  const meter = new UsageMeter();
  const { cycleId, defectId, template } = job.input;
  try {
    const at = (...path: string[]) => getDoc(doc(db, 'projects', job.projectId, ...path));
    const defect = (await at('cycles', cycleId, 'defects', defectId)).data() as Defect | undefined;
    const cycle = (await at('cycles', cycleId)).data() as TestCycle | undefined;
    if (!defect || !cycle) throw new Error(`결함을 찾지 못했습니다: ${cycleId}/${defectId}`);
    const testCase = (await at('cycles', cycleId, 'cases', defect.tcId)).data() as TestCase | undefined;
    const build = (await at('builds', cycle.buildId)).data() as Build | undefined;
    const target = cycle.targets.find((t) => t.id === defect.deviceId);
    const draft = await draftIssue({
      facts: {
        defect,
        ...(testCase ? { case: testCase } : {}),
        device: { label: target?.label ?? defect.deviceId, ...(defect.osBuild ? { osBuild: defect.osBuild } : {}) },
        app: { version: build?.version ?? '(알 수 없음)', ...(build ? { buildNumber: build.buildNumber } : {}) },
        cycleName: cycle.name,
      },
      template,
      llm: withUsage(deps.llmFor(job), meter),
    });
    const done: IssueDraftJob = {
      ...job,
      status: 'done',
      finishedAt: now(),
      result: { ...draft, tokens: meter.run.tokens, costUsd: meter.run.costUsd },
    };
    await setDoc(r, clean(done));
    log(`이슈 초안 ${defectId}: 빈 칸 ${draft.empty.length} · 토큰 ${meter.run.tokens.toLocaleString()}`);
    return done;
  } catch (e) {
    const kind = errorKind(e);
    const message = (e as Error).message ?? String(e);
    const next: IssueDraftJob = {
      ...job,
      status: kind ? 'paused' : 'failed',
      finishedAt: now(),
      error: { kind: kind ?? 'failed', message },
    };
    await setDoc(r, clean(next));
    log(`${kind ? '일시정지' : '실패'}: ${message}`);
    return next;
  }
}

type Progress = NonNullable<QaDocJob['progress']>;
type ProgressRecorder = Awaited<ReturnType<typeof progressRecorder>>;

/**
 * 생성 진행을 작업 문서와 하위 컬렉션(specs·drafts·events)에 쓴다 (작업 상세 화면).
 * 생성기 이벤트는 몰려 오므로 쓰기를 한 줄로 세운다 — 진행률이 뒤로 가지 않게. 쓰기 실패는 생성을 멈추지 않는다.
 * 기록 id가 정해져 있어, 다시 시도해 녹화에서 건너뛴 호출이 같은 기록을 또 남기지 않는다
 */
async function progressRecorder(
  db: Firestore,
  job: QaDocJob,
  now: () => string,
  meter: UsageMeter,
  prev: QADocument | undefined,
) {
  const r = jobRef(db, job);
  const seen = new Set((await getDocs(collection(r, 'events'))).docs.map((d) => d.id));
  let chain: Promise<void> = Promise.resolve();
  const write = (fn: () => Promise<unknown>) => {
    chain = chain.then(fn).then(
      () => {},
      () => {},
    );
  };
  const event = (id: string, kind: QaDocJobEvent['kind'], text: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const e: QaDocJobEvent = { id, at: now(), kind, text };
    write(() => setDoc(doc(r, 'events', id), e));
  };
  const at = now();
  let state: Progress = { ...job.progress, phase: 'plan', done: 0, total: 0, phaseStartedAt: at, updatedAt: at };
  const progress = (p: Partial<Progress>) => {
    const t = now();
    const phaseStartedAt = p.phase && p.phase !== state.phase ? t : state.phaseStartedAt;
    state = { ...state, ...p, phaseStartedAt, updatedAt: t, tokens: meter.run.tokens };
    const snapshot = clean(state);
    write(() => updateDoc(r, { progress: snapshot }));
  };
  const active = new Set<string>();
  const drafted: Record<string, number> = {};
  let targets = 0;

  if (seen.has('start')) event(`restart-${seen.size}`, 'start', '다시 시작 — 끝난 호출은 녹화에서 건너뜁니다');

  const on = (e: GenerateProgress) => {
    switch (e.kind) {
      case 'match': {
        const specs = e.specs.map((s) => ({
          name: s.spec,
          title: s.title,
          new: s.rows.filter((x) => x.change === 'new').length,
          changed: s.rows.filter((x) => x.change === 'changed').length,
          same: s.rows.filter((x) => x.change === 'same').length,
        }));
        targets = specs.reduce((n, s) => n + s.new + s.changed, 0);
        const same = specs.reduce((n, s) => n + s.same, 0);
        write(async () => {
          const batch = writeBatch(db);
          for (const s of e.specs) batch.set(doc(r, 'specs', s.spec), clean(s));
          batch.update(r, { plan: { specs, removed: e.removed } });
          await batch.commit();
        });
        event(
          'start',
          'start',
          `스펙 ${specs.length}개${prev ? ` · 이전 문서 ${prev.appVersion}` : ''} · 만들 행 ${targets}개` +
            (same ? `, 동일 ${same}개는 이전 케이스를 씁니다` : ''),
        );
        return;
      }
      case 'plan':
        return progress({ phase: 'plan', done: e.index, total: e.total, spec: e.spec });
      case 'planned':
        event(`plan-${e.spec}`, 'plan', `${e.spec} 계획 · 보강 제안 ${e.suggestions}개`);
        if (e.prepFlows.length)
          event(
            `prep-${e.spec}`,
            'prep_flow',
            `새로 만듦: ${e.prepFlows.map((f) => `${f.id} (${f.name})`).join(', ')}`,
          );
        return progress({ done: e.index + 1 });
      case 'batch_start':
        for (const s of e.sources) active.add(s);
        return progress({
          phase: 'cases',
          ...(state.phase === 'cases' ? {} : { done: 0, total: targets }),
          spec: e.spec,
          active: [...active],
        });
      case 'batch': {
        for (const s of e.sources) active.delete(s);
        drafted[e.spec] = (drafted[e.spec] ?? 0) + e.drafts.length;
        const at = now();
        write(async () => {
          const batch = writeBatch(db);
          for (const d of e.drafts) batch.set(doc(r, 'drafts', `${d.spec}~${d.rowId}`), clean({ ...d, at }));
          await batch.commit();
        });
        const range = e.rows.length > 1 ? `${e.rows[0]}~${e.rows.at(-1)}` : e.rows[0];
        event(`cases-${e.spec}-${e.rows[0]}`, 'cases', `${e.spec} ${range} 초안 ${e.drafts.length}개`);
        for (const d of e.drafts)
          if (d.questions.length)
            event(`q-${d.spec}-${d.rowId}`, 'question', `${d.spec}/${d.rowId}: ${d.questions.join(' / ')}`);
        return progress({
          phase: 'cases',
          done: e.done,
          total: e.total,
          spec: e.spec,
          active: [...active],
          drafted: { ...drafted },
        });
      }
      case 'warning':
        return event(`warn-${hash(e.text)}`, 'warning', e.text);
    }
  };

  return {
    on,
    progress,
    event,
    stop: (text: string) => event(`stop-${seen.size}`, 'stop', text),
    current: () => state,
    flush: () => chain,
  };
}

/**
 * Run 시작 요청 작업의 결과를 남긴다: 시작했으면 완료(runId), 못 했으면 실패(이유는 웹에 그대로 보인다).
 * Run 진행은 Run 문서로 본다 — 이 작업은 시작까지만이다
 */
export async function finishRunJob(
  db: Firestore,
  job: RunCycleJob,
  outcome: { runId: string } | { error: string },
  now: string,
): Promise<RunCycleJob> {
  const next: RunCycleJob =
    'runId' in outcome
      ? { ...job, status: 'done', finishedAt: now, result: { runId: outcome.runId } }
      : { ...job, status: 'failed', finishedAt: now, error: { kind: 'failed', message: outcome.error } };
  await setDoc(jobRef(db, job), clean(next));
  return next;
}

/**
 * 내가 웹에서 요청한 Run 시작 작업을 차례로 받아 시작한다 (QA 문서 생성과 따로 — 생성 중이어도 기다리지 않는다).
 * start는 로컬 콘솔의 [실행]과 같은 경로(ConsoleService.startRun)
 */
export async function startRunJobs(deps: {
  db: Firestore;
  uid: string;
  host: string;
  start: (req: {
    projectId: string;
    cycleId: string;
    tcIds?: string[];
    resumeRunId?: string;
  }) => Promise<{ runId: string } | { error: string }>;
  now?: () => string;
  log?: (line: string) => void;
}): Promise<RunCycleJob[]> {
  const now = deps.now ?? (() => new Date().toISOString());
  const out: RunCycleJob[] = [];
  for (const job of await pendingJobs(deps.db, deps.uid)) {
    if (job.kind !== 'run_cycle') continue;
    const claimed = await claimJob(deps.db, job, deps.host, now());
    if (!claimed) continue;
    deps.log?.(`■ ${job.projectId} · 웹에서 Run 시작 요청 (${job.input.cycleId}, ${job.requestedByName})`);
    const { cycleId, tcIds, resumeRunId } = claimed.input;
    const outcome = await deps.start({
      projectId: claimed.projectId,
      cycleId,
      ...(tcIds ? { tcIds } : {}),
      ...(resumeRunId ? { resumeRunId } : {}),
    });
    out.push(await finishRunJob(deps.db, claimed, outcome, now()));
  }
  return out;
}

/** 호스트 연결 신호 (웹의 "호스트 연결됨" 표시) */
export async function heartbeat(db: Firestore, uid: string, host: Host): Promise<void> {
  await setDoc(doc(collection(db, 'users', uid, 'hosts'), host.id), clean(host));
}
