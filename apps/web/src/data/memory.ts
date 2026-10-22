import { createFixtureDb, GITHUB, hash, PEOPLE, type FixtureDb } from '@qcard/fixtures';
import {
  CaseBody,
  DELETE_GRACE_DAYS,
  INVITE_TTL_DAYS,
  type CaseResult,
  type Invitation,
  type Project,
  type TestCase,
  type Verdict,
} from '@qcard/shared';
import {
  ConflictError,
  NotFoundError,
  PermissionError,
  RuleError,
  type ConfirmVerdictInput,
  type CycleDetail,
  type CycleSummary,
  type InvitationView,
  type ProjectSummary,
  type QaDocSummary,
  type QcardApi,
  type VerdictCounts,
} from './api';
import { localRunCycle, type LocalRun } from './localRuns';

const VERDICTS: Verdict[] = ['pass', 'fail', 'blocked', 'check', 'nt', 'na'];

export function countVerdicts(results: CaseResult[]): VerdictCounts {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
  for (const r of results) counts[r.verdict]++;
  return counts;
}

/** 통과율 = Pass / (수행 완료 칸 − N/A). N/T는 분모에서 뺀다. */
export function passRate(counts: VerdictCounts): number {
  const done = counts.pass + counts.fail + counts.blocked + counts.check;
  return done === 0 ? 0 : counts.pass / done;
}

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
        db.results[cycle.id] = run.results;
        db.defects[cycle.id] = [];
        db.runs[cycle.id] = [];
      }
    }));
  let currentUser: string = options.currentUser ?? PEOPLE.lead;
  const latency = options.latencyMs ?? 0;
  const now = () => new Date().toISOString();
  const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
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

  // ------------------------------------------------------------ 프로젝트·멤버·초대 규칙 (F-TM-09~13)
  // 4단계에서 Firestore 보안 규칙·Functions가 같은 규칙을 강제한다.
  const project = (projectId: string) => {
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) throw new NotFoundError(`프로젝트 없음: ${projectId}`);
    return p;
  };
  const membersOf = (projectId: string) => db.members.filter((m) => m.projectId === projectId);
  const me = (projectId: string) => membersOf(projectId).find((m) => m.user === currentUser);
  const requireMember = (projectId: string) => {
    const m = me(projectId);
    if (!m) throw new PermissionError('이 프로젝트의 멤버가 아닙니다. 초대를 받아야 볼 수 있습니다.');
    return m;
  };
  const requireAdmin = (projectId: string) => {
    const m = requireMember(projectId);
    if (m.role !== 'admin') throw new PermissionError('Admin만 할 수 있습니다.');
    return m;
  };
  const adminCount = (projectId: string) => membersOf(projectId).filter((m) => m.role === 'admin').length;
  const expired = (inv: Invitation) => inv.expiresAt < now();
  const github = (user: string) => GITHUB[user] ?? user;

  return {
    get currentUser() {
      return currentUser;
    },
    users: Object.values(PEOPLE),
    switchUser(user: string) {
      currentUser = user;
    },

    async listMyProjects() {
      await ensureLocal();
      const out: ProjectSummary[] = db.members
        .filter((m) => m.user === currentUser)
        .map((m) => ({
          project: project(m.projectId),
          role: m.role,
          memberCount: membersOf(m.projectId).length,
          activeCycles: db.cycles.filter(
            (c) => c.projectId === m.projectId && !c.period.end && c.origin !== 'local_run',
          ).length,
        }));
      return wait(out);
    },
    async getProject(projectId) {
      const p = project(projectId);
      requireMember(projectId);
      return wait(p);
    },
    async createProject(input) {
      if (!input.dataNoticeAck) throw new RuleError('데이터 처리 안내를 확인해야 프로젝트를 만들 수 있습니다.');
      const name = input.name.trim();
      if (!name || !input.appName.trim() || !input.packageName.trim()) {
        throw new RuleError('프로젝트 이름, 앱 이름, 패키지명을 모두 입력하세요.');
      }
      if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(input.packageName.trim())) {
        throw new RuleError('패키지명은 com.example.app 형식이어야 합니다.');
      }
      const base =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'project';
      let id = base;
      for (let i = 2; db.projects.some((p) => p.id === id); i++) id = `${base}-${i}`;
      const at = now();
      const p: Project = {
        id,
        name,
        appName: input.appName.trim(),
        packageName: input.packageName.trim(),
        createdBy: currentUser,
        createdAt: at,
      };
      db.projects.push(p);
      db.members.push({
        projectId: id,
        user: currentUser,
        github: github(currentUser),
        role: 'admin',
        joinedAt: at,
        dataNoticeAckAt: at,
      });
      return wait(p);
    },

    async myRole(projectId) {
      return wait(me(projectId)?.role);
    },
    async listMembers(projectId) {
      requireMember(projectId);
      return wait(membersOf(projectId));
    },
    async setMemberRole(projectId, user, role) {
      requireAdmin(projectId);
      const m = membersOf(projectId).find((x) => x.user === user);
      if (!m) throw new NotFoundError(`멤버 없음: ${user}`);
      if (m.role === 'admin' && role !== 'admin' && adminCount(projectId) === 1) {
        throw new RuleError('프로젝트에는 Admin이 1명 이상 있어야 합니다. 다른 멤버를 먼저 Admin으로 지정하세요.');
      }
      m.role = role;
      return wait(undefined);
    },
    async removeMember(projectId, user) {
      requireAdmin(projectId);
      if (user === currentUser) throw new RuleError('본인은 내보낼 수 없습니다. 탈퇴를 사용하세요.');
      const m = membersOf(projectId).find((x) => x.user === user);
      if (!m) throw new NotFoundError(`멤버 없음: ${user}`);
      if (m.role === 'admin' && adminCount(projectId) === 1) {
        throw new RuleError('프로젝트에는 Admin이 1명 이상 있어야 합니다.');
      }
      db.members.splice(db.members.indexOf(m), 1);
      return wait(undefined);
    },

    async listInvitations(projectId) {
      requireAdmin(projectId);
      return wait(db.invitations.filter((i) => i.projectId === projectId && i.status === 'pending'));
    },
    async createInvitation(projectId, input) {
      requireAdmin(projectId);
      const gh = input.github?.trim().replace(/^@/, '') || undefined;
      if (gh && !/^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/.test(gh)) {
        throw new RuleError('GitHub 사용자명 형식이 아닙니다.');
      }
      if (gh && membersOf(projectId).some((m) => m.github === gh)) throw new RuleError(`@${gh}은 이미 멤버입니다.`);
      if (
        gh &&
        db.invitations.some(
          (i) => i.projectId === projectId && i.github === gh && i.status === 'pending' && !expired(i),
        )
      ) {
        throw new RuleError(`@${gh}에게 보낸 초대가 이미 대기 중입니다.`);
      }
      const id = `inv-${db.invitations.length + 1}-${Date.now().toString(36)}`;
      const inv: Invitation = {
        id,
        projectId,
        role: input.role,
        invitedBy: currentUser,
        ...(gh ? { github: gh } : {}),
        token: `${projectId}-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: now(),
        expiresAt: days(INVITE_TTL_DAYS),
        status: 'pending',
      };
      db.invitations.push(inv);
      return wait(inv);
    },
    async revokeInvitation(projectId, invitationId) {
      requireAdmin(projectId);
      const inv = db.invitations.find((i) => i.id === invitationId && i.projectId === projectId);
      if (!inv) throw new NotFoundError(`초대 없음: ${invitationId}`);
      inv.status = 'revoked';
      return wait(undefined);
    },
    async getInvitation(token) {
      const inv = db.invitations.find((i) => i.token === token);
      if (!inv) throw new NotFoundError('초대를 찾을 수 없습니다. 링크를 다시 확인하세요.');
      const state: InvitationView['state'] =
        inv.status !== 'pending'
          ? inv.status
          : me(inv.projectId)
            ? 'member'
            : expired(inv)
              ? 'expired'
              : inv.github && inv.github !== github(currentUser)
                ? 'other-user'
                : 'pending';
      return wait({ invitation: inv, project: project(inv.projectId), state });
    },
    async acceptInvitation(token, input) {
      const inv = db.invitations.find((i) => i.token === token);
      if (!inv) throw new NotFoundError('초대를 찾을 수 없습니다.');
      if (inv.status === 'revoked') throw new RuleError('취소된 초대입니다.');
      if (inv.status === 'accepted') throw new RuleError('이미 사용된 초대입니다.');
      if (expired(inv)) throw new RuleError('만료된 초대입니다. 초대한 사람에게 새 초대를 요청하세요.');
      if (inv.github && inv.github !== github(currentUser)) throw new RuleError(`@${inv.github}에게 보낸 초대입니다.`);
      if (me(inv.projectId)) throw new RuleError('이미 이 프로젝트의 멤버입니다.');
      if (!input.dataNoticeAck) throw new RuleError('데이터 처리 안내를 확인해야 참여할 수 있습니다.');
      const at = now();
      db.members.push({
        projectId: inv.projectId,
        user: currentUser,
        github: github(currentUser),
        role: inv.role,
        joinedAt: at,
        dataNoticeAckAt: at,
      });
      // 사용자명 초대는 한 번 쓰면 끝, 링크 초대는 만료·취소 전까지 여러 사람이 쓴다
      if (inv.github) inv.status = 'accepted';
      return wait(project(inv.projectId));
    },

    async leaveProject(projectId) {
      const m = requireMember(projectId);
      const all = membersOf(projectId);
      if (all.length === 1) throw new RuleError('혼자 남은 멤버는 탈퇴할 수 없습니다. 프로젝트를 삭제하세요.');
      if (m.role === 'admin' && adminCount(projectId) === 1) {
        throw new RuleError('마지막 Admin입니다. 다른 멤버를 Admin으로 지정한 뒤 탈퇴하세요.');
      }
      db.members.splice(db.members.indexOf(m), 1);
      return wait(undefined);
    },
    async deleteProject(projectId, confirmName) {
      requireAdmin(projectId);
      const p = project(projectId);
      if (confirmName.trim() !== p.name) throw new RuleError('프로젝트 이름이 일치하지 않습니다.');
      p.deletedAt = now();
      p.purgeAt = days(DELETE_GRACE_DAYS);
      return wait(p);
    },
    async restoreProject(projectId) {
      requireAdmin(projectId);
      const p = project(projectId);
      delete p.deletedAt;
      delete p.purgeAt;
      return wait(p);
    },

    async listQaDocs(projectId) {
      const docs = db.qaDocs.filter((d) => d.projectId === projectId);
      const summaries: QaDocSummary[] = docs.map((d) => {
        const changeCounts = { new: 0, changed: 0, removed: 0, same: 0 };
        const approvalCounts = { pending: 0, approved: 0, rejected: 0, held: 0 };
        for (const c of d.cases) {
          changeCounts[c.change]++;
          approvalCounts[c.approval.status]++;
        }
        return {
          id: d.id,
          appVersion: d.appVersion,
          createdAt: d.createdAt,
          prevAppVersion: docs.find((x) => x.id === d.prevDocId)?.appVersion,
          caseCount: d.cases.length,
          changeCounts,
          approvalCounts,
          openQuestions: d.questions.filter((q) => q.status === 'open').length,
        };
      });
      return wait(summaries);
    },
    async getQaDoc(docId) {
      return wait(doc(docId));
    },
    async updateCase(docId, tcId, input, expectedRev) {
      // 케이스 전체 객체를 넘겨도 본문 필드만 남긴다 (해시·저장 대상)
      const body = CaseBody.parse(input);
      const d = doc(docId);
      const i = d.cases.findIndex((c) => c.tcId === tcId);
      const current = d.cases[i];
      if (!current) throw new NotFoundError(`케이스 없음: ${tcId}`);
      if (current.rev !== expectedRev) throw new ConflictError(clone(current));
      const contentHash = hash(body);
      const changed = contentHash !== current.contentHash;
      const next: TestCase = {
        ...current,
        ...body,
        contentHash,
        rev: current.rev + 1,
        updatedBy: currentUser,
        updatedAt: now(),
        // 내용이 바뀌면 자동 미승인 (F-QD-10)
        approval: changed && current.approval.status === 'approved' ? { status: 'pending' } : current.approval,
      };
      d.cases[i] = next;
      return wait(next);
    },
    async setApproval(docId, tcIds, status) {
      const d = doc(docId);
      for (const c of d.cases) {
        if (!tcIds.includes(c.tcId)) continue;
        c.approval =
          status === 'approved'
            ? { status, by: currentUser, at: now(), contentHash: c.contentHash }
            : status === 'rejected'
              ? { status, by: currentUser, at: now() }
              : { status };
      }
      return wait(undefined);
    },
    async resolveQuestion(docId, questionId, resolution) {
      const d = doc(docId);
      const q = d.questions.find((x) => x.id === questionId);
      if (!q) throw new NotFoundError(`질문 없음: ${questionId}`);
      q.status = resolution.kind === 'answer' ? 'answered' : 'proceed';
      if (resolution.kind === 'answer') q.answer = resolution.text;
      q.comments.push({
        by: currentUser,
        at: now(),
        text: resolution.kind === 'answer' ? resolution.text : '현 스펙대로 진행합니다.',
      });
      // 열린 질문이 더 없는 보류 케이스는 미승인으로 돌아간다
      for (const c of d.cases) {
        if (c.approval.status !== 'held') continue;
        const stillOpen = d.questions.some((x) => x.status === 'open' && x.caseIds.includes(c.tcId));
        if (!stillOpen) c.approval = { status: 'pending' };
      }
      return wait(undefined);
    },
    async commentQuestion(docId, questionId, text) {
      const q = doc(docId).questions.find((x) => x.id === questionId);
      if (!q) throw new NotFoundError(`질문 없음: ${questionId}`);
      q.comments.push({ by: currentUser, at: now(), text });
      return wait(undefined);
    },
    async listPrepFlows() {
      return wait(db.prepFlows);
    },

    async listCycles(projectId) {
      await ensureLocal();
      const out: CycleSummary[] = db.cycles
        .filter((c) => c.projectId === projectId)
        .map((c) => {
          const results = db.results[c.id] ?? [];
          const counts = countVerdicts(results);
          return {
            cycle: c,
            build: build(c.buildId),
            docVersion: doc(c.docId).appVersion,
            counts,
            total: results.length,
            done: results.length - counts.nt,
            passRate: passRate(counts),
            activeRuns: (db.runs[c.id] ?? []).filter((r) => r.status === 'running' || r.status === 'paused'),
          };
        });
      return wait(out);
    },
    async getCycle(cycleId) {
      await ensureLocal();
      const c = cycle(cycleId);
      const d = doc(c.docId);
      const byId = new Map(d.cases.map((x) => [x.tcId, x]));
      const detail: CycleDetail = {
        cycle: c,
        build: build(c.buildId),
        doc: d,
        cases: c.snapshot.map((s) => byId.get(s.tcId)!).filter(Boolean),
        results: db.results[c.id] ?? [],
        defects: db.defects[c.id] ?? [],
        runs: db.runs[c.id] ?? [],
      };
      return wait(detail);
    },
    async confirmVerdict(input: ConfirmVerdictInput) {
      await ensureLocal();
      const results = db.results[input.cycleId] ?? [];
      const r = results.find((x) => x.tcId === input.tcId && x.deviceId === input.deviceId);
      if (!r) throw new NotFoundError(`결과 없음: ${input.tcId} × ${input.deviceId}`);
      if (r.verdict !== input.verdict || input.note) {
        r.history.push({ at: now(), by: currentUser, from: r.verdict, to: input.verdict, note: input.note });
      }
      r.verdict = input.verdict;
      r.decidedBy = { kind: 'human', name: currentUser };
      r.autoConfirmed = false;
      if (input.actualSummary !== undefined) r.actualSummary = input.actualSummary;
      if (input.note !== undefined) r.note = input.note;
      if (!r.executedAt) {
        r.executedAt = now();
        r.executor = currentUser;
      }
      return wait(r);
    },

    async getConsoleSession() {
      return wait(db.console);
    },
  };
}
