import { z } from 'zod';
import { Verdict } from './verdict';

/** 도메인 스키마 (PRD §6.4). Firestore 문서·fixture·LLM 구조화 출력이 같은 정의를 쓴다. */

/** 프로젝트 = QA 대시보드 1개(앱 하나). 멤버·권한·데이터의 단위 (F-TM-02) */
export const Project = z.object({
  id: z.string(),
  name: z.string(),
  appName: z.string(),
  packageName: z.string(),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
  /** 삭제 요청 시각. 유예 기간 동안은 복구할 수 있다 (F-TM-12) */
  deletedAt: z.string().optional(),
  /** 이 시각이 지나면 데이터·비밀값을 영구 삭제한다 */
  purgeAt: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

/** 역할 (F-TM-03). 프로젝트에는 Admin이 항상 1명 이상 */
export const Role = z.enum(['admin', 'qa', 'viewer']);
export type Role = z.infer<typeof Role>;
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', qa: 'QA', viewer: 'Viewer' };
export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: '멤버·초대·프로젝트 설정과 삭제',
  qa: 'QA 문서 편집·승인, 실행, 판정 확정',
  viewer: '조회만',
};

export const Member = z.object({
  projectId: z.string(),
  /** 로그인 사용자 id (Firebase Auth uid). 멤버를 가리키는 키 */
  uid: z.string(),
  /** 표시 이름 */
  user: z.string(),
  github: z.string(),
  role: Role,
  joinedAt: z.string(),
  /** 데이터 처리 안내를 확인한 시각 (F-TM-13) */
  dataNoticeAckAt: z.string(),
});
export type Member = z.infer<typeof Member>;

/** 초대 (F-TM-10). GitHub 사용자명으로 보내거나 링크로 나눈다. 만료는 expiresAt으로 판단한다 */
export const Invitation = z.object({
  id: z.string(),
  projectId: z.string(),
  role: Role,
  invitedBy: z.string(),
  /** 없으면 링크 초대 (링크를 가진 사람 누구나 수락) */
  github: z.string().optional(),
  token: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked']),
});
export type Invitation = z.infer<typeof Invitation>;

/** 초대 만료 (F-TM-10) */
export const INVITE_TTL_DAYS = 7;
/** 프로젝트 삭제 유예 기간 (F-TM-12) */
export const DELETE_GRACE_DAYS = 30;

/** 프로젝트 생성·초대 수락 때 확인받는 데이터 처리 안내 (F-TM-13, PRD §8) */
export const DATA_NOTICE =
  '스펙 문서와 실행 중 디바이스 화면(스크린샷·화면 구조)은 실행한 사람 본인의 Claude 계정으로 Anthropic에 전송되고, 그 계정의 데이터 정책(개인정보 설정)을 따릅니다. 개인 플랜에는 데이터 미보존(ZDR)이 없으니, Claude 설정에서 학습 사용을 끄는 것을 권합니다.';

/** 원본 스펙 근거: 스펙 파일·헤딩 경로·줄 범위 (F-QD-02) */
export const SpecRef = z.object({
  spec: z.string(),
  file: z.string(),
  headingPath: z.array(z.string()),
  lineStart: z.number(),
  lineEnd: z.number(),
});
export type SpecRef = z.infer<typeof SpecRef>;

/** `<스펙 이름>/FR-xxx` 또는 `<스펙 이름>/UX-xxx` */
export const Requirement = z.object({
  id: z.string(),
  spec: z.string(),
  text: z.string(),
  sourceRef: SpecRef,
});
export type Requirement = z.infer<typeof Requirement>;

export const CaseChange = z.enum(['new', 'changed', 'removed', 'same']);
export type CaseChange = z.infer<typeof CaseChange>;
export const CHANGE_LABEL: Record<CaseChange, string> = { new: '신규', changed: '변경', removed: '삭제', same: '동일' };

export const TestType = z.enum(['functional', 'ui', 'exception', 'boundary', 'state', 'permission', 'compat']);
export type TestType = z.infer<typeof TestType>;
export const TEST_TYPE_LABEL: Record<TestType, string> = {
  functional: '기능',
  ui: 'UI',
  exception: '예외',
  boundary: '경계값',
  state: '상태전이',
  permission: '권한',
  compat: '호환성',
};

export const Priority = z.enum(['high', 'medium', 'low']);
export type Priority = z.infer<typeof Priority>;
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export const Platform = z.enum(['common', 'android', 'ios']);
export type Platform = z.infer<typeof Platform>;
export const PLATFORM_LABEL: Record<Platform, string> = { common: '공통', android: 'AOS', ios: 'iOS' };

export const ExecMode = z.enum(['auto', 'manual']);
export type ExecMode = z.infer<typeof ExecMode>;

export const CaseStep = z.object({ text: z.string(), manual: z.boolean().default(false) });
export type CaseStep = z.infer<typeof CaseStep>;

/** 검증 포인트 (F-EX-03): QA 문서 생성 시 정의·승인된다. */
export const PointCompare = z.enum(['text_exists', 'visible', 'not_visible', 'count', 'size_dp', 'screen', 'state']);
export type PointCompare = z.infer<typeof PointCompare>;
export const POINT_COMPARE_LABEL: Record<PointCompare, string> = {
  text_exists: '텍스트 존재',
  visible: '표시',
  not_visible: '비표시',
  count: '개수',
  size_dp: '크기(dp)',
  screen: '화면',
  state: '앱 상태',
};
export const PointMethod = z.enum(['tree', 'vision']);
export type PointMethod = z.infer<typeof PointMethod>;
export const POINT_METHOD_LABEL: Record<PointMethod, string> = { tree: '접근성 트리', vision: '비전' };

export const VerificationPoint = z.object({
  id: z.string(),
  target: z.string(),
  compare: PointCompare,
  expected: z.string(),
  method: PointMethod,
});
export type VerificationPoint = z.infer<typeof VerificationPoint>;

/** 준비 플로우 (F-PF-01): 공통 사전조건. env는 코드가 수행(앱 데이터 초기화 + 실행), 나머지는 Agent가 UI로 수행 */
export const PrepFlow = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['login', 'data_state', 'env']),
  check: z.string(),
  steps: z.array(z.string()),
});
export type PrepFlow = z.infer<typeof PrepFlow>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'held']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: '미승인',
  approved: '승인',
  rejected: '반려',
  held: '보류',
};

export const Approval = z.object({
  status: ApprovalStatus,
  by: z.string().optional(),
  at: z.string().optional(),
  /** 승인 당시 내용 해시 (F-QD-10). 내용이 바뀌면 자동 미승인 */
  contentHash: z.string().optional(),
});
export type Approval = z.infer<typeof Approval>;

/** 케이스 본문 — 편집 대상 필드. `previous`는 "변경" 케이스의 이전 버전 블록(diff용). */
export const CaseBody = z.object({
  title: z.string(),
  preconditions: z.array(z.string()),
  prepFlowIds: z.array(z.string()),
  cleanState: z.boolean(),
  accountRole: z.string().optional(),
  data: z.string().optional(),
  steps: z.array(CaseStep),
  verificationPoints: z.array(VerificationPoint),
  priority: Priority,
  type: TestType,
  platform: Platform,
  mode: ExecMode,
});
export type CaseBody = z.infer<typeof CaseBody>;

export const TestCase = CaseBody.extend({
  tcId: z.string(),
  /** 출처 ID: `<스펙 이름>/TS-xxx` · `EC-xxx` */
  sourceId: z.string(),
  /** 출처 행(+관련 요구사항) 내용 해시. 다음 버전에서 같으면 이 케이스를 그대로 복사한다 (F-QD-08) */
  sourceHash: z.string().optional(),
  requirementIds: z.array(z.string()),
  /** 기능(스펙) / 세부 기능(유저 플로우) */
  feature: z.string(),
  subFeature: z.string(),
  sourceRef: SpecRef,
  change: CaseChange,
  previous: CaseBody.optional(),
  contentHash: z.string(),
  /** 낙관적 잠금용 버전 (F-QD-09) */
  rev: z.number(),
  approval: Approval,
  questionIds: z.array(z.string()),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const SpecQuestion = z.object({
  id: z.string(),
  requirementId: z.string(),
  caseIds: z.array(z.string()),
  text: z.string(),
  assignee: z.string(),
  status: z.enum(['open', 'answered', 'proceed']),
  answer: z.string().optional(),
  comments: z.array(z.object({ by: z.string(), at: z.string(), text: z.string() })),
});
export type SpecQuestion = z.infer<typeof SpecQuestion>;

/** 스펙 보강 제안 (F-QD-05) — 케이스가 아니다. */
export const SpecSuggestion = z.object({
  id: z.string(),
  requirementId: z.string(),
  technique: z.enum(['normal', 'negative', 'boundary', 'partition', 'state', 'role']),
  text: z.string(),
});
export type SpecSuggestion = z.infer<typeof SpecSuggestion>;
export const TECHNIQUE_LABEL: Record<SpecSuggestion['technique'], string> = {
  normal: '정상 플로우',
  negative: '예외/부정',
  boundary: '경계값',
  partition: '동등분할',
  state: '상태 전이',
  role: '권한/역할',
};

export const QADocument = z.object({
  id: z.string(),
  projectId: z.string(),
  appVersion: z.string(),
  specBundleId: z.string(),
  prevDocId: z.string().optional(),
  createdAt: z.string(),
  specs: z.array(z.object({ name: z.string(), feature: z.string(), file: z.string() })),
  requirements: z.array(Requirement),
  cases: z.array(TestCase),
  questions: z.array(SpecQuestion),
  suggestions: z.array(SpecSuggestion),
});
export type QADocument = z.infer<typeof QADocument>;

export const Build = z.object({
  id: z.string(),
  version: z.string(),
  buildNumber: z.number(),
  packageName: z.string(),
  signingSha1: z.string(),
  uploadedAt: z.string(),
});
export type Build = z.infer<typeof Build>;

/** 사이클 대상 디바이스: 모델 + OS 메이저 (F-CY-01) */
export const TargetDevice = z.object({
  id: z.string(),
  model: z.string(),
  osMajor: z.number(),
  resolution: z.string(),
  label: z.string(),
});
export type TargetDevice = z.infer<typeof TargetDevice>;

/** 스크린샷: 실제 이미지(Storage URL, w·h는 디바이스 px) 또는 fixture용 목업 화면 키 */
export const Screenshot = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string(), w: z.number().optional(), h: z.number().optional() }),
  /** Cloud Storage 경로. 보안 규칙(멤버만)을 거쳐 로그인 상태로 읽는다 — 토큰이 든 다운로드 URL을 남기지 않는다 */
  z.object({ kind: z.literal('storage'), path: z.string(), w: z.number().optional(), h: z.number().optional() }),
  z.object({ kind: z.literal('mock'), screen: z.string(), state: z.record(z.string(), z.string()).optional() }),
]);
export type Screenshot = z.infer<typeof Screenshot>;

/** 화면 위 사각형 (디바이스 px, 좌상단 기준) */
export const Bounds = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Bounds = z.infer<typeof Bounds>;

export const StepAction = z.enum([
  'tap',
  'input',
  'swipe',
  'back',
  'home',
  'restart',
  'reopen',
  'wait',
  'env',
  'manual',
  'verify',
]);
export type StepAction = z.infer<typeof StepAction>;
export const STEP_ACTION_LABEL: Record<StepAction, string> = {
  tap: '탭',
  input: '입력',
  swipe: '스와이프',
  back: '뒤로가기',
  home: '홈',
  restart: '앱 재시작',
  reopen: '앱 다시 열기',
  wait: '대기',
  env: '환경 조작',
  manual: '수동',
  verify: '검증',
};

/** 스텝 타임라인 한 줄 (F-EX-06) */
export const ExecStep = z.object({
  index: z.number(),
  action: StepAction,
  target: z.object({ label: z.string(), elementId: z.string().optional(), bounds: Bounds.optional() }).optional(),
  /** 스와이프 시작·끝 (디바이스 px) */
  swipe: z.object({ from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]) }).optional(),
  input: z.string().optional(),
  intent: z.string(),
  screenshot: Screenshot,
  videoTs: z.number(),
  durationMs: z.number(),
  risk: z.object({ kind: z.string(), planned: z.boolean(), approvedBy: z.string().optional() }).optional(),
  caseStepIndex: z.number().optional(),
});
export type ExecStep = z.infer<typeof ExecStep>;

export const PointResult = z.object({
  pointId: z.string(),
  expected: z.string(),
  method: PointMethod,
  targetElement: z.string().optional(),
  /** 대상 요소 위치 (증거 화면 위 강조용) */
  targetBounds: Bounds.optional(),
  observed: z.string(),
  result: z.enum(['match', 'mismatch', 'unknown']),
  evidence: Screenshot,
  reason: z.string(),
});
export type PointResult = z.infer<typeof PointResult>;
export const POINT_RESULT_LABEL: Record<PointResult['result'], string> = {
  match: '일치',
  mismatch: '불일치',
  unknown: '판단불가',
};

/** 자동 확정 조건 (F-RP-03) */
export const AutoConfirmCondition = z.enum(['all_match', 'tree_only', 'no_takeover', 'within_retry']);
export type AutoConfirmCondition = z.infer<typeof AutoConfirmCondition>;
export const AUTO_CONFIRM_LABEL: Record<AutoConfirmCondition, string> = {
  all_match: '모든 검증 포인트 일치',
  tree_only: '모든 포인트를 접근성 트리로 확인',
  no_takeover: 'Take over·스텝 건너뛰기 없음',
  within_retry: '자가 복구 재시도 한도 이내',
};

export const DecidedBy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent') }),
  z.object({ kind: z.literal('human'), name: z.string() }),
]);
export type DecidedBy = z.infer<typeof DecidedBy>;

export const VerdictChange = z.object({
  at: z.string(),
  by: z.string(),
  from: Verdict,
  to: Verdict,
  note: z.string().optional(),
});
export type VerdictChange = z.infer<typeof VerdictChange>;

/** 케이스 × 대상 디바이스 결과 (RunCase). verdict가 nt면 아직 수행 전. */
export const CaseResult = z.object({
  tcId: z.string(),
  deviceId: z.string(),
  verdict: Verdict,
  /** Agent가 낸 판정 (사람 확정 전 원래 값) */
  agentVerdict: Verdict.optional(),
  decidedBy: DecidedBy.optional(),
  autoConfirmed: z.boolean(),
  unmetConditions: z.array(AutoConfirmCondition),
  blockedReason: z.string().optional(),
  actualSummary: z.string().optional(),
  attempts: z.number(),
  executor: z.string().optional(),
  executedAt: z.string().optional(),
  osBuild: z.string().optional(),
  defectId: z.string().optional(),
  note: z.string().optional(),
  runId: z.string().optional(),
  steps: z.array(ExecStep),
  points: z.array(PointResult),
  history: z.array(VerdictChange),
  tokens: z.number().optional(),
  costUsd: z.number().optional(),
});
export type CaseResult = z.infer<typeof CaseResult>;

export const Severity = z.enum(['critical', 'major', 'minor', 'trivial']);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  trivial: 'Trivial',
};

export const Defect = z.object({
  id: z.string(),
  title: z.string(),
  severity: Severity,
  tcId: z.string(),
  deviceId: z.string(),
  repro: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  status: z.enum(['open', 'fixed', 'closed']),
  trackerUrl: z.string().optional(),
});
export type Defect = z.infer<typeof Defect>;

/** Run 일시정지 이유 (F-EX-13·17). 플랜 한도·로그인은 실행자의 Claude Code 상태 */
export const PauseReason = z.enum(['executor', 'network', 'plan_limit', 'not_logged_in', 'claude_outdated']);
export type PauseReason = z.infer<typeof PauseReason>;
export const PAUSE_REASON_LABEL: Record<PauseReason, string> = {
  executor: '실행자',
  network: '네트워크 끊김',
  plan_limit: '플랜 한도',
  not_logged_in: 'Claude Code 로그인 필요',
  claude_outdated: 'Claude Code 업데이트 필요',
};

export const Run = z.object({
  id: z.string(),
  cycleId: z.string(),
  executor: z.string(),
  deviceId: z.string(),
  status: z.enum(['running', 'paused', 'done', 'aborted']),
  /** status가 paused일 때 */
  pauseReason: PauseReason.optional(),
  currentTcId: z.string().optional(),
  startedAt: z.string(),
});
export type Run = z.infer<typeof Run>;

export const TestCycle = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  docId: z.string(),
  buildId: z.string(),
  targets: z.array(TargetDevice),
  period: z.object({ start: z.string(), end: z.string().optional() }),
  serverEnv: z.enum(['dev', 'stage', 'prod']),
  /** 케이스 스냅샷 (F-CY-02) */
  snapshot: z.array(z.object({ tcId: z.string(), contentHash: z.string() })),
  accounts: z.array(z.object({ role: z.string(), id: z.string() })),
  createdBy: z.string(),
  /** local_run: 호스트에서 돌린 실행 결과를 사이클로 묶어 보여 주는 것 (개발용) */
  origin: z.enum(['cycle', 'local_run']).optional(),
});
export type TestCycle = z.infer<typeof TestCycle>;

/** 로컬 콘솔: Agent 사고 로그 한 줄 (F-DB-04) */
export const ThoughtEntry = z.object({
  at: z.number(),
  kind: z.enum(['observe', 'decide', 'act', 'verify', 'recover', 'system']),
  text: z.string(),
});
export type ThoughtEntry = z.infer<typeof ThoughtEntry>;
