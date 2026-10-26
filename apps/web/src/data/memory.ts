import { ApkError, inspectApk } from '@qcard/apk';
import { createFixtureDb, GITHUB, PEOPLE, type FixtureDb } from '@qcard/fixtures';
import {
  accepting,
  accountChange,
  accountDeletion,
  accountState,
  changeRole,
  deletion,
  flagClearing,
  invitationState,
  leaseLive,
  leaving,
  mergeSecret,
  newAccount,
  newInvitation,
  newProject,
  projectIdFor,
  removal,
  requireAdmin,
  requireEditor,
  requireMember,
  restoration,
  type AccountSecret,
  type Actor,
  type CaseReviseJob,
  type HostConnection,
  type Member,
  type TestAccount,
} from '@qcard/shared';
import {
  ConflictError,
  NotFoundError,
  RuleError,
  toApiError,
  type ConfirmVerdictInput,
  type CycleDetail,
  type CycleRef,
  type CycleSummary,
  type ProjectSummary,
  type QcardApi,
} from './api';
import { localRunCycle, type LocalRun } from './localRuns';
import {
  approvalFor,
  caseReviseRequest,
  closedRevision,
  confirmedResult,
  cycleSummary,
  isActiveCycle,
  jobPartOrder,
  newBuild,
  newCycle,
  nextCase,
  qaDocRequest,
  runRequest,
  qaDocSummary,
  resolveQuestionIn,
  retriedJob,
} from '@qcard/data';

export { countVerdicts, passRate } from '@qcard/data';

const clone = <T>(v: T): T => structuredClone(v);

/** 메모리 구현은 로그인이 없으므로 개발용으로 사용자를 바꿀 수 있다 (초대 수락·권한 화면 확인용) */
export type MemoryApi = QcardApi & { readonly users: string[]; switchUser(user: string): void };

export const isMemoryApi = (api: QcardApi): api is MemoryApi => 'switchUser' in api;

/**
 * fixture 위의 메모리 구현. 새로고침하면 처음 상태로 돌아간다.
 * `localRuns`를 주면 호스트에서 돌린 실행을 처음 한 번 읽어 "로컬 실행" 사이클로 더한다.
 */
export function createMemoryApi(
  options: { db?: FixtureDb; currentUser?: string; latencyMs?: number; localRuns?: () => Promise<LocalRun[]> } = {},
): MemoryApi {
  const db = options.db ?? createFixtureDb();
  let loaded: Promise<void> | undefined;
  const ensureLocal = () =>
    (loaded ??= (options.localRuns?.() ?? Promise.resolve([])).then((runs) => {
      for (const run of runs) {
        const doc = db.qaDocs.find((d) => d.id === run.docId);
        if (!doc || db.cycles.some((c) => c.id === `run-${run.id}`)) continue;
        const { cycle, build } = localRunCycle(run, doc);
        db.cycles.push(cycle);
        db.builds.push(build);
        const byId = new Map(doc.cases.map((c) => [c.tcId, c]));
        db.cycleCases[cycle.id] = structuredClone(cycle.snapshot.flatMap((s) => byId.get(s.tcId) ?? []));
        db.results[cycle.id] = run.results;
        db.defects[cycle.id] = [];
        db.runs[cycle.id] = [];
      }
    }));
  let currentUser: string = options.currentUser ?? PEOPLE.lead;
  const latency = options.latencyMs ?? 0;
  const now = () => new Date().toISOString();
  const wait = <T>(v: T): Promise<T> =>
    latency ? new Promise((r) => setTimeout(() => r(clone(v)), latency)) : Promise.resolve(clone(v));

  const doc = (docId: string) => {
    const d = db.qaDocs.find((x) => x.id === docId);
    if (!d) throw new NotFoundError(`QA 문서 없음: ${docId}`);
    return d;
  };
  const cycle = (cycleId: string) => {
    const c = db.cycles.find((x) => x.id === cycleId);
    if (!c) throw new NotFoundError(`사이클 없음: ${cycleId}`);
    return c;
  };
  const build = (buildId: string) => db.builds.find((b) => b.id === buildId)!;

  // ------------------------------------------------------------ 프로젝트·멤버·초대 (F-TM-09~13)
  // 규칙은 @qcard/shared membership — Cloud Functions도 같은 함수를 쓴다.
  const project = (projectId: string) => {
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) throw new NotFoundError(`프로젝트 없음: ${projectId}`);
    return p;
  };
  const actor = (): Actor => {
    const gh = GITHUB[currentUser] ?? currentUser;
    return { uid: gh, name: currentUser, github: gh };
  };
  const membersOf = (projectId: string) => db.members.filter((m) => m.projectId === projectId);
  const invitationsOf = (projectId: string) => db.invitations.filter((i) => i.projectId === projectId);
  const me = (projectId: string) => membersOf(projectId).find((m) => m.uid === actor().uid);
  const replaceMember = (m: Member) => {
    const i = db.members.findIndex((x) => x.projectId === m.projectId && x.uid === m.uid);
    if (i >= 0) db.members[i] = m;
    else db.members.push(m);
  };
  const dropMember = (m: Member) => {
    db.members = db.members.filter((x) => !(x.projectId === m.projectId && x.uid === m.uid));
  };
  /** 공용 규칙의 오류를 화면용 오류로 바꾼다 */
  const rules = async <T>(fn: () => T): Promise<T> => {
    try {
      return wait(fn());
    } catch (e) {
      throw toApiError(e);
    }
  };

  // 호스트 연결 (F-TM-14). 시연: 이재성의 MacBook Pro가 연결돼 있고 켜져 있다
  const DEMO_HOST = 'macbook-pro';
  let connections: HostConnection[] = [
    { id: DEMO_HOST, uid: GITHUB[PEOPLE.lead]!, name: 'MacBook Pro', connectedAt: '2026-10-20T09:00:00.000Z' },
  ];

  // 테스트 계정 (F-PF-04·08·09). 비밀값은 봉인하지 않고 따로 둔다 (Functions는 Cloud KMS로 봉인)
  let accounts: TestAccount[] = db.accounts;
  const secrets = new Map<string, AccountSecret>();
  const accountsOf = (projectId: string) => accounts.filter((a) => a.projectId === projectId);
  const account = (projectId: string, id: string) => {
    const a = accountsOf(projectId).find((x) => x.id === id);
    if (!a) throw new NotFoundError('테스트 계정을 찾을 수 없습니다.');
    return a;
  };
  const leaseIsLive = (a: TestAccount) => {
    const run = a.lease && db.runs[a.lease.cycleId]?.find((r) => r.id === a.lease!.runId);
    return leaseLive(run, now());
  };
  const putAccount = (a: TestAccount) => {
    accounts = accounts.map((x) => (x.id === a.id ? a : x));
    return a;
  };

  // 사이클 구독 (watchCycle): 쓰기가 일어나면 그 사이클을 다시 읽어 알린다
  const watchers = new Map<string, Set<(d: CycleDetail) => void>>();
  const notify = (ref: CycleRef) => {
    const set = watchers.get(ref.cycleId);
    if (!set?.size) return;
    void api.getCycle(ref).then((d) => set.forEach((fn) => fn(d)));
  };

  const api: MemoryApi = {
    get currentUser() {
      return currentUser;
    },
    get currentUid() {
      return actor().uid;
    },
    users: Object.values(PEOPLE),
    switchUser(user: string) {
      currentUser = user;
    },

    async listMyProjects() {
      await ensureLocal();
      const out: ProjectSummary[] = db.members
        .filter((m) => m.uid === actor().uid)
        .map((m) => ({
          project: project(m.projectId),
          role: m.role,
          memberCount: membersOf(m.projectId).length,
          activeCycles: db.cycles.filter((c) => c.projectId === m.projectId && isActiveCycle(c)).length,
        }));
      return wait(out);
    },
    async getProject(projectId) {
      const p = project(projectId);
      return rules(() => (requireMember(membersOf(projectId), actor().uid), p));
    },
    async createProject(input) {
      return rules(() => {
        const id = projectIdFor(input.name, (x) => db.projects.some((p) => p.id === x));
        const { project: p, member } = newProject(input, actor(), id, now());
        db.projects.push(p);
        db.members.push(member);
        return p;
      });
    },

    async myRole(projectId) {
      return wait(me(projectId)?.role);
    },
    async listMembers(projectId) {
      return rules(() => (requireMember(membersOf(projectId), actor().uid), membersOf(projectId)));
    },
    async setMemberRole(projectId, uid, role) {
      return rules(() => replaceMember(changeRole(membersOf(projectId), actor(), uid, role)));
    },
    async removeMember(projectId, uid) {
      return rules(() => dropMember(removal(membersOf(projectId), actor(), uid)));
    },

    async listInvitations(projectId) {
      return rules(() => {
        requireAdmin(membersOf(projectId), actor().uid);
        return invitationsOf(projectId).filter((i) => i.status === 'pending');
      });
    },
    async createInvitation(projectId, input) {
      return rules(() => {
        const ids = {
          id: `inv-${db.invitations.length + 1}-${Date.now().toString(36)}`,
          token: `${projectId}-${Math.random().toString(36).slice(2, 10)}`,
        };
        const inv = newInvitation(membersOf(projectId), invitationsOf(projectId), actor(), input, ids, now());
        db.invitations.push(inv);
        return inv;
      });
    },
    async revokeInvitation(projectId, invitationId) {
      return rules(() => {
        requireAdmin(membersOf(projectId), actor().uid);
        const inv = invitationsOf(projectId).find((i) => i.id === invitationId);
        if (!inv) throw new NotFoundError(`초대 없음: ${invitationId}`);
        inv.status = 'revoked';
      });
    },
    async getInvitation(token) {
      const inv = db.invitations.find((i) => i.token === token);
      if (!inv) throw new NotFoundError('초대를 찾을 수 없습니다. 링크를 다시 확인하세요.');
      const state = invitationState(inv, actor(), !!me(inv.projectId), now());
      return wait({ invitation: inv, project: project(inv.projectId), state });
    },
    async acceptInvitation(token, input) {
      const inv = db.invitations.find((i) => i.token === token);
      if (!inv) throw new NotFoundError('초대를 찾을 수 없습니다.');
      return rules(() => {
        const r = accepting(inv, actor(), !!me(inv.projectId), input.dataNoticeAck, now());
        db.members.push(r.member);
        inv.status = r.invitationStatus;
        return project(inv.projectId);
      });
    },

    async leaveProject(projectId) {
      return rules(() => dropMember(leaving(membersOf(projectId), actor())));
    },
    async deleteProject(projectId, confirmName) {
      const p = project(projectId);
      return rules(() => Object.assign(p, deletion(p, membersOf(projectId), actor(), confirmName, now())));
    },
    async restoreProject(projectId) {
      const p = project(projectId);
      return rules(() => {
        restoration(membersOf(projectId), actor());
        delete p.deletedAt;
        delete p.purgeAt;
        return p;
      });
    },

    async listQaDocs(projectId) {
      const docs = db.qaDocs.filter((d) => d.projectId === projectId);
      return wait(docs.map((d) => qaDocSummary(d, docs)));
    },
    async getQaDoc({ docId }) {
      return wait(doc(docId));
    },
    async updateCase({ docId }, tcId, input, expectedRev) {
      const d = doc(docId);
      const i = d.cases.findIndex((c) => c.tcId === tcId);
      const current = d.cases[i];
      if (!current) throw new NotFoundError(`케이스 없음: ${tcId}`);
      if (current.rev !== expectedRev) throw new ConflictError(clone(current));
      d.cases[i] = nextCase(current, input, currentUser, now());
      return wait(d.cases[i]);
    },
    async setApproval({ docId }, tcIds, status) {
      for (const c of doc(docId).cases) {
        if (tcIds.includes(c.tcId)) c.approval = approvalFor(c, status, currentUser, now());
      }
      return wait(undefined);
    },
    async resolveQuestion({ docId }, questionId, resolution) {
      const d = doc(docId);
      const r = resolveQuestionIn(d, questionId, resolution, currentUser, now());
      if (!r) throw new NotFoundError(`질문 없음: ${questionId}`);
      d.questions = r.questions;
      for (const c of d.cases) if (r.released.includes(c.tcId)) c.approval = { status: 'pending' };
      return wait(undefined);
    },
    async commentQuestion({ docId }, questionId, text) {
      const q = doc(docId).questions.find((x) => x.id === questionId);
      if (!q) throw new NotFoundError(`질문 없음: ${questionId}`);
      q.comments.push({ by: currentUser, at: now(), text });
      return wait(undefined);
    },
    async listPrepFlows() {
      return wait(db.prepFlows);
    },

    // ------------------------------------------------------------ 테스트 계정 (F-PF-04·08·09)
    // 규칙은 @qcard/shared accounts — Cloud Functions도 같은 함수를 쓴다
    async listAccounts(projectId) {
      project(projectId);
      const views = accountsOf(projectId)
        .map((a) => ({ account: a, state: accountState(a, leaseIsLive(a)) }))
        .sort((a, b) => a.account.loginId.localeCompare(b.account.loginId));
      return wait(views);
    },
    createAccount: (projectId, input) =>
      rules(() => {
        const id = `acct-${accounts.length + 1}-${Date.now().toString(36)}`;
        const r = newAccount(membersOf(projectId), accountsOf(projectId), actor(), input, id, now());
        accounts.push(r.account);
        secrets.set(id, r.secret);
        return r.account;
      }),
    updateAccount: (projectId, accountId, patch) =>
      rules(() => {
        const a = account(projectId, accountId);
        const r = accountChange(membersOf(projectId), accountsOf(projectId), actor(), a, patch, now());
        if (r.secret) secrets.set(accountId, mergeSecret(secrets.get(accountId)!, r.secret));
        return putAccount(r.account);
      }),
    deleteAccount: (projectId, accountId) =>
      rules(() => {
        const a = account(projectId, accountId);
        accountDeletion(membersOf(projectId), actor(), a, leaseIsLive(a));
        accounts = accounts.filter((x) => x.id !== accountId);
        secrets.delete(accountId);
      }),
    clearAccountFlag: (projectId, accountId, flag) =>
      rules(() => putAccount(flagClearing(membersOf(projectId), actor(), account(projectId, accountId), flag))),

    // ------------------------------------------------------------ 빌드·사이클 만들기
    // fixture 빌드는 저장 경로가 없고 하루콩 프로젝트 것이다
    async listBuilds(projectId) {
      const mine = db.builds.filter((b) =>
        b.storagePath ? b.storagePath.startsWith(`projects/${projectId}/`) : projectId === 'haru',
      );
      return wait([...mine].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)));
    },
    async uploadBuild(projectId, file) {
      requireEditor(membersOf(projectId), actor().uid);
      const info = await inspectApk(file.bytes).catch((e: unknown) => {
        throw e instanceof ApkError ? new RuleError(e.message) : e;
      });
      return rules(() => {
        const build = newBuild(projectId, info, file.name, db.builds, actor(), now(), `build-m${db.builds.length + 1}`);
        db.builds.push(build);
        return build;
      });
    },
    async createCycle(projectId, input) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const id = `cycle-m${db.cycles.length + 1}`;
        const { cycle, cases, results } = newCycle(
          projectId,
          input,
          doc(input.docId),
          build(input.buildId),
          actor(),
          now(),
          id,
        );
        db.cycles.push(cycle);
        db.cycleCases[id] = cases;
        db.results[id] = results;
        db.runs[id] = [];
        db.defects[id] = [];
        return cycle;
      });
    },

    async listCycles(projectId) {
      await ensureLocal();
      const out: CycleSummary[] = db.cycles
        .filter((c) => c.projectId === projectId)
        .map((c) =>
          cycleSummary(c, build(c.buildId), doc(c.docId).appVersion, db.results[c.id] ?? [], db.runs[c.id] ?? []),
        );
      return wait(out);
    },
    async getCycle({ cycleId }) {
      await ensureLocal();
      const c = cycle(cycleId);
      const detail: CycleDetail = {
        cycle: c,
        build: build(c.buildId),
        doc: doc(c.docId),
        cases: db.cycleCases[c.id] ?? [],
        results: db.results[c.id] ?? [],
        defects: db.defects[c.id] ?? [],
        runs: db.runs[c.id] ?? [],
      };
      return wait(detail);
    },
    watchCycle(ref, onChange, onError) {
      const fn = (d: CycleDetail) => onChange(d);
      const set = watchers.get(ref.cycleId) ?? new Set();
      watchers.set(ref.cycleId, set.add(fn));
      api.getCycle(ref).then((d) => set.has(fn) && fn(d), onError);
      return () => void set.delete(fn);
    },
    async confirmVerdict(input: ConfirmVerdictInput) {
      await ensureLocal();
      const results = db.results[input.cycleId] ?? [];
      const i = results.findIndex((x) => x.tcId === input.tcId && x.deviceId === input.deviceId);
      if (i < 0) throw new NotFoundError(`결과 없음: ${input.tcId} × ${input.deviceId}`);
      results[i] = confirmedResult(results[i]!, input, currentUser, now());
      notify(input);
      return wait(results[i]);
    },

    // ------------------------------------------------------------ QA 문서 생성 작업
    // 메모리 구현에는 호스트가 없어 요청한 작업은 "호스트 대기"로 남는다
    async requestQaDoc(projectId, input) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const n = db.jobs.length + 1;
        const { job } = qaDocRequest(projectId, input, actor(), now(), {
          bundleId: `bundle-m${n}`,
          jobId: `job-m${n}`,
        });
        db.jobs.unshift(job);
        return job;
      });
    },
    async requestRun(projectId, input) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const job = runRequest(projectId, input, actor(), now(), `job-m${db.jobs.length + 1}`);
        db.jobs.unshift(job);
        return job;
      });
    },
    async listJobs(projectId) {
      return wait(db.jobs.filter((j) => j.projectId === projectId));
    },
    async listJobSpecs(_projectId, jobId) {
      return wait([...(db.jobParts[jobId]?.specs ?? [])].sort(jobPartOrder.specs));
    },
    async listJobEvents(_projectId, jobId) {
      return wait([...(db.jobParts[jobId]?.events ?? [])].sort(jobPartOrder.events));
    },
    async listJobDrafts(_projectId, jobId, spec) {
      return wait((db.jobParts[jobId]?.drafts ?? []).filter((d) => d.spec === spec).sort(jobPartOrder.drafts));
    },
    async retryJob(projectId, jobId) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const i = db.jobs.findIndex((j) => j.id === jobId);
        if (i < 0) throw new NotFoundError(`작업 없음: ${jobId}`);
        db.jobs[i] = retriedJob(db.jobs[i]!, actor().uid);
      });
    },
    async requestCaseRevision({ projectId, docId }, tcId) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const job = caseReviseRequest(doc(docId), tcId, db.jobs, actor(), now(), `job-m${db.jobs.length + 1}`);
        db.jobs.unshift(job);
        return job;
      });
    },
    async listCaseRevisions({ projectId, docId }) {
      return wait(
        db.jobs.filter(
          (j): j is CaseReviseJob => j.projectId === projectId && j.kind === 'case_revise' && j.input.docId === docId,
        ),
      );
    },
    async closeCaseRevision(projectId, jobId, outcome) {
      return rules(() => {
        const i = db.jobs.findIndex((j) => j.projectId === projectId && j.id === jobId);
        if (i < 0) throw new NotFoundError(`작업 없음: ${jobId}`);
        db.jobs[i] = closedRevision(db.jobs[i]!, outcome, actor(), now());
      });
    },
    async myHosts() {
      // 시연: 이재성만 호스트 에이전트를 켜 두었다 (다른 사용자로 바꾸면 "호스트 꺼짐" 안내를 볼 수 있다)
      if (currentUser !== PEOPLE.lead || !connections.some((c) => c.id === DEMO_HOST)) return wait([]);
      return wait([
        {
          id: 'macbook-pro',
          name: '이재성의 MacBook Pro',
          lastSeen: now(),
          // 시드 사이클(1.3.0 1차 회귀)의 대상 — 웹에서 [내 호스트에서 실행]을 볼 수 있게
          devices: [{ serial: '3A281FDH2000AB', model: 'Pixel 8', osMajor: 16, resolution: '1080×2400' }],
          claudeCode: { version: '2.1.308', loggedIn: true, subscriptionType: 'max' },
          jobs: ['qa_doc_generate', 'run_cycle', 'case_revise'],
        },
      ]);
    },

    async myHostConnections() {
      return wait(
        connections.filter((c) => c.uid === actor().uid).sort((a, b) => (a.connectedAt < b.connectedAt ? 1 : -1)),
      );
    },
    async connectHost(name) {
      const id = `host-${connections.length + 1}-${Date.now().toString(36)}`;
      connections.push({ id, uid: actor().uid, name: name.trim(), connectedAt: now() });
      return wait({ uid: actor().uid, hostId: id, secret: `memory-secret-${id}` });
    },
    async disconnectHost(hostId) {
      if (!connections.some((c) => c.id === hostId && c.uid === actor().uid)) {
        throw new NotFoundError('연결된 PC를 찾을 수 없습니다.');
      }
      connections = connections.filter((c) => c.id !== hostId);
      return wait(undefined);
    },

    async screenshotUrl(path) {
      throw new NotFoundError(`메모리 구현에는 Storage가 없습니다: ${path}`);
    },

    async getConsoleSession() {
      return wait(db.console);
    },
  };
  return api;
}
