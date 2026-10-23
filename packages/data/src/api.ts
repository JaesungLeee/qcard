import type { ConsoleSession } from '@qcard/fixtures';
import type {
  Build,
  CaseBody,
  PrepFlow,
  CaseResult,
  Defect,
  Host,
  HostConnection,
  HostCredential,
  Invitation,
  Job,
  QaDocJob,
  RunCycleJob,
  InvitationState,
  Member,
  NewProjectInput,
  Project,
  Role,
  QADocument,
  Run,
  TestCase,
  TestCycle,
  Verdict,
} from '@qcard/shared';
import { MembershipError } from '@qcard/shared';

/**
 * 웹이 데이터에 접근하는 유일한 경로. 지금은 fixture 메모리 구현(`memory.ts`),
 * 나중에 같은 인터페이스로 Firestore 구현을 끼운다. 화면 코드는 이 인터페이스만 안다.
 */
export interface QcardApi {
  /** 로그인 사용자 표시 이름 */
  readonly currentUser: string;
  /** 로그인 사용자 id (멤버 키) */
  readonly currentUid: string;

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
  setMemberRole(projectId: string, uid: string, role: Role): Promise<void>;
  /** Admin만 다른 멤버를 내보낸다. 남긴 판정·이력은 보존 */
  removeMember(projectId: string, uid: string): Promise<void>;

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
  getQaDoc(ref: DocRef): Promise<QADocument>;
  /** 낙관적 잠금 (F-QD-09): `expectedRev`가 최신이 아니면 `ConflictError` */
  updateCase(ref: DocRef, tcId: string, body: CaseBody, expectedRev: number): Promise<TestCase>;
  /** 승인·반려 (F-QD-10). 승인은 현재 내용 해시로 기록된다. */
  setApproval(ref: DocRef, tcIds: string[], status: 'approved' | 'rejected' | 'pending'): Promise<void>;
  /** 스펙 확인 질문 처리 (F-QD-03): 답변하거나 "현 스펙대로 진행"으로 보류 해제 */
  resolveQuestion(ref: DocRef, questionId: string, resolution: QuestionResolution): Promise<void>;
  commentQuestion(ref: DocRef, questionId: string, text: string): Promise<void>;
  listPrepFlows(projectId: string): Promise<PrepFlow[]>;

  /**
   * QA 문서 생성 요청 (PRD §5.2): 스펙 묶음(`<스펙>/spec.md`만)을 변경 불가 스냅샷으로 올리고 Job을 만든다.
   * 처리는 요청자 본인의 호스트 에이전트가 본인 Claude 플랜으로 한다. Admin·QA만
   */
  requestQaDoc(projectId: string, input: RequestQaDocInput): Promise<QaDocJob>;
  /**
   * 내 호스트에서 Run 시작 (웹 → 작업 → 호스트). 호스트가 받아 시작하면 작업이 완료되고 `result.runId`가 생긴다.
   * 폰이 잠겼거나 다른 Run이 진행 중이면 호스트가 실패로 남긴다. Admin·QA만
   */
  requestRun(projectId: string, input: RequestRunInput): Promise<RunCycleJob>;
  /** 최근 작업 (새것 먼저) */
  listJobs(projectId: string): Promise<Job[]>;
  /** 실패·일시정지한 내 작업을 다시 대기열에 넣는다 */
  retryJob(projectId: string, jobId: string): Promise<void>;
  /** 내 호스트 에이전트 (연결 상태는 `lastSeen`으로 판단, HOST_ONLINE_MS) */
  myHosts(): Promise<Host[]>;
  /** 내 계정에 연결된 PC (F-TM-14). 연결 신호(myHosts)는 켜져 있을 때만 있다 */
  myHostConnections(): Promise<HostConnection[]>;
  /** [이 PC 연결]: 호스트 자격을 만든다. 비밀값은 여기서 한 번만 받아 그 PC의 호스트 에이전트에 넘긴다 */
  connectHost(name: string): Promise<HostCredential>;
  /** 연결 해제: 그 PC는 바로 읽기·쓰기가 막히고, 다시 쓰려면 다시 연결해야 한다 */
  disconnectHost(hostId: string): Promise<void>;

  /** 올린 빌드 (새것 먼저) */
  listBuilds(projectId: string): Promise<Build[]>;
  /**
   * 빌드 올리기 (F-DV-05): 서명된 APK만. 패키지·버전·서명 지문은 파일에서 읽고, 파일은 그대로 Storage에 둔다.
   * 서명이 없거나 APK가 아니면 `RuleError`, 같은 파일을 이미 올렸으면 `RuleError`. Admin·QA만
   */
  uploadBuild(projectId: string, file: { name: string; bytes: Uint8Array }): Promise<Build>;
  /**
   * 사이클 만들기 (F-CY-01·02): QA 문서의 승인된 케이스를 스냅샷으로 고정하고, 케이스 × 대상 디바이스 칸을 N/T로 만든다.
   * 승인된 케이스가 없거나 대상이 없으면 `RuleError`. Admin·QA만
   */
  createCycle(projectId: string, input: NewCycleInput): Promise<TestCycle>;

  listCycles(projectId: string): Promise<CycleSummary[]>;
  getCycle(ref: CycleRef): Promise<CycleDetail>;
  /**
   * 사이클 실시간 구독 (F-CY-05·F-DB-07): 처음 한 번과, 사이클·결과·Run·결함이 바뀔 때마다 최신 내용을 준다.
   * 다른 실행자의 진행·판정도 들어온다. 돌려준 함수로 구독을 끊는다
   */
  watchCycle(ref: CycleRef, onChange: (detail: CycleDetail) => void, onError?: (e: unknown) => void): () => void;
  /** 사람 확정·오버라이드 (F-RP-04). 판정 변경 이력이 쌓인다. */
  confirmVerdict(input: ConfirmVerdictInput): Promise<CaseResult>;

  /** Storage에 올린 스크린샷(`kind: 'storage'`)을 화면에 띄울 주소. 로그인 상태로 읽는다 */
  screenshotUrl(path: string): Promise<string>;

  /** 로컬 콘솔 (호스트 에이전트가 제공할 데이터) */
  getConsoleSession(): Promise<ConsoleSession>;
}

/** 웹에서 내 호스트로 Run 시작 요청 */
export type RequestRunInput = RunCycleJob['input'];

/** 업로드한 파일 (폴더·ZIP에서 읽은 상대 경로 + 내용). `<스펙>/spec.md`가 아닌 파일은 올리지 않는다 */
export type RequestQaDocInput = {
  appVersion: string;
  files: { path: string; content: string }[];
  /** 비교할 이전 QA 문서 (없으면 모든 케이스가 신규) */
  prevDocId?: string;
};

export type NewCycleInput = {
  name: string;
  docId: string;
  buildId: string;
  /** 모델 + OS 메이저. 같은 모델·OS 메이저의 실제 디바이스는 같은 대상으로 본다 */
  targets: { model: string; osMajor: number; resolution?: string }[];
  serverEnv: TestCycle['serverEnv'];
};

/** QA 문서·사이클은 프로젝트 아래에 있다 (Firestore `projects/{p}/qaDocs/{d}`) */
export type DocRef = { projectId: string; docId: string };
export type CycleRef = { projectId: string; cycleId: string };

export type ProjectSummary = {
  project: Project;
  role: Role;
  memberCount: number;
  activeCycles: number;
};

export type { NewProjectInput };

export type InvitationView = {
  invitation: Invitation;
  project: Project;
  /** pending 중에서도 지금 수락할 수 있는지: 만료·취소·이미 멤버·다른 사람 앞 */
  state: InvitationState;
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
  /** 스냅샷에 고정된 케이스 (사이클을 만들 때 복사한 내용) */
  cases: TestCase[];
  results: CaseResult[];
  defects: Defect[];
  runs: Run[];
};

export type ConfirmVerdictInput = {
  projectId: string;
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

/** 공용 규칙(@qcard/shared membership)의 오류를 화면용 오류로 바꾼다. 나머지는 그대로 */
export function toApiError(e: unknown): unknown {
  if (!(e instanceof MembershipError)) return e;
  if (e.kind === 'permission') return new PermissionError(e.message);
  if (e.kind === 'not_found') return new NotFoundError(e.message);
  return new RuleError(e.message);
}
