import type { ConsoleSession, PrepFlow } from '@qcard/fixtures';
import type {
  Build,
  CaseBody,
  CaseResult,
  Defect,
  Project,
  QADocument,
  Run,
  TestCase,
  TestCycle,
  Verdict,
} from '@qcard/shared';

/**
 * 웹이 데이터에 접근하는 유일한 경로. 지금은 fixture 메모리 구현(`memory.ts`),
 * 나중에 같은 인터페이스로 Firestore 구현을 끼운다. 화면 코드는 이 인터페이스만 안다.
 */
export interface QcardApi {
  readonly currentUser: string;

  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;

  listQaDocs(projectId: string): Promise<QaDocSummary[]>;
  getQaDoc(docId: string): Promise<QADocument>;
  /** 낙관적 잠금 (F-QD-09): `expectedRev`가 최신이 아니면 `ConflictError` */
  updateCase(docId: string, tcId: string, body: CaseBody, expectedRev: number): Promise<TestCase>;
  /** 승인·반려 (F-QD-10). 승인은 현재 내용 해시로 기록된다. */
  setApproval(docId: string, tcIds: string[], status: 'approved' | 'rejected' | 'pending'): Promise<void>;
  /** 스펙 확인 질문 처리 (F-QD-03): 답변하거나 "현 스펙대로 진행"으로 보류 해제 */
  resolveQuestion(docId: string, questionId: string, resolution: QuestionResolution): Promise<void>;
  commentQuestion(docId: string, questionId: string, text: string): Promise<void>;
  listPrepFlows(projectId: string): Promise<PrepFlow[]>;

  listCycles(projectId: string): Promise<CycleSummary[]>;
  getCycle(cycleId: string): Promise<CycleDetail>;
  /** 사람 확정·오버라이드 (F-RP-04). 판정 변경 이력이 쌓인다. */
  confirmVerdict(input: ConfirmVerdictInput): Promise<CaseResult>;

  /** 로컬 콘솔 (호스트 에이전트가 제공할 데이터) */
  getConsoleSession(): Promise<ConsoleSession>;
}

export type QaDocSummary = {
  id: string;
  appVersion: string;
  createdAt: string;
  prevAppVersion?: string;
  caseCount: number;
  changeCounts: Record<TestCase['change'], number>;
  approvalCounts: Record<TestCase['approval']['status'], number>;
  openQuestions: number;
};

export type QuestionResolution = { kind: 'answer'; text: string } | { kind: 'proceed' };

export type VerdictCounts = Record<Verdict, number>;

export type CycleSummary = {
  cycle: TestCycle;
  build: Build;
  docVersion: string;
  /** 대상 디바이스 칸 전체 기준 */
  counts: VerdictCounts;
  total: number;
  done: number;
  passRate: number;
  activeRuns: Run[];
};

export type CycleDetail = {
  cycle: TestCycle;
  build: Build;
  doc: QADocument;
  /** 스냅샷에 고정된 케이스 (문서에서 스냅샷 해시로 찾은 것) */
  cases: TestCase[];
  results: CaseResult[];
  defects: Defect[];
  runs: Run[];
};

export type ConfirmVerdictInput = {
  cycleId: string;
  tcId: string;
  deviceId: string;
  verdict: Verdict;
  note?: string;
  actualSummary?: string;
};

export class ConflictError extends Error {
  constructor(readonly latest: TestCase) {
    super(`${latest.tcId}: 다른 사람이 먼저 저장했습니다 (rev ${latest.rev}, ${latest.updatedBy ?? '알 수 없음'})`);
  }
}

export class NotFoundError extends Error {}
