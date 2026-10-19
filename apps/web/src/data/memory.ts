import { createFixtureDb, hash, PEOPLE, type FixtureDb } from '@qcard/fixtures';
import { CaseBody, type CaseResult, type TestCase, type Verdict } from '@qcard/shared';
import {
  ConflictError,
  NotFoundError,
  type ConfirmVerdictInput,
  type CycleDetail,
  type CycleSummary,
  type QaDocSummary,
  type QcardApi,
  type VerdictCounts,
} from './api';

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

/** fixture 위의 메모리 구현. 새로고침하면 처음 상태로 돌아간다. */
export function createMemoryApi(options: { db?: FixtureDb; currentUser?: string; latencyMs?: number } = {}): QcardApi {
  const db = options.db ?? createFixtureDb();
  const currentUser = options.currentUser ?? PEOPLE.lead;
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

  return {
    currentUser,

    async listProjects() {
      return wait(db.projects);
    },
    async getProject(projectId) {
      const p = db.projects.find((x) => x.id === projectId);
      if (!p) throw new NotFoundError(`프로젝트 없음: ${projectId}`);
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
