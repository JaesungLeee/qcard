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

/**
 * 빌드 (F-DV-05): 서명된 APK를 웹에서 올려 Storage에 둔다. 버전·빌드 번호·패키지명·서명 지문은 파일에서 읽는다.
 * 올린 뒤에는 바꾸지 않는다 — 모든 실행자가 같은 파일(`fileSha256`)을 설치한다.
 */
export const Build = z.object({
  id: z.string(),
  /** versionName */
  version: z.string(),
  /** versionCode */
  buildNumber: z.number(),
  packageName: z.string(),
  signingSha1: z.string(),
  uploadedAt: z.string(),
  signingSha256: z.string().optional(),
  signingSchemes: z.array(z.enum(['v1', 'v2', 'v3'])).optional(),
  minSdk: z.number().optional(),
  fileName: z.string().optional(),
  fileSha256: z.string().optional(),
  size: z.number().optional(),
  /** Storage 경로 (`projects/{p}/builds/{id}/{파일}`) */
  storagePath: z.string().optional(),
  uploadedBy: z.string().optional(),
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
  'takeover',
  'skip',
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
  takeover: 'Take over',
  skip: '건너뜀',
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

/** 다시 실행해 밀려난 이전 시도 (F-CY-04). 전체 내용은 `cycles/{c}/attempts/{tc}__{device}__{n}`에 보관한다 */
export const AttemptSummary = z.object({
  attempt: z.number(),
  verdict: Verdict,
  decidedBy: DecidedBy.optional(),
  executor: z.string().optional(),
  executedAt: z.string().optional(),
  runId: z.string().optional(),
  actualSummary: z.string().optional(),
  blockedReason: z.string().optional(),
});
export type AttemptSummary = z.infer<typeof AttemptSummary>;

/** 케이스 × 대상 디바이스 결과 (RunCase). verdict가 nt면 아직 수행 전. 다시 실행하면 최신 시도가 최종이다 */
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
  /** 이전 시도 (오래된 것부터) */
  previousAttempts: z.array(AttemptSummary).optional(),
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
export const PauseReason = z.enum([
  'executor',
  'network',
  'plan_limit',
  'not_logged_in',
  'claude_outdated',
  'device_locked',
  'device_disconnected',
  'host_lost',
]);
export type PauseReason = z.infer<typeof PauseReason>;
export const PAUSE_REASON_LABEL: Record<PauseReason, string> = {
  executor: '실행자',
  network: '네트워크 끊김',
  plan_limit: '플랜 한도',
  not_logged_in: 'Claude Code 로그인 필요',
  claude_outdated: 'Claude Code 업데이트 필요',
  device_locked: '디바이스 잠김',
  device_disconnected: '디바이스 연결 끊김',
  host_lost: '호스트 연결 끊김',
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
  /** 이 Run의 실행 큐 — 이어서 실행할 때 같은 케이스를 돌린다 (없으면 예전 Run: 남은 자동 케이스 전체) */
  tcIds: z.array(z.string()).optional(),
  startedAt: z.string(),
  /** 호스트가 Run 동안 RUN_HEARTBEAT_MS마다 남기는 연결 신호 (F-DV-04). 없으면 예전 Run */
  heartbeatAt: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

/** 호스트가 Run 연결 신호를 남기는 주기 */
export const RUN_HEARTBEAT_MS = 30_000;
/** 이 시간 넘게 신호가 없는 실행 중 Run은 호스트가 죽거나 끊긴 것으로 본다 */
export const RUN_STALE_MS = 90_000;
/** 실행 중인데 호스트 신호가 끊긴 Run (신호를 남기지 않은 예전 Run은 판단하지 않는다) */
export const isRunStale = (run: Pick<Run, 'status' | 'heartbeatAt'>, now: number) =>
  run.status === 'running' && !!run.heartbeatAt && now - new Date(run.heartbeatAt).getTime() > RUN_STALE_MS;

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

/**
 * 스펙 묶음 (F-IN-03·08): 앱 버전 하나의 스펙 폴더 스냅샷. 업로드 후 바꾸지 않는다.
 * 입력으로 쓰는 `<스펙 이름>/spec.md`만 Storage(`projects/{p}/specBundles/{id}/<스펙>/spec.md`)에 올린다.
 */
export const SpecBundle = z.object({
  id: z.string(),
  projectId: z.string(),
  appVersion: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  specs: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      version: z.string().optional(),
      /** Storage 경로 */
      path: z.string(),
      contentHash: z.string(),
    }),
  ),
  /** 입력으로 쓰지 않은 파일 수 (plan·tasks 등) */
  ignored: z.number(),
});
export type SpecBundle = z.infer<typeof SpecBundle>;

/** 작업 실패·일시정지 이유. 플랜 한도·Claude Code 문제는 해결 후 다시 시도한다 (F-EX-17) */
export const JobErrorKind = z.enum(['plan_limit', 'not_logged_in', 'claude_outdated', 'failed']);
export type JobErrorKind = z.infer<typeof JobErrorKind>;
export const JOB_ERROR_LABEL: Record<JobErrorKind, string> = {
  plan_limit: '플랜 한도',
  not_logged_in: 'Claude Code 로그인 필요',
  claude_outdated: 'Claude Code 업데이트 필요',
  failed: '오류',
};

export const JobStatus = z.enum(['queued', 'running', 'done', 'failed', 'paused']);
export type JobStatus = z.infer<typeof JobStatus>;
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: '호스트 대기',
  running: '생성 중',
  done: '완료',
  failed: '실패',
  paused: '일시정지',
};

/** 작업 공통 필드. 웹에서 요청하면 **요청자 본인의 호스트**가 받아 처리한다. 다른 사람의 호스트는 가져가지 않는다 */
const JobBase = {
  id: z.string(),
  projectId: z.string(),
  /** 요청자 uid (이 사용자의 호스트만 처리한다) */
  requestedBy: z.string(),
  requestedByName: z.string(),
  createdAt: z.string(),
  status: JobStatus,
  /** 처리 중인 호스트 */
  host: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.object({ kind: JobErrorKind, message: z.string() }).optional(),
};

/** QA 문서 생성 (PRD §5.2): 본인 Claude 플랜으로 */
export const QaDocJob = z.object({
  ...JobBase,
  kind: z.literal('qa_doc_generate'),
  input: z.object({ bundleId: z.string(), appVersion: z.string(), prevDocId: z.string().optional() }),
  progress: z
    .object({
      phase: z.enum(['plan', 'cases', 'save']),
      done: z.number(),
      total: z.number(),
      spec: z.string().optional(),
    })
    .optional(),
  result: z
    .object({
      docId: z.string(),
      cases: z.number(),
      generated: z.number(),
      questions: z.number(),
      newPrepFlows: z.number(),
      tokens: z.number(),
      costUsd: z.number(),
    })
    .optional(),
});
export type QaDocJob = z.infer<typeof QaDocJob>;

/**
 * 웹에서 내 호스트로 Run 시작 요청: 호스트가 받아 로컬 콘솔의 [실행]과 같은 경로로 시작한다.
 * 작업은 시작까지만 — 시작하면 완료(result.runId), 폰 잠김·다른 Run 진행 중 등으로 못 하면 실패(error)로 남는다.
 * 진행은 Run 문서로 본다
 */
export const RunCycleJob = z.object({
  ...JobBase,
  kind: z.literal('run_cycle'),
  input: z.object({
    cycleId: z.string(),
    /** 대상 디바이스 칸 (요청할 때 내 호스트에 연결된 폰으로 고른 것) */
    deviceId: z.string(),
    /** 없으면 남은 자동 케이스 전체 */
    tcIds: z.array(z.string()).optional(),
    /** 일시정지된 내 Run을 이어서 */
    resumeRunId: z.string().optional(),
  }),
  result: z.object({ runId: z.string() }).optional(),
});
export type RunCycleJob = z.infer<typeof RunCycleJob>;

/** 호스트 에이전트가 처리할 작업 (PRD §6.2·6.4) */
export const Job = z.discriminatedUnion('kind', [QaDocJob, RunCycleJob]);
export type Job = QaDocJob | RunCycleJob;

/**
 * 호스트 에이전트 연결 상태 (PRD §6.4 Host, F-DB-09). 실행 중인 호스트가 주기적으로 `lastSeen`을 갱신한다.
 * `users/{uid}/hosts/{hostId}` — 본인만 읽고 쓴다.
 */
export const Host = z.object({
  id: z.string(),
  name: z.string(),
  lastSeen: z.string(),
  /** 지금 연결된 Android 디바이스 (사이클 대상 고르기에 쓴다, F-DV-02·03) */
  devices: z
    .array(
      z.object({
        serial: z.string(),
        model: z.string(),
        osMajor: z.number(),
        resolution: z.string().optional(),
      }),
    )
    .optional(),
  claudeCode: z
    .object({
      version: z.string().optional(),
      loggedIn: z.boolean(),
      subscriptionType: z.string().optional(),
    })
    .optional(),
  /**
   * 로컬 콘솔 일회용 주소 (웹 사이드바의 [로컬 콘솔]이 새 탭으로 연다). 연결 신호마다 새로 만들고 2분 뒤·한 번 쓰면 무효.
   * 콘솔은 127.0.0.1에만 열려 있어 이 주소는 그 PC의 브라우저에서만 쓸 수 있다
   */
  consoleUrl: z.string().optional(),
});
export type Host = z.infer<typeof Host>;
/** 이 시간 안에 신호가 있으면 연결된 것으로 본다 (호스트는 30초마다 갱신) */
export const HOST_ONLINE_MS = 90_000;
