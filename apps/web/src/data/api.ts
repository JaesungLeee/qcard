import type { ConsoleSession } from '@qcard/fixtures';
import type {
  Build,
  CaseBody,
  PrepFlow,
  CaseResult,
  Defect,
  Invitation,
  Member,
  Project,
  Role,
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

  /** 내가 멤버인 프로젝트 (F-TM-02). 다른 프로젝트는 보이지 않는다 */
  listMyProjects(): Promise<ProjectSummary[]>;
  /** 멤버가 아니면 `PermissionError` */
  getProject(projectId: string): Promise<Project>;
  /** 누구나 만들 수 있고 만든 사람이 Admin (F-TM-09). 데이터 처리 안내 확인 필수 (F-TM-13) */
  createProject(input: NewProjectInput): Promise<Project>;

  /** 내 역할 (멤버가 아니면 undefined) */
  myRole(projectId: string): Promise<Role | undefined>;
  listMembers(projectId: string): Promise<Member[]>;
  /** Admin만. Admin이 0명이 되면 `RuleError` (F-TM-03) */
  setMemberRole(projectId: string, user: string, role: Role): Promise<void>;
  /** Admin만 다른 멤버를 내보낸다. 남긴 판정·이력은 보존 */
  removeMember(projectId: string, user: string): Promise<void>;

  /** 대기 중 초대 (만료 포함, Admin만) */
  listInvitations(projectId: string): Promise<Invitation[]>;
  /** Admin만. github가 없으면 링크 초대 (F-TM-10) */
  createInvitation(projectId: string, input: { role: Role; github?: string }): Promise<Invitation>;
  revokeInvitation(projectId: string, invitationId: string): Promise<void>;
  /** 초대 링크로 들어온 사람에게 보여 줄 정보 */
  getInvitation(token: string): Promise<InvitationView>;
  /** 데이터 처리 안내 확인 후 수락하면 멤버가 된다. 만료·취소·다른 사람 앞 초대는 `RuleError` */
  acceptInvitation(token: string, input: { dataNoticeAck: boolean }): Promise<Project>;

  /** 탈퇴 (F-TM-11). 마지막 Admin은 Admin을 넘긴 뒤에만, 혼자면 탈퇴 대신 삭제 */
  leaveProject(projectId: string): Promise<void>;
  /** Admin만, 이름을 입력해 확인. 유예 기간 동안 삭제 예정으로 남는다 (F-TM-12) */
  deleteProject(projectId: string, confirmName: string): Promise<Project>;
  restoreProject(projectId: string): Promise<Project>;

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

export type ProjectSummary = {
  project: Project;
  role: Role;
  memberCount: number;
  activeCycles: number;
};

export type NewProjectInput = { name: string; appName: string; packageName: string; dataNoticeAck: boolean };

export type InvitationView = {
  invitation: Invitation;
  project: Project;
  /** pending 중에서도 지금 수락할 수 있는지: 만료·취소·이미 멤버·다른 사람 앞 */
  state: 'pending' | 'expired' | 'revoked' | 'accepted' | 'member' | 'other-user';
};

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

/** 권한이 없다 (멤버가 아니거나 역할이 부족). Firestore 보안 규칙이 같은 규칙을 강제한다 */
export class PermissionError extends Error {}

/** 규칙에 어긋난 요청 (마지막 Admin, 만료된 초대 등). 메시지를 그대로 화면에 보여 준다 */
export class RuleError extends Error {}
