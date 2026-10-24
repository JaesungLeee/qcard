import { createFixtureDb, type ConsoleSession } from '@qcard/fixtures';
import type {
  Build,
  CaseResult,
  Defect,
  Host,
  HostConnection,
  HostCredential,
  Invitation,
  Job,
  Member,
  PrepFlow,
  Project,
  QADocument,
  QaDocJobDraft,
  QaDocJobEvent,
  QaDocJobSpec,
  Run,
  TestCase,
  TestCycle,
  VerdictChange,
} from '@qcard/shared';
import { ApkError, inspectApk } from '@qcard/apk';
import { FirebaseError } from 'firebase/app';
import {
  collection,
  collectionGroup,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  type Timestamp,
  type QueryDocumentSnapshot,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes, uploadString, type FirebaseStorage } from 'firebase/storage';
import {
  ConflictError,
  NotFoundError,
  PermissionError,
  RuleError,
  type CycleDetail,
  type InvitationView,
  type ProjectSummary,
  type QcardApi,
} from './api';
import {
  approvalFor,
  confirmedResult,
  cycleSummary,
  isActiveCycle,
  jobPartOrder,
  newBuild,
  newCycle,
  nextCase,
  qaDocRequest,
  qaDocSummary,
  retriedJob,
  resolveQuestionIn,
  runRequest,
  verdictChange,
} from './logic';

/*
 * Firestore 구현. 화면은 QcardApi만 알고, 메모리 구현과 같은 규칙을 따른다.
 *
 * - 읽기: Firestore에서 직접 (보안 규칙이 멤버만 허용)
 * - 프로젝트·멤버·초대 쓰기: callable 함수 (apps/functions)
 * - QA 데이터 쓰기: 트랜잭션 (보안 규칙이 Admin·QA만 허용)
 *
 * 구조: projects/{p}/qaDocs/{d}(+cases/{tcId}) · prepFlows · builds · cycles/{c}(+results·runs·defects).
 * 목록 순서가 필요한 하위 문서는 `_i`(시드·생성 순서)로 정렬하고 읽을 때 뗀다.
 */

export type FirebaseDeps = {
  db: Firestore;
  /** 로그인 사용자 (없으면 로그인 화면이 먼저 뜬다) */
  user: () => { uid: string; name: string } | null;
  /** callable 함수 호출 */
  call: <T>(name: string, data: unknown) => Promise<T>;
  /** 스크린샷(증거) 저장소 */
  storage?: FirebaseStorage;
  /** 로컬 콘솔 세션은 호스트 에이전트가 줄 데이터라 아직 fixture를 쓴다 (5단계) */
  consoleSession?: () => Promise<ConsoleSession>;
};

/** Firestore는 undefined를 저장하지 못한다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const strip = <T>(d: DocumentData): T => {
  const { _i: _, ...rest } = d;
  return rest as T;
};
const ordered = <T>(docs: { data: () => DocumentData }[]): T[] =>
  docs
    .map((d) => d.data())
    .sort((a, b) => (a._i ?? 0) - (b._i ?? 0))
    .map((d) => strip<T>(d));

const resultId = (tcId: string, deviceId: string) => `${tcId}__${deviceId}`;

/**
 * 판정 변경 이력 (F-RP-04)은 결과 문서가 아니라 `cycles/{c}/verdictLog`에 한 건씩 쌓는다.
 * 배열 안에는 서버 시각을 넣을 수 없고, 보안 규칙이 판정자·시각을 확인하고 바꾸지 못하게 하려면 문서여야 한다.
 * 결과 문서의 `_decision`은 그 판정을 남긴 로그 id (규칙이 같은 요청에 로그가 생겼는지 본다)
 */
type VerdictLog = Omit<VerdictChange, 'at'> & {
  tcId: string;
  deviceId: string;
  byUid?: string;
  at: string | Timestamp;
  _i?: number;
};
const logTime = (at: VerdictLog['at']) => (typeof at === 'string' ? at : at.toDate().toISOString());
function withHistory(results: DocumentData[], logs: { data: () => DocumentData }[]): CaseResult[] {
  const byResult = new Map<string, VerdictLog[]>();
  for (const d of logs) {
    const l = d.data() as VerdictLog;
    const k = resultId(l.tcId, l.deviceId);
    byResult.set(k, [...(byResult.get(k) ?? []), l]);
  }
  const ms = (l: VerdictLog) => new Date(logTime(l.at)).getTime();
  return results.map((r) => {
    const { _decision: _, ...rest } = r as CaseResult & { _decision?: string };
    const mine = (byResult.get(resultId(rest.tcId, rest.deviceId)) ?? []).sort(
      (a, b) => ms(a) - ms(b) || (a._i ?? 0) - (b._i ?? 0),
    );
    const history = mine.map(({ at, by, from, to, note }) => ({
      at: logTime(at),
      by,
      from,
      to,
      ...(note ? { note } : {}),
    }));
    return { ...rest, history: [...(rest.history ?? []), ...history] };
  });
}

/** Firebase 오류 → 화면용 오류 (규칙 위반 메시지는 그대로 보인다) */
export function fromFirebase(e: unknown): unknown {
  if (!(e instanceof FirebaseError)) return e;
  const code = e.code.replace(/^(functions|firestore|storage)\//, '');
  if (code === 'permission-denied' || code === 'unauthorized') {
    return new PermissionError(
      e.code.startsWith('functions/') ? e.message : '권한이 없습니다. 이 프로젝트의 멤버이고 역할이 맞는지 확인하세요.',
    );
  }
  if (code === 'not-found') return new NotFoundError(e.message);
  if (code === 'failed-precondition' || code === 'invalid-argument') return new RuleError(e.message);
  return e;
}

export function createFirebaseApi(deps: FirebaseDeps): QcardApi {
  const { db } = deps;
  const me = () => {
    const u = deps.user();
    if (!u) throw new PermissionError('로그인이 필요합니다.');
    return u;
  };
  const now = () => new Date().toISOString();
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw fromFirebase(e);
    }
  };
  // callable은 undefined를 null로 바꿔 보내므로 빈 필드는 빼고 보낸다
  const call = <T>(name: string, data: unknown) => guard(() => deps.call<T>(name, clean(data)));

  const P = (p: string) => `projects/${p}`;
  const qaDocRef = (p: string, d: string) => doc(db, P(p), 'qaDocs', d);
  const caseRef = (p: string, d: string, tcId: string) => doc(db, P(p), 'qaDocs', d, 'cases', tcId);

  async function loadQaDoc(p: string, d: string): Promise<QADocument> {
    const meta = await getDoc(qaDocRef(p, d));
    if (!meta.exists()) throw new NotFoundError(`QA 문서 없음: ${d}`);
    const cases = await getDocs(collection(db, P(p), 'qaDocs', d, 'cases'));
    return { ...strip<Omit<QADocument, 'cases'>>(meta.data()), cases: ordered<TestCase>(cases.docs) };
  }
  async function loadCycle(p: string, c: string) {
    const snap = await getDoc(doc(db, P(p), 'cycles', c));
    if (!snap.exists()) throw new NotFoundError(`사이클 없음: ${c}`);
    const sub = (name: string) => getDocs(collection(db, P(p), 'cycles', c, name));
    const [results, runs, defects, logs] = await Promise.all([
      sub('results'),
      sub('runs'),
      sub('defects'),
      sub('verdictLog'),
    ]);
    return {
      cycle: strip<TestCycle>(snap.data()),
      results: withHistory(ordered<DocumentData>(results.docs), logs.docs),
      runs: ordered<Run>(runs.docs),
      defects: ordered<Defect>(defects.docs),
    };
  }
  async function loadBuild(p: string, id: string): Promise<Build> {
    const snap = await getDoc(doc(db, P(p), 'builds', id));
    if (!snap.exists()) throw new NotFoundError(`빌드 없음: ${id}`);
    return strip<Build>(snap.data());
  }

  return {
    get currentUser() {
      return deps.user()?.name ?? '';
    },
    get currentUid() {
      return deps.user()?.uid ?? '';
    },

    // ------------------------------------------------------------ 프로젝트·멤버·초대
    listMyProjects: () =>
      guard(async () => {
        const mine = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', me().uid)));
        const out: ProjectSummary[] = [];
        for (const m of mine.docs.map((d) => d.data() as Member)) {
          const [project, count, cycles] = await Promise.all([
            getDoc(doc(db, P(m.projectId))),
            getCountFromServer(collection(db, P(m.projectId), 'members')),
            getDocs(collection(db, P(m.projectId), 'cycles')),
          ]);
          if (!project.exists()) continue;
          out.push({
            project: strip<Project>(project.data()),
            role: m.role,
            memberCount: count.data().count,
            activeCycles: cycles.docs.filter((c) => isActiveCycle(c.data() as TestCycle)).length,
          });
        }
        return out.sort((a, b) => (a.project.createdAt ?? '').localeCompare(b.project.createdAt ?? ''));
      }),
    getProject: (projectId) =>
      guard(async () => {
        me();
        const snap = await getDoc(doc(db, P(projectId))).catch((e: unknown) => {
          // 멤버가 아니면 규칙이 막는다 — 없는 프로젝트와 구분하지 않는다
          if (e instanceof FirebaseError && e.code === 'permission-denied') {
            throw new PermissionError('이 프로젝트의 멤버가 아닙니다. 초대를 받아야 볼 수 있습니다.');
          }
          throw e;
        });
        if (!snap.exists()) throw new NotFoundError(`프로젝트 없음: ${projectId}`);
        return strip<Project>(snap.data());
      }),
    createProject: (input) => call<Project>('createProject', input),

    myRole: (projectId) =>
      guard(async () => {
        // 멤버가 아니면 규칙이 읽기를 막는다 → 역할 없음
        const snap = await getDoc(doc(db, P(projectId), 'members', me().uid)).catch((e: unknown) => {
          if (e instanceof FirebaseError && e.code === 'permission-denied') return undefined;
          throw e;
        });
        return snap?.exists() ? (snap.data() as Member).role : undefined;
      }),
    listMembers: (projectId) =>
      guard(async () => {
        const snap = await getDocs(collection(db, P(projectId), 'members'));
        return snap.docs.map((d) => d.data() as Member).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
      }),
    setMemberRole: (projectId, uid, role) => call<void>('setMemberRole', { projectId, uid, role }),
    removeMember: (projectId, uid) => call<void>('removeMember', { projectId, uid }),

    listInvitations: (projectId) =>
      guard(async () => {
        const snap = await getDocs(
          query(collection(db, P(projectId), 'invitations'), where('status', '==', 'pending')),
        );
        return snap.docs.map((d) => d.data() as Invitation).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }),
    createInvitation: (projectId, input) => call<Invitation>('createInvitation', { projectId, ...input }),
    revokeInvitation: (projectId, invitationId) => call<void>('revokeInvitation', { projectId, invitationId }),
    getInvitation: (token) => call<InvitationView>('getInvitation', { token }),
    acceptInvitation: (token, input) => call<Project>('acceptInvitation', { token, ...input }),

    leaveProject: (projectId) => call<void>('leaveProject', { projectId }),
    deleteProject: (projectId, confirmName) => call<Project>('deleteProject', { projectId, confirmName }),
    restoreProject: (projectId) => call<Project>('restoreProject', { projectId }),

    // ------------------------------------------------------------ QA 문서
    listQaDocs: (projectId) =>
      guard(async () => {
        const metas = await getDocs(collection(db, P(projectId), 'qaDocs'));
        const docs = await Promise.all(metas.docs.map((d) => loadQaDoc(projectId, d.id)));
        return docs.map((d) => qaDocSummary(d, docs));
      }),
    getQaDoc: ({ projectId, docId }) => guard(() => loadQaDoc(projectId, docId)),
    updateCase: ({ projectId, docId }, tcId, input, expectedRev) =>
      guard(() =>
        runTransaction(db, async (tx) => {
          const ref = caseRef(projectId, docId, tcId);
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new NotFoundError(`케이스 없음: ${tcId}`);
          const current = strip<TestCase>(snap.data());
          // 낙관적 잠금 (F-QD-09)
          if (current.rev !== expectedRev) throw new ConflictError(current);
          const next = nextCase(current, input, me().name, now());
          tx.set(ref, clean({ ...next, _i: snap.data()._i }));
          return next;
        }),
      ),
    setApproval: ({ projectId, docId }, tcIds, status) =>
      guard(() =>
        runTransaction(db, async (tx) => {
          const snaps = await Promise.all(tcIds.map((id) => tx.get(caseRef(projectId, docId, id))));
          for (const s of snaps) {
            if (!s.exists()) continue;
            tx.update(s.ref, { approval: clean(approvalFor(strip<TestCase>(s.data()), status, me().name, now())) });
          }
        }),
      ),
    resolveQuestion: ({ projectId, docId }, questionId, resolution) =>
      guard(async () => {
        // 트랜잭션에서는 질의를 못 하므로 보류 케이스 후보는 먼저 찾고, 안에서 다시 읽는다
        const held = await getDocs(
          query(collection(db, P(projectId), 'qaDocs', docId, 'cases'), where('approval.status', '==', 'held')),
        );
        await runTransaction(db, async (tx) => {
          const meta = await tx.get(qaDocRef(projectId, docId));
          if (!meta.exists()) throw new NotFoundError(`QA 문서 없음: ${docId}`);
          const cases = (await Promise.all(held.docs.map((d) => tx.get(d.ref))))
            .filter((s) => s.exists())
            .map((s) => strip<TestCase>(s.data()));
          const questions = (meta.data() as QADocument).questions;
          const r = resolveQuestionIn({ questions, cases }, questionId, resolution, me().name, now());
          if (!r) throw new NotFoundError(`질문 없음: ${questionId}`);
          tx.update(meta.ref, { questions: clean(r.questions) });
          for (const id of r.released) tx.update(caseRef(projectId, docId, id), { approval: { status: 'pending' } });
        });
      }),
    commentQuestion: ({ projectId, docId }, questionId, text) =>
      guard(() =>
        runTransaction(db, async (tx) => {
          const meta = await tx.get(qaDocRef(projectId, docId));
          const questions = (meta.data() as QADocument | undefined)?.questions ?? [];
          if (!questions.some((q) => q.id === questionId)) throw new NotFoundError(`질문 없음: ${questionId}`);
          const next = questions.map((q) =>
            q.id === questionId ? { ...q, comments: [...q.comments, { by: me().name, at: now(), text }] } : q,
          );
          tx.update(meta.ref, { questions: clean(next) });
        }),
      ),
    listPrepFlows: (projectId) =>
      guard(async () => ordered<PrepFlow>((await getDocs(collection(db, P(projectId), 'prepFlows'))).docs)),

    // ------------------------------------------------------------ 테스트 사이클
    // ------------------------------------------------------------ 빌드·사이클 만들기 (F-DV-05, F-CY-01·02)
    listBuilds: (projectId) =>
      guard(async () =>
        ordered<Build>((await getDocs(collection(db, P(projectId), 'builds'))).docs).sort((a, b) =>
          a.uploadedAt < b.uploadedAt ? 1 : -1,
        ),
      ),
    uploadBuild: (projectId, file) =>
      guard(async () => {
        if (!deps.storage) throw new NotFoundError('빌드를 올릴 저장소가 연결되지 않았습니다');
        const info = await inspectApk(file.bytes).catch((e: unknown) => {
          throw e instanceof ApkError ? new RuleError(e.message) : e;
        });
        const existing = ordered<Build>((await getDocs(collection(db, P(projectId), 'builds'))).docs);
        const id = `build-${info.versionCode}-${doc(collection(db, P(projectId), 'builds')).id.slice(0, 6)}`;
        const build = newBuild(projectId, info, file.name, existing, me(), now(), id);
        // 파일을 먼저 올리고 문서를 만든다 (호스트가 덜 올라간 빌드를 내려받지 않게)
        await uploadBytes(ref(deps.storage, build.storagePath!), file.bytes, {
          contentType: 'application/vnd.android.package-archive',
        });
        await setDoc(doc(db, P(projectId), 'builds', id), clean(build));
        return build;
      }),
    createCycle: (projectId, input) =>
      guard(async () => {
        const [qaDoc, build] = await Promise.all([
          loadQaDoc(projectId, input.docId),
          loadBuild(projectId, input.buildId),
        ]);
        const id = doc(collection(db, P(projectId), 'cycles')).id;
        const { cycle, cases, results } = newCycle(
          projectId,
          input,
          qaDoc,
          build,
          me(),
          now(),
          `cycle-${id.slice(0, 8)}`,
        );
        const base = `${P(projectId)}/cycles/${cycle.id}`;
        // 케이스 사본·결과 칸을 먼저 쓰고 사이클 문서는 마지막에 (목록에 보이는 순간 다 있다)
        await writeAll(db, [
          ...cases.map((c, i) => [`${base}/cases/${c.tcId}`, { ...c, _i: i }] as [string, DocumentData]),
          ...results.map(
            (r, i) => [`${base}/results/${resultId(r.tcId, r.deviceId)}`, { ...r, _i: i }] as [string, DocumentData],
          ),
        ]);
        await setDoc(doc(db, base), clean(cycle));
        return cycle;
      }),

    listCycles: (projectId) =>
      guard(async () => {
        const snap = await getDocs(collection(db, P(projectId), 'cycles'));
        return Promise.all(
          snap.docs.map(async (d) => {
            const c = await loadCycle(projectId, d.id);
            const [build, docMeta] = await Promise.all([
              loadBuild(projectId, c.cycle.buildId),
              getDoc(qaDocRef(projectId, c.cycle.docId)),
            ]);
            const version = (docMeta.data() as QADocument | undefined)?.appVersion ?? '';
            return cycleSummary(c.cycle, build, version, c.results, c.runs);
          }),
        );
      }),
    getCycle: ({ projectId, cycleId }) =>
      guard(async () => {
        const c = await loadCycle(projectId, cycleId);
        const [build, d, cases] = await Promise.all([
          loadBuild(projectId, c.cycle.buildId),
          loadQaDoc(projectId, c.cycle.docId),
          // 사이클을 만들 때 복사한 내용 (QA 문서의 현재 케이스가 아니라)
          getDocs(collection(db, P(projectId), 'cycles', cycleId, 'cases')),
        ]);
        const detail: CycleDetail = { ...c, build, doc: d, cases: ordered<TestCase>(cases.docs) };
        return detail;
      }),
    watchCycle: ({ projectId, cycleId }, onChange, onError) => {
      let stopped = false;
      const fail = (e: unknown) => {
        if (!stopped) onError?.(fromFirebase(e));
      };
      // 빌드·QA 문서·케이스 사본은 사이클을 만든 뒤 바뀌지 않아 처음 한 번만 읽는다
      let fixed: Promise<Pick<CycleDetail, 'build' | 'doc' | 'cases'>> | undefined;
      const live: Partial<Pick<CycleDetail, 'cycle' | 'runs' | 'defects'>> & {
        results?: DocumentData[];
        logs?: QueryDocumentSnapshot[];
      } = {};
      const emit = async () => {
        const { cycle, results, runs, defects, logs } = live;
        if (!cycle || !results || !runs || !defects || !logs) return;
        fixed ??= Promise.all([
          loadBuild(projectId, cycle.buildId),
          loadQaDoc(projectId, cycle.docId),
          getDocs(collection(db, P(projectId), 'cycles', cycleId, 'cases')),
        ]).then(([build, d, cases]) => ({ build, doc: d, cases: ordered<TestCase>(cases.docs) }));
        try {
          const f = await fixed;
          // 기다리는 동안 더 새 값이 왔으면 그 값으로 (live를 다시 읽는다)
          if (!stopped) {
            const results = withHistory(live.results!, live.logs!);
            onChange({ cycle: live.cycle!, ...f, results, defects: live.defects!, runs: live.runs! });
          }
        } catch (e) {
          fixed = undefined;
          fail(e);
        }
      };
      const sub = (name: 'results' | 'runs' | 'defects' | 'verdictLog', set: (docs: QueryDocumentSnapshot[]) => void) =>
        onSnapshot(
          collection(db, P(projectId), 'cycles', cycleId, name),
          (snap) => {
            set(snap.docs);
            void emit();
          },
          fail,
        );
      const unsubs = [
        onSnapshot(
          doc(db, P(projectId), 'cycles', cycleId),
          (snap) => {
            if (!snap.exists()) return fail(new NotFoundError(`사이클 없음: ${cycleId}`));
            live.cycle = strip<TestCycle>(snap.data());
            void emit();
          },
          fail,
        ),
        sub('results', (d) => (live.results = ordered<DocumentData>(d))),
        sub('verdictLog', (d) => (live.logs = d)),
        sub('runs', (d) => (live.runs = ordered<Run>(d))),
        sub('defects', (d) => (live.defects = ordered<Defect>(d))),
      ];
      return () => {
        stopped = true;
        for (const u of unsubs) u();
      };
    },
    confirmVerdict: (input) =>
      guard(() =>
        runTransaction(db, async (tx) => {
          const ref = doc(
            db,
            P(input.projectId),
            'cycles',
            input.cycleId,
            'results',
            resultId(input.tcId, input.deviceId),
          );
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new NotFoundError(`결과 없음: ${input.tcId} × ${input.deviceId}`);
          const user = me();
          const { _decision: _, ...current } = strip<CaseResult & { _decision?: string }>(snap.data());
          // 돌려줄 값은 지금까지의 이력을 붙여 계산한다. 저장은 로그 한 건 + 결과 문서(이력 배열은 그대로)
          const logs = await getDocs(
            query(
              collection(db, P(input.projectId), 'cycles', input.cycleId, 'verdictLog'),
              where('tcId', '==', input.tcId),
              where('deviceId', '==', input.deviceId),
            ),
          );
          const next = confirmedResult(withHistory([current], logs.docs)[0]!, input, user.name, now());
          const log = doc(collection(db, P(input.projectId), 'cycles', input.cycleId, 'verdictLog'));
          const { at: _at, ...change } = verdictChange(current, input, user.name, now());
          tx.set(log, {
            ...clean(change),
            tcId: input.tcId,
            deviceId: input.deviceId,
            byUid: user.uid,
            at: serverTimestamp(),
          });
          tx.set(ref, clean({ ...next, history: current.history, _i: snap.data()._i, _decision: log.id }));
          return next;
        }),
      ),

    // ------------------------------------------------------------ QA 문서 생성 작업 (PRD §5.2, §6.2)
    requestQaDoc: (projectId, input) =>
      guard(async () => {
        if (!deps.storage) throw new NotFoundError('스펙을 올릴 저장소가 연결되지 않았습니다');
        const jobRef = doc(collection(db, P(projectId), 'jobs'));
        // 사람이 알아볼 수 있게 버전을 넣는다 (뒤는 겹치지 않게 자동 id 일부)
        const slug = input.appVersion.trim().replace(/[^\w.-]+/g, '-');
        const bundleRef = doc(db, P(projectId), 'specBundles', `bundle-${slug}-${jobRef.id.slice(0, 6)}`);
        const { bundle, uploads, job } = qaDocRequest(projectId, input, me(), now(), {
          bundleId: bundleRef.id,
          jobId: jobRef.id,
        });
        // 스냅샷 파일을 먼저 올리고, 다 올라간 뒤에 묶음·작업을 만든다 (호스트가 덜 올라간 묶음을 집지 않게)
        for (const u of uploads) {
          await uploadString(ref(deps.storage, u.path), u.content, 'raw', {
            contentType: 'text/markdown; charset=utf-8',
          });
        }
        const batch = writeBatch(db);
        batch.set(bundleRef, clean(bundle));
        batch.set(jobRef, clean(job));
        await batch.commit();
        return job;
      }),
    requestRun: (projectId, input) =>
      guard(async () => {
        const r = doc(collection(db, P(projectId), 'jobs'));
        const job = runRequest(projectId, input, me(), now(), r.id);
        await setDoc(r, clean(job));
        return job;
      }),
    listJobs: (projectId) =>
      guard(async () => {
        const snap = await getDocs(collection(db, P(projectId), 'jobs'));
        return snap.docs.map((d) => d.data() as Job).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }),
    listJobSpecs: (projectId, jobId) =>
      guard(async () => {
        const snap = await getDocs(collection(db, P(projectId), 'jobs', jobId, 'specs'));
        return snap.docs.map((d) => d.data() as QaDocJobSpec).sort(jobPartOrder.specs);
      }),
    listJobEvents: (projectId, jobId) =>
      guard(async () => {
        const snap = await getDocs(collection(db, P(projectId), 'jobs', jobId, 'events'));
        return snap.docs.map((d) => d.data() as QaDocJobEvent).sort(jobPartOrder.events);
      }),
    listJobDrafts: (projectId, jobId, spec) =>
      guard(async () => {
        const snap = await getDocs(
          query(collection(db, P(projectId), 'jobs', jobId, 'drafts'), where('spec', '==', spec)),
        );
        return snap.docs.map((d) => d.data() as QaDocJobDraft).sort(jobPartOrder.drafts);
      }),
    retryJob: (projectId, jobId) =>
      guard(() =>
        runTransaction(db, async (tx) => {
          const r = doc(db, P(projectId), 'jobs', jobId);
          const snap = await tx.get(r);
          if (!snap.exists()) throw new NotFoundError(`작업 없음: ${jobId}`);
          tx.set(r, clean(retriedJob(snap.data() as Job, me().uid)));
        }),
      ),
    myHosts: () =>
      guard(async () => (await getDocs(collection(db, 'users', me().uid, 'hosts'))).docs.map((d) => d.data() as Host)),
    myHostConnections: () =>
      guard(async () => {
        const snap = await getDocs(query(collection(db, 'hostConnections'), where('uid', '==', me().uid)));
        return snap.docs
          .map((d) => {
            const { secretHash: _s, ...conn } = d.data() as HostConnection & { secretHash?: string };
            return conn;
          })
          .sort((a, b) => (a.connectedAt < b.connectedAt ? 1 : -1));
      }),
    connectHost: (name) => call<HostCredential>('pairHost', { name }),
    disconnectHost: (hostId) => call<void>('revokeHost', { hostId }),

    screenshotUrl: (path) =>
      guard(async () => {
        if (!deps.storage) throw new NotFoundError('스크린샷 저장소가 연결되지 않았습니다');
        // 보안 규칙을 거쳐 내려받는다 (멤버만). 다운로드 URL(토큰)은 쓰지 않는다
        const bytes = await getBytes(ref(deps.storage, path));
        return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      }),

    getConsoleSession: () => deps.consoleSession?.() ?? Promise.resolve(createFixtureDb().console),
  };
}

/** 여러 문서를 한 번에 쓴다 (시드용). Firestore 배치는 500개까지 */
export async function writeAll(db: Firestore, docs: [path: string, data: DocumentData][]) {
  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    for (const [path, data] of docs.slice(i, i + 450)) batch.set(doc(db, path), clean(data));
    await batch.commit();
  }
}
