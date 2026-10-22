import { hash } from '@qcard/fixtures';
import {
  CaseBody,
  type Build,
  type CaseResult,
  type QADocument,
  type Run,
  type TestCase,
  type TestCycle,
  type Verdict,
} from '@qcard/shared';
import type { ConfirmVerdictInput, CycleSummary, QaDocSummary, QuestionResolution, VerdictCounts } from './api';

/*
 * QcardApi 구현(메모리·Firestore)이 함께 쓰는 순수 계산. 저장은 각 구현이 한다.
 */

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

export function qaDocSummary(d: QADocument, all: QADocument[]): QaDocSummary {
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
    prevAppVersion: all.find((x) => x.id === d.prevDocId)?.appVersion,
    caseCount: d.cases.length,
    changeCounts,
    approvalCounts,
    openQuestions: d.questions.filter((q) => q.status === 'open').length,
  };
}

/** 케이스 저장 (F-QD-09): 본문만 남겨 해시하고, 내용이 바뀌면 승인된 케이스는 자동 미승인 (F-QD-10) */
export function nextCase(current: TestCase, input: CaseBody, user: string, now: string): TestCase {
  // 케이스 전체 객체를 넘겨도 본문 필드만 남긴다 (해시·저장 대상)
  const body = CaseBody.parse(input);
  const contentHash = hash(body);
  const changed = contentHash !== current.contentHash;
  return {
    ...current,
    ...body,
    contentHash,
    rev: current.rev + 1,
    updatedBy: user,
    updatedAt: now,
    approval: changed && current.approval.status === 'approved' ? { status: 'pending' } : current.approval,
  };
}

/** 승인은 현재 내용 해시로 기록한다 */
export function approvalFor(
  c: TestCase,
  status: 'approved' | 'rejected' | 'pending',
  user: string,
  now: string,
): TestCase['approval'] {
  return status === 'approved'
    ? { status, by: user, at: now, contentHash: c.contentHash }
    : status === 'rejected'
      ? { status, by: user, at: now }
      : { status };
}

/** 스펙 확인 질문 처리 (F-QD-03). 바뀐 질문 목록과, 열린 질문이 더 없어 미승인으로 돌아갈 보류 케이스 */
export function resolveQuestionIn(
  d: Pick<QADocument, 'questions' | 'cases'>,
  questionId: string,
  resolution: QuestionResolution,
  user: string,
  now: string,
): { questions: QADocument['questions']; released: string[] } | undefined {
  const q = d.questions.find((x) => x.id === questionId);
  if (!q) return undefined;
  const next = {
    ...q,
    status: resolution.kind === 'answer' ? ('answered' as const) : ('proceed' as const),
    ...(resolution.kind === 'answer' ? { answer: resolution.text } : {}),
    comments: [
      ...q.comments,
      { by: user, at: now, text: resolution.kind === 'answer' ? resolution.text : '현 스펙대로 진행합니다.' },
    ],
  };
  const questions = d.questions.map((x) => (x.id === questionId ? next : x));
  const released = d.cases
    .filter((c) => c.approval.status === 'held')
    .filter((c) => !questions.some((x) => x.status === 'open' && x.caseIds.includes(c.tcId)))
    .map((c) => c.tcId);
  return { questions, released };
}

/** 사람 확정·오버라이드 (F-RP-04): 판정 변경 이력을 남긴다 */
export function confirmedResult(r: CaseResult, input: ConfirmVerdictInput, user: string, now: string): CaseResult {
  const next: CaseResult = structuredClone(r);
  if (r.verdict !== input.verdict || input.note) {
    next.history.push({ at: now, by: user, from: r.verdict, to: input.verdict, note: input.note });
  }
  next.verdict = input.verdict;
  next.decidedBy = { kind: 'human', name: user };
  next.autoConfirmed = false;
  if (input.actualSummary !== undefined) next.actualSummary = input.actualSummary;
  if (input.note !== undefined) next.note = input.note;
  if (!next.executedAt) {
    next.executedAt = now;
    next.executor = user;
  }
  return next;
}

export function cycleSummary(
  cycle: TestCycle,
  build: Build,
  docVersion: string,
  results: CaseResult[],
  runs: Run[],
): CycleSummary {
  const counts = countVerdicts(results);
  return {
    cycle,
    build,
    docVersion,
    counts,
    total: results.length,
    done: results.length - counts.nt,
    passRate: passRate(counts),
    activeRuns: runs.filter((r) => r.status === 'running' || r.status === 'paused'),
  };
}

/** 진행 중 사이클: 끝나지 않았고 로컬 실행 묶음이 아닌 것 */
export const isActiveCycle = (c: TestCycle) => !c.period.end && c.origin !== 'local_run';
