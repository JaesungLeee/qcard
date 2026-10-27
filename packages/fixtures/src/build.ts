import type {
  AutoConfirmCondition,
  Build,
  CaseBody,
  CaseResult,
  ClaudeCodeState,
  ConsoleDevice,
  ConsoleQueueItem,
  Defect,
  ExecStep,
  Invitation,
  Job,
  Member,
  PointResult,
  PrepFlow,
  Project,
  QADocument,
  Requirement,
  Role,
  Run,
  Screenshot,
  SpecQuestion,
  SpecSuggestion,
  TargetDevice,
  TestAccount,
  TestCase,
  TestCycle,
  ThoughtEntry,
  VerificationPoint,
  Verdict,
  JobPlanRow,
  QaDocJob,
  QaDocJobDraft,
  QaDocJobEvent,
  QaDocJobSpec,
} from '@qcard/shared';
import { CaseBody as CaseBodySchema, hash } from '@qcard/shared';
import { rowHash } from '@qcard/spec';
import raw from './data/onboarding-flow.json';
import generatedPoints from './data/onboarding-points.json';
import { APP_PACKAGE } from './device';
import { SCREENS, element, type MockElement } from './screens';

type Row = {
  kind: 'TS' | 'EC';
  id: string;
  title: string;
  given: string;
  when: string;
  then: string;
  frs: string[];
  flow: string;
  line: number;
};
const SPEC = raw.spec;
const SPEC_FILE = `docs/specs/${SPEC}/spec.md`;
const FEATURE = raw.feature;
const rows = raw.rows as Row[];
const GENERATED = generatedPoints.points as Record<string, Omit<VerificationPoint, 'id'>[]>;

// ---------------------------------------------------------------- 사람·시각 (모두 고정값)

export const PEOPLE = {
  lead: '이재성',
  qa: '김민지',
  planner: '박도윤',
  dev: '최서준',
} as const;

const T = (day: number, hh = 10, mm = 0) =>
  `2026-10-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;

// ---------------------------------------------------------------- 유틸

/** 결정적 내용 해시 (@qcard/shared). fixture 이용처를 위해 다시 내보낸다 */
export { hash };

const reqId = (id: string) => `${SPEC}/${id}`;
const tcIdOf = (n: number) => `TC-ONBOARDING-${String(n).padStart(3, '0')}`;
const center = (el: MockElement): [number, number] => [
  Math.round(el.bounds.x + el.bounds.w / 2),
  Math.round(el.bounds.y + el.bounds.h / 2),
];
const shot = (screen: string, state?: Record<string, string>): Screenshot => ({ kind: 'mock', screen, state });

// ---------------------------------------------------------------- 준비 플로우

export const PREP_FLOWS: PrepFlow[] = [
  {
    id: 'pf-clean',
    name: '빈 사용자 (앱 데이터 초기화)',
    kind: 'env',
    check: '스플래시 뒤 닉네임 설정 스텝이 열린다',
    steps: ['앱 데이터 초기화(pm clear)', '앱 실행'],
  },
  {
    id: 'pf-habit',
    name: '온보딩 · 첫 습관 만들기 스텝',
    kind: 'data_state',
    check: '첫 습관 만들기 스텝에 [건너뛰기]가 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]'],
  },
  {
    id: 'pf-mate',
    name: '온보딩 · 메이트 초대 스텝',
    kind: 'data_state',
    check: '`함께할 메이트를 불러볼까요?`가 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 이름 `물 2L 마시기` 입력', '[습관 만들기]'],
  },
  {
    id: 'pf-guide',
    name: '온보딩 · 사용법 안내 스텝 1',
    kind: 'data_state',
    check: '제목 `사용법 안내`과 STEP 1이 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 [건너뛰기]'],
  },
  {
    id: 'pf-done',
    name: '온보딩 완료',
    kind: 'data_state',
    check: '오늘 탭과 바텀 네비게이션이 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 [건너뛰기]', '사용법 안내 [건너뛰기]'],
  },
];

/** Given 문장으로 케이스가 시작할 화면과 준비 플로우를 정한다. */
function startOf(row: Row): { screen: string; prep: string[] } {
  // 링크를 받기 전에 네트워크를 끊어야 하므로 메이트 초대 스텝에 들어가기 전(습관 생성)에서 시작한다
  if (row.id === 'EC-008') return { screen: 'habit-create', prep: ['pf-clean', 'pf-habit'] };
  const g = `${row.given} ${row.kind === 'EC' ? row.title : ''}`;
  const step = /(?:사용법 안내 스텝|dot으로 스텝) ([1-5])/.exec(g);
  if (/끝낸|완료 표시가 기록|완료해/.test(g)) return { screen: 'today', prep: ['pf-clean', 'pf-done'] };
  if (step) return { screen: `guide-${step[1]}`, prep: ['pf-clean', 'pf-guide'] };
  if (/사용법 안내/.test(g)) return { screen: 'guide-1', prep: ['pf-clean', 'pf-guide'] };
  if (/메이트 초대|초대 링크|공유 시트/.test(g)) return { screen: 'mate-invite', prep: ['pf-clean', 'pf-mate'] };
  if (/첫 습관|습관 이름|닉네임을 막 저장|닉네임 저장 직후|습관을 만들/.test(g))
    return { screen: 'habit-create', prep: ['pf-clean', 'pf-habit'] };
  return { screen: 'nickname', prep: ['pf-clean'] };
}

// ---------------------------------------------------------------- 케이스 변환

/**
 * 검증 포인트: 스펙 Then에서 Opus로 생성해 둔 것(data/onboarding-points.json, packages/agent/scripts/gen-points.ts).
 * 개수 포인트는 기대가 숫자만 오므로 문장으로 바꾼다.
 */
function pointsOf(key: string, tcId: string): VerificationPoint[] {
  const gen = GENERATED[key];
  if (!gen) throw new Error(`생성된 검증 포인트 없음: ${key} (gen-points를 다시 돌리세요)`);
  return gen.map((p, i) => ({
    id: `${tcId}-P${i + 1}`,
    target: p.target,
    compare: p.compare,
    expected: /^\d+$/.test(p.expected.trim()) ? `${p.target} ${p.expected.trim()}개` : p.expected,
    method: p.method,
  }));
}

/** 스펙의 When만으로는 기대 결과를 확인할 수 없는 케이스: 확인 가능한 순서로 단계를 적는다 */
const STEP_OVERRIDES: Record<string, CaseBody['steps']> = {
  'EC-008': [
    { text: 'Wi-Fi와 모바일 데이터를 끈다 (초대 링크를 받지 못하는 상황)', manual: false },
    { text: '습관 이름 `물 2L 마시기`를 입력하고 습관을 만들어 메이트 초대 스텝에 들어간다', manual: false },
    { text: '[초대 링크 복사]와 [메이트 초대하기]를 차례로 누른다', manual: false },
  ],
};

const MANUAL_CASES = new Set(['TS-020', 'EC-019']);
const MANUAL_STEP_CASES: Record<string, CaseBody['steps']> = {
  'TS-021': [
    { text: '[메이트 초대하기]를 눌러 OS 공유 시트를 연다', manual: false },
    {
      text: '공유 시트에서 메신저로 링크를 보내거나 시트를 취소한다 (외부 발송이므로 실행자가 직접)',
      manual: true,
      risk: 'approval',
    },
  ],
};

function typeOf(row: Row): CaseBody['type'] {
  if (row.flow.includes('다시 켠다')) return 'state';
  if (row.kind === 'EC') return ['EC-017', 'EC-018'].includes(row.id) ? 'boundary' : 'exception';
  return /노출|문구|위치|px|dot|표시/.test(row.then) ? 'ui' : 'functional';
}

function priorityOf(row: Row): CaseBody['priority'] {
  if (row.frs.every((f) => f.startsWith('UX'))) return 'low';
  if (row.kind === 'TS' && row.flow.includes('처음부터 끝까지')) return 'high';
  if (['EC-001', 'EC-002', 'EC-008', 'TS-036', 'TS-037'].includes(row.id)) return 'high';
  return 'medium';
}

function bodyOf(row: Row, tcId: string): CaseBody {
  const { prep } = startOf(row);
  const steps = STEP_OVERRIDES[row.id] ?? MANUAL_STEP_CASES[row.id] ?? [{ text: row.when, manual: false }];
  const preconditions = row.kind === 'TS' ? [row.given] : [`${row.title} 상황을 만든다`];
  return {
    title: row.title,
    preconditions,
    prepFlowIds: prep,
    cleanState: prep.includes('pf-clean'),
    data: prep.includes('pf-mate')
      ? '닉네임 `콩콩이`, 습관 이름 `물 2L 마시기`'
      : prep.length > 1
        ? '닉네임 `콩콩이`'
        : undefined,
    steps,
    verificationPoints: pointsOf(row.id, tcId),
    priority: priorityOf(row),
    type: typeOf(row),
    platform: 'common',
    mode: MANUAL_CASES.has(row.id) ? 'manual' : 'auto',
  };
}

/** 1.2.0 → 1.3.0 사이에 바뀐 케이스: 이전 버전 블록의 기대 결과 */
const PREVIOUS_THEN: Record<string, string> = {
  'TS-008': '아무 반응 없이 첫 습관 만들기 스텝에 머무른다',
  'EC-004': '아무 반응 없이 현재 스텝에 머무른다. 온보딩은 종료되지 않는다',
  'TS-019': '1.5초 뒤 사용법 안내 스텝 1로 자동 이동한다',
};
/** 검증 포인트 생성기(packages/agent/scripts/gen-points.ts)의 입력 */
export const SPEC_INPUT = { spec: SPEC, rows, previousThen: PREVIOUS_THEN, requirements: raw.requirements };

const NEW_IN_130 = new Set(['TS-037', 'TS-038', 'EC-021', 'EC-022']);
const HELD = new Set(['TS-023', 'TS-038']);

export const project: Project = {
  id: 'haru',
  name: '하루콩',
  appName: '하루콩',
  packageName: 'com.example.harukong',
  createdBy: PEOPLE.lead,
  createdAt: T(1, 9),
};

// ---------------------------------------------------------------- 프로젝트·멤버·초대 (F-TM-09~13)

/** GitHub 사용자명 (로그인·초대 기준) */
export const GITHUB: Record<string, string> = {
  [PEOPLE.lead]: 'jaesung-lee',
  [PEOPLE.qa]: 'minji-kim',
  [PEOPLE.planner]: 'doyoon-park',
  [PEOPLE.dev]: 'seojun-choi',
};

/**
 * 하루콩 외의 프로젝트: 빈 프로젝트(Admin), 내가 Viewer인 프로젝트, 삭제 예정 프로젝트, 아직 멤버가 아닌 프로젝트(초대 대기),
 * 로그인이 있는 앱(모아북 — 테스트 계정 화면용). QA 문서·사이클은 하루콩에만 있다. 모두 가상의 앱이다.
 */
export const otherProjects: Project[] = [
  {
    id: 'widget',
    name: '하루콩 위젯',
    appName: '하루콩 위젯',
    packageName: 'com.example.harukong.widget',
    createdBy: PEOPLE.lead,
    createdAt: T(18, 11),
  },
  {
    id: 'roomie',
    name: 'Roomie',
    appName: '루미',
    packageName: 'com.example.roomie',
    createdBy: PEOPLE.dev,
    createdAt: T(5, 14),
  },
  {
    id: 'old-poc',
    name: '하루콩 PoC',
    appName: '하루콩 PoC',
    packageName: 'com.example.harukong.poc',
    createdBy: PEOPLE.lead,
    createdAt: T(2, 10),
    deletedAt: T(17, 18),
    purgeAt: '2026-11-16T18:00:00+09:00',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    appName: '아틀라스',
    packageName: 'com.example.atlas',
    createdBy: PEOPLE.dev,
    createdAt: T(8, 9),
  },
  {
    id: 'moabook',
    name: '모아북',
    appName: '모아북',
    packageName: 'com.example.moabook',
    createdBy: PEOPLE.lead,
    createdAt: T(19, 10),
  },
];

const member = (projectId: string, user: string, role: Role, joinedAt: string): Member => ({
  projectId,
  uid: GITHUB[user]!,
  user,
  github: GITHUB[user]!,
  role,
  joinedAt,
  dataNoticeAckAt: joinedAt,
});

export const members: Member[] = [
  member('haru', PEOPLE.lead, 'admin', T(1, 9)),
  member('haru', PEOPLE.qa, 'qa', T(1, 11)),
  member('haru', PEOPLE.dev, 'qa', T(2, 10)),
  member('haru', PEOPLE.planner, 'viewer', T(3, 15)),
  member('widget', PEOPLE.lead, 'admin', T(18, 11)),
  member('roomie', PEOPLE.dev, 'admin', T(5, 14)),
  member('roomie', PEOPLE.lead, 'viewer', T(6, 10)),
  member('old-poc', PEOPLE.lead, 'admin', T(2, 10)),
  member('atlas', PEOPLE.dev, 'admin', T(8, 9)),
  member('moabook', PEOPLE.lead, 'admin', T(19, 10)),
  member('moabook', PEOPLE.qa, 'qa', T(19, 11)),
];

/**
 * 테스트 계정 (F-PF-04·08·09). 하루콩은 로그인이 없어 계정이 없고, 모아북(가상 앱)에 종류 두 가지 계정을 둔다.
 * 비밀값은 fixture에 없다 — 화면은 비밀값을 다시 보여 주지 않는다
 */
const account = (id: string, kind: string, extra: Partial<TestAccount> = {}): TestAccount => ({
  id,
  projectId: 'moabook',
  kind,
  loginId: `${id}@moabook.test`,
  usesTotp: false,
  createdAt: T(19, 11),
  createdBy: PEOPLE.lead,
  secretUpdated: { by: PEOPLE.lead, at: T(19, 11) },
  ...extra,
});
export const accounts: TestAccount[] = [
  account('qa.basic01', '기본', { note: '기본 프로필, 책 0권' }),
  account('qa.basic02', '기본', { note: '책 12권 보유', secretUpdated: { by: PEOPLE.qa, at: T(20, 9) } }),
  account('qa.basic03', '기본', {
    note: '책 3권, 알림 끔',
    loginFailed: {
      at: T(24, 14, 2),
      cycleId: 'cycle-moa-1',
      runId: 'run-moa-1',
      tcId: 'TC-LIB-021',
      detail: '아이디 또는 비밀번호가 올바르지 않습니다',
    },
  }),
  account('qa.sub01', '구독자', {
    note: '연간 구독',
    usesTotp: true,
    quarantine: {
      reason: 'restore_failed',
      at: T(25, 11, 40),
      cycleId: 'cycle-moa-1',
      runId: 'run-moa-1',
      tcId: 'TC-SUB-007',
      detail: '구독 관리 화면에 [해지 예약 취소]가 보이지 않음',
    },
  }),
  account('qa.sub02', '구독자', { note: '월간 구독', usesTotp: true }),
];

/** 초대 링크는 `/invite/<token>`. 만료 판단은 지금 시각과 expiresAt 비교 */
export const invitations: Invitation[] = [
  {
    id: 'inv-1',
    projectId: 'haru',
    role: 'qa',
    invitedBy: PEOPLE.lead,
    github: 'hyejin-han',
    token: 'haru-hyejin',
    createdAt: T(20, 10),
    expiresAt: '2026-12-31T23:59:00+09:00',
    status: 'pending',
  },
  {
    id: 'inv-2',
    projectId: 'haru',
    role: 'viewer',
    invitedBy: PEOPLE.lead,
    token: 'haru-link',
    createdAt: T(21, 16),
    expiresAt: '2026-12-31T23:59:00+09:00',
    status: 'pending',
  },
  {
    id: 'inv-3',
    projectId: 'haru',
    role: 'qa',
    invitedBy: PEOPLE.qa,
    github: 'jiwoo-seo',
    token: 'haru-expired',
    createdAt: T(1, 12),
    expiresAt: T(8, 12),
    status: 'pending',
  },
  {
    id: 'inv-4',
    projectId: 'atlas',
    role: 'qa',
    invitedBy: PEOPLE.dev,
    token: 'atlas-join',
    createdAt: T(21, 9),
    expiresAt: '2026-12-31T23:59:00+09:00',
    status: 'pending',
  },
];

function requirements(): Requirement[] {
  return raw.requirements.map((r) => ({
    id: reqId(r.id),
    spec: SPEC,
    text: r.text,
    sourceRef: {
      spec: SPEC,
      file: SPEC_FILE,
      headingPath: ['2. 요구사항', r.id.startsWith('FR') ? '2.1 기능적 요구사항' : '2.2 핵심 UX 규칙'],
      lineStart: r.line,
      lineEnd: r.line,
    },
  }));
}

function buildCases(version: '1.2.0' | '1.3.0'): TestCase[] {
  const cases: TestCase[] = [];
  rows.forEach((row, i) => {
    if (version === '1.2.0' && NEW_IN_130.has(row.id)) return;
    const tcId = tcIdOf(i + 1);
    let body = bodyOf(row, tcId);
    let previous: CaseBody | undefined;
    const prevThen = PREVIOUS_THEN[row.id];
    if (prevThen) {
      const old = { ...body, verificationPoints: pointsOf(`${row.id}@prev`, tcId) };
      if (version === '1.2.0') body = old;
      else previous = old;
    }
    const change: TestCase['change'] =
      version === '1.2.0' ? 'same' : NEW_IN_130.has(row.id) ? 'new' : previous ? 'changed' : 'same';
    const contentHash = hash(body);
    // 1.2.0의 변경 행은 이전 Then으로 만든 케이스다
    const sourceHash = rowHash(version === '1.2.0' && prevThen ? { ...row, then: prevThen } : row, raw.requirements);
    const status =
      version === '1.2.0' || change === 'same' || row.id === 'EC-021'
        ? HELD.has(row.id) && version === '1.3.0'
          ? 'held'
          : 'approved'
        : HELD.has(row.id)
          ? 'held'
          : 'pending';
    cases.push({
      ...body,
      tcId,
      sourceId: `${SPEC}/${row.id}`,
      sourceHash,
      requirementIds: row.frs.map(reqId),
      feature: FEATURE,
      subFeature: row.flow,
      sourceRef: {
        spec: SPEC,
        file: SPEC_FILE,
        headingPath: ['1. 유저 시나리오', row.flow, row.kind === 'TS' ? '테스트 시나리오' : '엣지 케이스'],
        lineStart: row.line,
        lineEnd: row.line,
      },
      change,
      previous,
      contentHash,
      rev: change === 'changed' ? 2 : 1,
      approval:
        status === 'approved'
          ? { status, by: PEOPLE.qa, at: version === '1.2.0' ? T(2, 15) : T(15, 14, 30), contentHash }
          : { status },
      questionIds: row.id === 'TS-023' ? ['Q-1'] : row.id === 'TS-038' ? ['Q-2'] : row.id === 'TS-027' ? ['Q-3'] : [],
      updatedBy: change === 'changed' ? 'QA Doc Generator' : undefined,
      updatedAt: change === 'same' ? undefined : T(15, 11),
    });
  });

  // 1.1.0 스펙 개정으로 사라진 출처 (진행률 인디케이터) — 1.2.0에는 있었고 1.3.0에서 삭제
  const removedBody: CaseBody = {
    title: '온보딩 상단 진행 인디케이터',
    preconditions: ['온보딩의 첫 습관 만들기 스텝에 있다'],
    prepFlowIds: ['pf-clean', 'pf-habit'],
    cleanState: true,
    steps: [{ text: '화면 상단을 확인한다', manual: false }],
    verificationPoints: [
      {
        id: 'TC-ONBOARDING-062-P1',
        target: '진행 인디케이터',
        compare: 'visible',
        expected: '2/4 진행 인디케이터가 노출된다',
        method: 'tree',
      },
    ],
    priority: 'low',
    type: 'ui',
    platform: 'common',
    mode: 'auto',
  };
  const removedHash = hash(removedBody);
  cases.push({
    ...removedBody,
    tcId: 'TC-ONBOARDING-062',
    sourceId: `${SPEC}/TS-040`,
    requirementIds: [reqId('UX-006')],
    feature: FEATURE,
    subFeature: '온보딩을 처음부터 끝까지 밟는다',
    sourceRef: {
      spec: SPEC,
      file: SPEC_FILE,
      headingPath: ['1. 유저 시나리오', '유저 플로우 1'],
      lineStart: 62,
      lineEnd: 62,
    },
    change: version === '1.2.0' ? 'same' : 'removed',
    contentHash: removedHash,
    rev: 1,
    approval: { status: 'approved', by: PEOPLE.qa, at: T(2, 15), contentHash: removedHash },
    questionIds: [],
  });
  return cases;
}

function questions(cases: TestCase[]): SpecQuestion[] {
  const tc = (src: string) => cases.find((c) => c.sourceId === `${SPEC}/${src}`)!.tcId;
  return [
    {
      id: 'Q-1',
      requirementId: reqId('UX-003'),
      caseIds: [tc('TS-023')],
      text: '토스트의 "하단에서 40px"은 내비게이션 바 위를 기준으로 하나요, 화면 맨 아래를 기준으로 하나요? 제스처 내비게이션 기기와 3버튼 기기에서 기대 위치가 달라집니다.',
      assignee: PEOPLE.planner,
      status: 'open',
      comments: [
        { by: PEOPLE.qa, at: T(15, 16), text: 'Pixel 8(제스처)과 S24(3버튼) 결과가 달라서 확인이 필요합니다.' },
      ],
    },
    {
      id: 'Q-2',
      requirementId: reqId('FR-022'),
      caseIds: [tc('TS-038')],
      text: '"닉네임은 있으나 온보딩 완료 표시가 없는 설치"를 테스트에서 어떻게 만드나요? 온보딩 중 강제 종료로 만들면 되는지, 디버그 메뉴가 따로 필요한지 확인 부탁드립니다.',
      assignee: PEOPLE.dev,
      status: 'open',
      comments: [],
    },
    {
      id: 'Q-3',
      requirementId: reqId('FR-016'),
      caseIds: [tc('TS-027')],
      text: 'dot의 터치 영역이 dot 크기(8dp)와 같나요?',
      assignee: PEOPLE.dev,
      status: 'answered',
      answer: '48dp 터치 영역으로 확장되어 있습니다. 케이스는 dot 중심을 누르면 됩니다.',
      comments: [{ by: PEOPLE.dev, at: T(14, 18), text: '48dp 터치 영역으로 확장되어 있습니다.' }],
    },
  ];
}

const SUGGESTIONS: SpecSuggestion[] = [
  {
    id: 'S-1',
    requirementId: reqId('FR-009'),
    technique: 'boundary',
    text: '작은 화면(360dp 너비)·큰 글꼴에서 메이트 초대 안내 본문이 잘리지 않는지 확인하는 TS가 없습니다.',
  },
  {
    id: 'S-2',
    requirementId: reqId('FR-016'),
    technique: 'state',
    text: 'dot을 빠르게 연속으로 누를 때 안내 문구·이미지·dot 위치가 어긋나지 않는지(UX-004) 확인하는 EC가 없습니다.',
  },
  {
    id: 'S-3',
    requirementId: reqId('FR-013'),
    technique: 'negative',
    text: '초대 링크를 확보하지 못한 상태에서 [X]로 사용법 안내에 나아가는 경로가 TS로 없습니다. EC-008은 실패 알림만 다룹니다.',
  },
  {
    id: 'S-4',
    requirementId: reqId('FR-024'),
    technique: 'state',
    text: '사용법 안내 안에서 스텝을 옮길 때 현재 스텝이 기록되는지 확인하는 TS가 없습니다. EC-022(스텝 1로 복원)와 FR-024(스텝마다 기록)의 관계도 확인이 필요합니다.',
  },
  {
    id: 'S-5',
    requirementId: reqId('FR-005'),
    technique: 'partition',
    text: '키보드가 올라온 상태(닉네임·습관 이름 입력 중)에서 바텀 네비게이션 비노출을 확인하는 TS가 없습니다.',
  },
];

export const qaDocV120: QADocument = {
  id: 'doc-120',
  projectId: project.id,
  appVersion: '1.2.0',
  specBundleId: 'bundle-120',
  createdAt: T(1, 17),
  specs: [{ name: SPEC, feature: FEATURE, file: SPEC_FILE }],
  requirements: requirements(),
  cases: buildCases('1.2.0'),
  questions: [],
  suggestions: [],
};

const cases130 = buildCases('1.3.0');
export const qaDocV130: QADocument = {
  id: 'doc-130',
  projectId: project.id,
  appVersion: '1.3.0',
  specBundleId: 'bundle-130',
  prevDocId: qaDocV120.id,
  createdAt: T(15, 10, 20),
  specs: [{ name: SPEC, feature: FEATURE, file: SPEC_FILE }],
  requirements: requirements(),
  cases: cases130,
  questions: questions(cases130),
  suggestions: SUGGESTIONS,
};

// ---------------------------------------------------------------- 빌드·디바이스

export const builds: Build[] = [
  {
    id: 'build-121',
    version: '1.2.1',
    buildNumber: 121,
    packageName: project.packageName,
    signingSha1: '3A:91:5C:0E:7B:22:D4:18:6F:C0:91:AA:5E:73:0B:4D:11:9C:E2:60',
    uploadedAt: T(2, 14),
  },
  {
    id: 'build-130',
    version: '1.3.0',
    buildNumber: 130,
    packageName: project.packageName,
    signingSha1: '3A:91:5C:0E:7B:22:D4:18:6F:C0:91:AA:5E:73:0B:4D:11:9C:E2:60',
    uploadedAt: T(16, 9, 40),
  },
];

export const devices: TargetDevice[] = [
  { id: 'galaxy-s24-15', model: 'Galaxy S24', osMajor: 15, resolution: '1080×2340', label: 'Galaxy S24 (Android 15)' },
  { id: 'pixel-8-16', model: 'Pixel 8', osMajor: 16, resolution: '1080×2400', label: 'Pixel 8 (Android 16)' },
];
const [S24, P8] = devices as [TargetDevice, TargetDevice];

// ---------------------------------------------------------------- 실행 타임라인

type Planned = { steps: ExecStep[]; finalScreen: string; finalState?: Record<string, string> };

/** 준비 플로우를 디바이스 액션으로 펼친다. */
function prepActions(
  prep: string[],
): { screen: string; el?: string; action: ExecStep['action']; input?: string; intent: string; next: string }[] {
  const out: ReturnType<typeof prepActions> = [];
  if (prep.includes('pf-clean'))
    out.push({
      screen: 'launcher',
      action: 'env',
      intent: '준비: 앱 데이터 초기화(pm clear) 후 실행',
      next: 'nickname',
    });
  const toHabit = () => {
    out.push({
      screen: 'nickname',
      el: 'nickname_input',
      action: 'input',
      input: '콩콩이',
      intent: '준비: 닉네임 입력',
      next: 'nickname',
    });
    out.push({
      screen: 'nickname',
      el: 'nickname_save',
      action: 'tap',
      intent: '준비: 닉네임 저장',
      next: 'habit-create',
    });
  };
  if (prep.includes('pf-habit')) toHabit();
  if (prep.includes('pf-mate')) {
    toHabit();
    out.push({
      screen: 'habit-create',
      el: 'habit_name',
      action: 'input',
      input: '물 2L 마시기',
      intent: '준비: 습관 이름 입력',
      next: 'habit-create',
    });
    out.push({
      screen: 'habit-create',
      el: 'habit_create',
      action: 'tap',
      intent: '준비: 습관 만들기',
      next: 'mate-invite',
    });
  }
  if (prep.includes('pf-guide') || prep.includes('pf-done')) {
    toHabit();
    out.push({
      screen: 'habit-create',
      el: 'habit_skip',
      action: 'tap',
      intent: '준비: 습관 건너뛰기',
      next: 'guide-1',
    });
  }
  if (prep.includes('pf-done'))
    out.push({
      screen: 'guide-1',
      el: 'guide_skip',
      action: 'tap',
      intent: '준비: 사용법 안내 건너뛰기',
      next: 'today',
    });
  return out;
}

const TAP_TARGETS: [RegExp, string, string][] = [
  [/초대 링크 복사/, 'mate_copy', 'mate-toast'],
  [/메이트 초대하기/, 'mate_share', 'share-sheet'],
  [/\[X\]/, 'mate_close', 'guide-1'],
  [/하루콩 시작하기/, 'guide_start', 'today'],
  [/습관 만들기\]/, 'habit_create', 'mate-invite'],
  [/\[저장\]/, 'nickname_save', 'habit-create'],
];

const PRIMARY_TAP: Record<string, [string, string]> = {
  nickname: ['nickname_save', 'habit-create'],
  'habit-create': ['habit_create', 'mate-invite'],
  'mate-invite': ['mate_copy', 'mate-toast'],
};
const onScreen = (screen: string, id: string) =>
  !!SCREENS[screen === 'mate-toast' ? 'mate-invite' : screen]?.elements.some((e) => e.id === id);

function mainActions(row: Row, screen: string): ReturnType<typeof prepActions> {
  const w = `${row.when} ${row.kind === 'EC' ? row.title : ''}`;
  const out: ReturnType<typeof prepActions> = [];
  const guideStep = /^guide-(\d)$/.exec(screen)?.[1];

  // 사용법 안내 중간 스텝에서 시작하면 스와이프로 이동한다
  if (guideStep && Number(guideStep) > 1 && !/dot으로 스텝 5에 도달/.test(row.given)) {
    for (let s = 1; s < Number(guideStep); s++)
      out.push({
        screen: `guide-${s}`,
        action: 'swipe',
        intent: `준비: 사용법 안내 스텝 ${s + 1}로 넘기기`,
        next: `guide-${s + 1}`,
      });
  }
  if (/연달아|연타/.test(w)) {
    const matched = TAP_TARGETS.find(([re, el]) => re.test(w) && onScreen(screen, el));
    const target = matched ?? ['', ...(PRIMARY_TAP[screen] ?? ['guide_skip', 'today'])];
    // 화면 전환 중에 같은 자리를 연달아 누른다 — 스크린샷은 모두 누르기 직전 화면
    for (let k = 0; k < 3; k++)
      out.push({
        screen,
        el: target[1],
        action: 'tap',
        intent: `같은 버튼 연속 탭 (${k + 1}/3)`,
        next: target[2],
      });
    return out;
  }
  const dot = /(\d)번째 dot/.exec(w);
  if (dot && screen.startsWith('guide')) {
    out.push({
      screen,
      el: 'guide_dots',
      action: 'tap',
      intent: `${dot[1]}번째 dot 탭`,
      next: `guide-${dot[1]}`,
    });
    return out;
  }
  if (/뒤로가기/.test(w)) {
    const n = Number(guideStep ?? 0);
    out.push({ screen, action: 'back', intent: '시스템 뒤로가기', next: n > 1 ? `guide-${n - 1}` : 'launcher' });
    return out;
  }
  if (/건너뛰기/.test(w)) {
    const first = screen.startsWith('guide') ? 'guide_skip' : 'habit_skip';
    out.push({
      screen,
      el: first,
      action: 'tap',
      intent: '[건너뛰기] 탭',
      next: first === 'habit_skip' ? 'guide-1' : 'today',
    });
    if (/두 번/.test(w))
      out.push({
        screen: 'guide-1',
        el: 'guide_skip',
        action: 'tap',
        intent: '사용법 안내 [건너뛰기] 탭',
        next: 'today',
      });
    return out;
  }
  if (/다시 켠다|다시 연다|강제 종료|다시 설치|불러온다|되돌아온다/.test(w)) {
    out.push({
      screen,
      action: 'restart',
      intent: '앱 강제 종료 후 다시 실행',
      next: screen === 'today' ? 'today' : screen.startsWith('guide') ? 'guide-1' : screen,
    });
    return out;
  }
  for (const [re, el, next] of TAP_TARGETS)
    if (re.test(w) && onScreen(screen, el)) {
      out.push({
        screen,
        el,
        action: 'tap',
        intent: `${element(screen === 'mate-toast' ? 'mate-invite' : screen, el).label} 탭`,
        next,
      });
      if (/기다린다/.test(w)) out.push({ screen: next, action: 'wait', intent: '3초 대기 후 화면 변화 확인', next });
      return out;
    }
  if (/기다린다/.test(w)) out.push({ screen, action: 'wait', intent: '3초 대기 후 화면 변화 확인', next: screen });
  return out;
}

function plan(
  tc: TestCase,
  row: Row | undefined,
  opts: { finalScreen?: string; finalState?: Record<string, string> } = {},
): Planned {
  const { screen, prep } = row ? startOf(row) : { screen: 'habit-create', prep: ['pf-clean', 'pf-habit'] };
  const actions = [...prepActions(prep), ...(row ? mainActions(row, screen) : [])];
  let ts = 0;
  const steps: ExecStep[] = actions.map((a, i) => {
    const el = a.el ? element(a.screen === 'mate-toast' ? 'mate-invite' : a.screen, a.el) : undefined;
    const durationMs = 900 + ((i * 37 + tc.tcId.length * 13) % 9) * 160;
    const step: ExecStep = {
      index: i + 1,
      action: a.action,
      target: el ? { label: el.label, elementId: el.id, bounds: el.bounds } : undefined,
      swipe: a.action === 'swipe' ? { from: [900, 1200], to: [180, 1200] } : undefined,
      input: a.input,
      intent: a.intent,
      screenshot: shot(a.screen),
      videoTs: ts,
      durationMs,
      caseStepIndex: a.intent.startsWith('준비') ? undefined : 0,
    };
    ts += durationMs;
    return step;
  });
  const last = actions.at(-1);
  const finalScreen = opts.finalScreen ?? last?.next ?? screen;
  steps.push({
    index: steps.length + 1,
    action: 'verify',
    intent: '검증 포인트 확인',
    screenshot: shot(finalScreen, opts.finalState),
    videoTs: ts,
    durationMs: 1400,
  });
  return { steps, finalScreen, finalState: opts.finalState };
}

function pointResults(
  tc: TestCase,
  p: Planned,
  outcome: Partial<Record<number, { result: PointResult['result']; observed: string; reason: string }>> = {},
): PointResult[] {
  const els = SCREENS[p.finalScreen]?.elements.filter((e) => e.kind !== 'statusbar') ?? [];
  return tc.verificationPoints.map((vp, i) => {
    const o = outcome[i];
    const words = vp.target.split(/\s+/);
    const el = els.find((e) => words.some((w) => w.length > 1 && e.label.includes(w))) ?? els[0];
    return {
      pointId: vp.id,
      expected: vp.expected,
      method: vp.method,
      targetElement: vp.method === 'tree' && el ? `${el.id} "${el.label}"` : undefined,
      observed:
        o?.observed ?? (vp.method === 'tree' && el ? `${el.label} — 기대와 같음` : '화면에서 기대한 상태를 확인함'),
      result: o?.result ?? 'match',
      evidence: shot(p.finalScreen, p.finalState),
      reason:
        o?.reason ??
        (vp.method === 'tree'
          ? `접근성 트리에서 ${el?.id ?? '대상'} 요소를 찾았고 값이 기대와 같다.`
          : '스크린샷에서 기대한 상태가 보인다.'),
    };
  });
}

// ---------------------------------------------------------------- 사이클 결과

type Special = {
  verdict: Verdict;
  agentVerdict?: Verdict;
  human?: string;
  unmet?: AutoConfirmCondition[];
  blockedReason?: string;
  actual?: string;
  defectId?: string;
  attempts?: number;
  finalScreen?: string;
  finalState?: Record<string, string>;
  points?: Parameters<typeof pointResults>[2];
  history?: CaseResult['history'];
  previousAttempts?: CaseResult['previousAttempts'];
  note?: string;
};

const src = (id: string) => `${SPEC}/${id}`;

const SPECIAL_130: Record<string, Partial<Record<string, Special>>> = {
  [src('EC-009')]: {
    [S24.id]: {
      verdict: 'fail',
      actual: '[초대 링크 복사]를 3번 누르자 토스트가 3개 겹쳐 쌓여 보였다.',
      finalScreen: 'mate-toast',
      finalState: { toastCount: '3' },
      points: {
        1: {
          result: 'mismatch',
          observed: 'toast 요소 3개 (기대: 1개)',
          reason: '접근성 트리에 toast 요소가 3개 있다. 겹쳐 쌓이지 않아야 한다.',
        },
      },
    },
  },
  [src('TS-034')]: {
    [P8.id]: {
      verdict: 'fail',
      actual: '사용법 안내 스텝 3에서 뒤로가기를 누르자 스텝 2가 아니라 앱이 백그라운드로 갔다.',
      defectId: 'D-1',
      finalScreen: 'launcher',
      points: {
        0: {
          result: 'mismatch',
          observed: '런처 화면 (앱이 백그라운드로 감)',
          reason: '뒤로가기 뒤 화면이 사용법 안내 스텝 2가 아니라 런처다.',
        },
      },
      attempts: 2,
      previousAttempts: [
        {
          attempt: 1,
          verdict: 'blocked',
          decidedBy: { kind: 'agent' },
          executor: 'agent',
          executedAt: T(16, 11, 5),
          blockedReason: '준비 플로우 실패: 사용법 안내 스텝 3에 도달하지 못했다',
        },
      ],
    },
  },
  [src('TS-023')]: {
    [S24.id]: {
      verdict: 'check',
      agentVerdict: 'check',
      unmet: ['tree_only'],
      points: {
        0: {
          result: 'unknown',
          observed: '토스트 하단 여백 약 40px로 보이나 내비게이션 바 기준이 불분명',
          reason: '기준선(Q-1)이 정해지지 않아 판단할 수 없다.',
        },
      },
    },
    [P8.id]: {
      verdict: 'check',
      agentVerdict: 'check',
      unmet: ['tree_only'],
      points: {
        0: {
          result: 'unknown',
          observed: '토스트 하단 여백 약 24px (제스처 바 위 기준)',
          reason: '기준선(Q-1)이 정해지지 않아 판단할 수 없다.',
        },
      },
    },
  },
  [src('TS-017')]: {
    [S24.id]: {
      verdict: 'pass',
      agentVerdict: 'check',
      human: PEOPLE.qa,
      unmet: ['tree_only'],
      history: [
        { at: T(16, 15, 12), by: PEOPLE.qa, from: 'check', to: 'pass', note: '공유 시트에 링크 미리보기 확인함' },
      ],
    },
  },
  [src('TS-016')]: {
    [S24.id]: {
      verdict: 'fail',
      agentVerdict: 'pass',
      human: PEOPLE.qa,
      actual: '본문 두 번째 문장 끝 마침표가 빠져 있다 ("…습관이 돼요 메이트가 들어오면").',
      defectId: 'D-2',
      history: [
        { at: T(16, 15, 40), by: PEOPLE.qa, from: 'pass', to: 'fail', note: '자동 Pass 반전 — 문구 마침표 누락' },
      ],
    },
  },
  [src('TS-025')]: {
    [S24.id]: {
      verdict: 'check',
      agentVerdict: 'check',
      unmet: ['tree_only'],
      points: {
        1: {
          result: 'unknown',
          observed: '선택된 dot과 다른 dot의 색 차이가 작아 구분하기 어려움',
          reason: '비전으로 선택 상태를 확신할 수 없다.',
        },
      },
    },
  },
  [src('EC-008')]: {
    [P8.id]: {
      verdict: 'blocked',
      agentVerdict: 'blocked',
      blockedReason: '환경 조작 불가 — Wi-Fi ADB 연결에서는 디바이스 네트워크를 끌 수 없음',
    },
  },
  [src('EC-003')]: {
    [P8.id]: {
      verdict: 'blocked',
      agentVerdict: 'blocked',
      blockedReason: '실행 한도 초과 — 같은 화면에서 같은 액션 3회 반복',
      attempts: 1,
    },
  },
};

const GROUP_ORDER = ['pf-guide', 'pf-done', 'pf-clean', 'pf-habit', 'pf-mate'];
const groupRank = (tc: TestCase) => GROUP_ORDER.indexOf(tc.prepFlowIds.at(-1) ?? 'pf-clean');
const rowOf = (tc: TestCase) => rows.find((r) => `${SPEC}/${r.id}` === tc.sourceId);

function result(
  tc: TestCase,
  device: TargetDevice,
  executedAt: string,
  executor: string,
  sp: Special | undefined,
  runId: string,
): CaseResult {
  const p = plan(tc, rowOf(tc), { finalScreen: sp?.finalScreen, finalState: sp?.finalState });
  const steps =
    tc.mode === 'manual'
      ? [{ ...p.steps.at(-1)!, index: 1, action: 'manual' as const, intent: '실행자가 직접 수행하고 결과를 입력함' }]
      : p.steps;
  const points = pointResults(tc, p, sp?.points);
  const verdict = sp?.verdict ?? 'pass';
  const human =
    tc.mode === 'manual' ? executor : (sp?.human ?? (['fail', 'blocked'].includes(verdict) ? PEOPLE.qa : undefined));
  const agentVerdict = tc.mode === 'manual' ? undefined : (sp?.agentVerdict ?? verdict);
  return {
    tcId: tc.tcId,
    deviceId: device.id,
    verdict,
    agentVerdict,
    decidedBy: human ? { kind: 'human', name: human } : { kind: 'agent' },
    autoConfirmed: !human && verdict === 'pass',
    unmetConditions: sp?.unmet ?? [],
    blockedReason: sp?.blockedReason,
    actualSummary: sp?.actual,
    attempts: sp?.attempts ?? 1,
    executor,
    executedAt,
    osBuild: device.id === S24.id ? '15 (AP3A.240905.015.A2)' : '16 (BP2A.250705.008)',
    defectId: sp?.defectId,
    note: sp?.note,
    runId,
    steps,
    points,
    history: sp?.history ?? [],
    ...(sp?.previousAttempts ? { previousAttempts: sp.previousAttempts } : {}),
    tokens: tc.mode === 'manual' ? 0 : steps.length * 3800 + points.length * 1200,
    costUsd:
      tc.mode === 'manual' ? 0 : Math.round((steps.length * 3800 + points.length * 1200) * 0.0000042 * 1000) / 1000,
  };
}

const ntResult = (tc: TestCase, device: TargetDevice): CaseResult => ({
  tcId: tc.tcId,
  deviceId: device.id,
  verdict: 'nt',
  autoConfirmed: false,
  unmetConditions: [],
  attempts: 0,
  steps: [],
  points: [],
  history: [],
});

/** 사이클 생성 시점에 승인돼 있던 케이스. TS-023은 그 뒤 Q-1이 생겨 보류로 바뀌었지만 스냅샷에는 남아 있다. */
const snapshotCases = qaDocV130.cases.filter(
  (c) => (c.approval.status === 'approved' || c.sourceId === src('TS-023')) && c.change !== 'removed',
);

export const cycle130: TestCycle = {
  id: 'cycle-130-1',
  projectId: project.id,
  name: '1.3.0 (130) 1차 회귀',
  docId: qaDocV130.id,
  buildId: 'build-130',
  targets: devices,
  period: { start: T(16, 10) },
  serverEnv: 'stage',
  snapshot: snapshotCases.map((c) => ({ tcId: c.tcId, contentHash: c.contentHash })),
  createdBy: PEOPLE.lead,
  defectSeq: 2,
};

/** Pixel 8 Run은 준비 상태가 같은 케이스끼리 묶어 실행 중이고, TS-021(수동 스텝)에서 멈춰 있다. */
const p8Order = [...snapshotCases].sort((a, b) => groupRank(a) - groupRank(b));
const P8_CURRENT = p8Order.find((c) => c.sourceId === src('TS-021'))!;
const p8Done = new Set(p8Order.slice(0, p8Order.indexOf(P8_CURRENT)).map((c) => c.tcId));
// EC-008(네트워크 끄기)은 Wi-Fi ADB에서 바로 Blocked 처리되어 순서와 상관없이 먼저 끝났다
p8Done.add(p8Order.find((c) => c.sourceId === src('EC-008'))!.tcId);

export const runs130: Run[] = [
  {
    id: 'run-s24-1',
    cycleId: cycle130.id,
    executor: PEOPLE.qa,
    executorUid: GITHUB[PEOPLE.qa]!,
    deviceId: S24.id,
    status: 'done',
    startedAt: T(16, 10, 5),
  },
  {
    id: 'run-p8-1',
    cycleId: cycle130.id,
    executor: PEOPLE.lead,
    executorUid: GITHUB[PEOPLE.lead]!,
    deviceId: P8.id,
    status: 'paused',
    pauseReason: 'plan_limit',
    currentTcId: P8_CURRENT.tcId,
    startedAt: T(17, 14, 0),
  },
];

const results130: CaseResult[] = snapshotCases.flatMap((tc, i) => {
  const sp = SPECIAL_130[tc.sourceId] ?? {};
  const s24 = result(tc, S24, T(16, 10 + Math.floor(i / 12), (i * 5) % 60), PEOPLE.qa, sp[S24.id], 'run-s24-1');
  const p8 = p8Done.has(tc.tcId)
    ? result(tc, P8, T(17, 14 + Math.floor(i / 15), (i * 3) % 60), PEOPLE.lead, sp[P8.id], 'run-p8-1')
    : ntResult(tc, P8);
  // 수동 케이스는 Pixel 8에서 아직 수행 전
  return [s24, tc.mode === 'manual' ? ntResult(tc, P8) : p8];
});

const caseBySrc = (id: string) => qaDocV130.cases.find((c) => c.sourceId === src(id))!;

export const defects130: Defect[] = [
  {
    id: 'D-1',
    title: '사용법 안내 스텝 3에서 뒤로가기 시 앱이 백그라운드로 감',
    severity: 'major',
    tcId: caseBySrc('TS-034').tcId,
    deviceId: P8.id,
    repro: ['온보딩을 사용법 안내 스텝 1까지 진행', '스텝 3까지 넘긴다', '시스템 뒤로가기(제스처)'],
    expected: '사용법 안내 스텝 2가 노출된다 (FR-007, FR-016)',
    actual: '앱이 백그라운드로 간다',
    status: 'open',
  },
  {
    id: 'D-2',
    title: '메이트 초대 안내 본문 마침표 누락',
    severity: 'trivial',
    tcId: caseBySrc('TS-016').tcId,
    deviceId: S24.id,
    repro: ['온보딩을 메이트 초대 스텝까지 진행', '안내 본문을 확인한다'],
    expected: 'FR-009 문구와 같다',
    actual: '"…습관이 돼요 메이트가 들어오면" — 마침표가 빠짐',
    status: 'fixed',
  },
];

// ---------------------------------------------------------------- 이전 사이클 (1.2.1, 완료)

const snapshot120 = qaDocV120.cases;
export const cycle121: TestCycle = {
  id: 'cycle-121-1',
  projectId: project.id,
  name: '1.2.1 (121) 회귀',
  docId: qaDocV120.id,
  buildId: 'build-121',
  targets: devices,
  period: { start: T(3, 10), end: T(4, 18) },
  serverEnv: 'stage',
  snapshot: snapshot120.map((c) => ({ tcId: c.tcId, contentHash: c.contentHash })),
  createdBy: PEOPLE.lead,
  defectSeq: 1,
};

const results121: CaseResult[] = snapshot120.flatMap((tc, i) =>
  devices.map((d, k) =>
    result(
      tc,
      d,
      T(3 + k, 10 + Math.floor(i / 10), (i * 7) % 60),
      k === 0 ? PEOPLE.qa : PEOPLE.lead,
      tc.sourceId === src('EC-004') && k === 1
        ? {
            verdict: 'fail',
            actual: '첫 습관 만들기 스텝에서 뒤로가기 시 닉네임 설정 스텝으로 되돌아감',
            defectId: 'D-1',
          }
        : undefined,
      `run-121-${k}`,
    ),
  ),
);

export const defects121: Defect[] = [
  {
    id: 'D-1',
    title: '첫 습관 만들기 스텝 뒤로가기가 닉네임 설정으로 되돌아감',
    severity: 'major',
    tcId: caseBySrc('EC-004').tcId,
    deviceId: P8.id,
    repro: ['온보딩을 첫 습관 만들기 스텝까지 진행', '시스템 뒤로가기'],
    expected: '아무 반응 없이 현재 스텝에 머무른다',
    actual: '닉네임 설정 스텝으로 되돌아간다',
    status: 'closed',
  },
];

// ---------------------------------------------------------------- 로컬 콘솔 세션

export type { ClaudeCodeState, ConsoleDevice, ConsoleQueueItem } from '@qcard/shared';

export type ConsoleSession = {
  projectId: string;
  cycleId: string;
  cycleName: string;
  build: Build;
  run: Run;
  device: ConsoleDevice;
  /** 이 호스트에 연결된 다른 디바이스 (1인 1대 제한으로 대기) */
  otherDevices: ConsoleDevice[];
  queue: ConsoleQueueItem[];
  current: {
    tcId: string;
    case: TestCase;
    /** 재생할 스텝. `pauseAt` 스텝에서 수동 스텝 대기로 멈춘다. */
    steps: ExecStep[];
    thoughts: (ThoughtEntry & { stepIndex: number })[];
    pauseAt: number;
  };
  usage: { tokens: number; costUsd: number; caseTokenLimit: number };
  /** 이 PC의 Claude Code 상태 (F-DB-09). 호스트 에이전트가 `claude --version`·`claude auth status`로 채운다 */
  claudeCode: ClaudeCodeState;
};

function thoughtsFor(steps: ExecStep[]): (ThoughtEntry & { stepIndex: number })[] {
  const out: (ThoughtEntry & { stepIndex: number })[] = [];
  let at = 0;
  for (const s of steps) {
    const screen = s.screenshot.kind === 'mock' ? SCREENS[s.screenshot.screen] : undefined;
    const visible = screen?.elements
      .filter((e) => ['button', 'text-button', 'icon-button', 'title', 'input', 'app-icon'].includes(e.kind))
      .slice(0, 3)
      .map((e) => `'${e.label}'`)
      .join(', ');
    out.push({
      at,
      stepIndex: s.index,
      kind: 'observe',
      text: `화면: ${screen?.name ?? '알 수 없음'}${visible ? ` — ${visible} 보임` : ''}`,
    });
    // 수동 스텝은 실행자가 수행하므로 Agent의 판단·액션 로그가 없다
    if (s.action === 'manual') {
      at += s.durationMs;
      continue;
    }
    if (s.action === 'verify') {
      out.push({ at: at + 300, stepIndex: s.index, kind: 'verify', text: '검증 포인트를 접근성 트리에서 찾는 중' });
    } else {
      out.push({ at: at + 250, stepIndex: s.index, kind: 'decide', text: s.intent });
      const where = s.target?.bounds
        ? ` (${Math.round(s.target.bounds.x + s.target.bounds.w / 2)}, ${Math.round(s.target.bounds.y + s.target.bounds.h / 2)}) ${s.target.elementId}`
        : '';
      out.push({
        at: at + 500,
        stepIndex: s.index,
        kind: 'act',
        text: `${s.action === 'input' ? `입력 "${s.input}"` : s.action === 'env' ? `adb shell pm clear ${APP_PACKAGE}` : s.action}${where}`,
      });
    }
    at += s.durationMs;
  }
  return out;
}

function consoleSession(): ConsoleSession {
  const tc = P8_CURRENT;
  const base = plan(tc, rowOf(tc));
  // TS-021: [메이트 초대하기] 탭 → 공유 시트에서 수동 스텝(외부 발송)으로 대기
  const share = element('mate-invite', 'mate_share');
  const prep = base.steps.filter((s) => s.action !== 'verify');
  const last = prep.at(-1)!;
  const tap: ExecStep = {
    index: prep.length + 1,
    action: 'tap',
    target: { label: share.label, elementId: share.id, bounds: share.bounds },
    intent: '[메이트 초대하기]를 눌러 OS 공유 시트를 연다',
    screenshot: shot('mate-invite'),
    videoTs: last.videoTs + last.durationMs,
    durationMs: 1300,
    caseStepIndex: 0,
  };
  base.steps = [...prep, tap];
  const shareIdx = base.steps.length - 1;
  const manual: ExecStep = {
    index: shareIdx + 2,
    action: 'manual',
    intent: '수동 스텝: 공유 시트에서 메신저로 링크를 보내거나 시트를 취소 (외부 발송 — 실행자 확인 필요)',
    screenshot: shot('share-sheet'),
    videoTs: (base.steps[shareIdx]?.videoTs ?? 0) + (base.steps[shareIdx]?.durationMs ?? 0),
    durationMs: 0,
    risk: {
      kind: 'people',
      level: 'approval',
      reason: '메신저로 실제 초대 링크가 간다',
      planned: true,
      decision: 'pre_approved',
    },
    caseStepIndex: 1,
  };
  const steps = [...base.steps.slice(0, shareIdx + 1), manual].map((s, i) => ({ ...s, index: i + 1 }));
  const thoughts = thoughtsFor(steps);
  thoughts.push({
    at: (thoughts.at(-1)?.at ?? 0) + 400,
    stepIndex: steps.length,
    kind: 'system',
    text: '수동 스텝에서 일시정지 — 실행자가 디바이스에서 직접 수행한 뒤 [완료]를 누르세요 (10분 후 Blocked)',
  });
  const queue: ConsoleQueueItem[] = p8Order.map((c) => {
    const r = results130.find((x) => x.tcId === c.tcId && x.deviceId === P8.id);
    return {
      tcId: c.tcId,
      title: c.title,
      mode: c.mode,
      status: c.tcId === tc.tcId ? 'running' : p8Done.has(c.tcId) ? 'done' : 'pending',
      verdict: p8Done.has(c.tcId) ? r?.verdict : undefined,
    };
  });
  const doneTokens = results130.filter((r) => r.deviceId === P8.id).reduce((n, r) => n + (r.tokens ?? 0), 0);
  return {
    projectId: project.id,
    cycleId: cycle130.id,
    cycleName: cycle130.name,
    build: builds[1]!,
    run: runs130[1]!,
    device: {
      serial: '3A121FDJH00BX2',
      model: 'Pixel 8',
      osBuild: '16 (BP2A.250705.008)',
      resolution: '1080×2400',
      battery: 82,
      connection: 'USB',
      status: 'running',
    },
    otherDevices: [
      {
        serial: 'emulator-5554',
        model: 'Android Emulator (API 35)',
        osBuild: '15',
        resolution: '1080×2400',
        battery: 100,
        connection: 'USB',
        status: 'idle',
      },
    ],
    queue,
    current: { tcId: tc.tcId, case: tc, steps, thoughts, pauseAt: steps.length },
    usage: { tokens: doneTokens, costUsd: Math.round(doneTokens * 0.0000042 * 100) / 100, caseTokenLimit: 60000 },
    claudeCode: { installed: true, version: '2.1.185', loggedIn: true, plan: 'max' },
  };
}

// ---------------------------------------------------------------- 내보내기

// ---------------------------------------------------------------- QA 문서 생성 작업 (PRD §5.2, §6.2)

/** 생성 진행 (작업 상세 화면): 생성 계획·케이스 초안·진행 기록 */
export type JobParts = { specs: QaDocJobSpec[]; drafts: QaDocJobDraft[]; events: QaDocJobEvent[] };

/**
 * 1.3.0 문서를 이전 문서로 삼은 생성 작업의 진행. rows[from, from+targets)가 바뀐 행(변경)이고 나머지는 동일.
 * 8행 묶음 순서로 drafted개까지 초안이 있고, running이면 다음 3묶음을 만드는 중이다
 */
function jobProgress(opts: {
  day: number;
  start: [number, number];
  from: number;
  targets: number;
  drafted: number;
  running: boolean;
  stop?: string;
}): { progress: NonNullable<QaDocJob['progress']>; plan: NonNullable<QaDocJob['plan']>; parts: JobParts } {
  const at = (min: number) =>
    T(opts.day, opts.start[0] + Math.floor((opts.start[1] + min) / 60), (opts.start[1] + min) % 60);
  const prevOf = (row: Row) => CaseBodySchema.parse(qaDocV130.cases.find((c) => c.sourceId === `${SPEC}/${row.id}`)!);
  const planRows: JobPlanRow[] = rows.map((row, i) => {
    const target = i >= opts.from && i < opts.from + opts.targets;
    return {
      id: row.id,
      tcId: tcIdOf(i + 1),
      kind: row.kind,
      flow: row.flow,
      title: row.title,
      given: row.given,
      when: row.when,
      then: row.then,
      requirementIds: row.frs.map(reqId),
      change: target ? 'changed' : 'same',
      ...(target ? { previous: prevOf(row) } : {}),
    };
  });
  const targets = planRows.filter((r) => r.change !== 'same');
  // 초안: 이전 케이스에서 첫 검증 포인트를 이번 스펙의 Then으로 바꾼 모양
  const drafts: QaDocJobDraft[] = targets.slice(0, opts.drafted).map((r, i) => ({
    spec: SPEC,
    rowId: r.id,
    tcId: r.tcId,
    body: {
      ...r.previous!,
      verificationPoints: r.previous!.verificationPoints.map((p, j) => (j === 0 ? { ...p, expected: r.then } : p)),
    },
    questions: r.id === 'TS-023' ? ['토스트 위치 40px이 dp 기준인가요? 기기 밀도에 따라 확인 방법이 달라집니다.'] : [],
    at: at(3 + Math.floor(i / 8)),
  }));
  const batches = Math.ceil(opts.drafted / 8);
  const events: QaDocJobEvent[] = [
    {
      id: 'start',
      at: at(0),
      kind: 'start',
      text: `스펙 1개 · 이전 문서 1.3.0 · 만들 행 ${targets.length}개, 동일 ${rows.length - targets.length}개는 이전 케이스를 씁니다`,
    },
    { id: `plan-${SPEC}`, at: at(1), kind: 'plan', text: `${SPEC} 계획 · 보강 제안 2개` },
    ...Array.from({ length: batches }, (_, b): QaDocJobEvent => {
      const batch = targets.slice(b * 8, Math.min((b + 1) * 8, opts.drafted));
      return {
        id: `cases-${SPEC}-${batch[0]!.id}`,
        at: at(3 + b),
        kind: 'cases',
        text: `${SPEC} ${batch[0]!.id}~${batch.at(-1)!.id} 초안 ${batch.length}개`,
      };
    }),
    ...drafts
      .filter((d) => d.questions.length)
      .map((d): QaDocJobEvent => ({
        id: `q-${SPEC}-${d.rowId}`,
        at: d.at,
        kind: 'question',
        text: `${SPEC}/${d.rowId}: ${d.questions.join(' / ')}`,
      })),
    ...(opts.stop ? [{ id: 'stop-1', at: at(3 + batches), kind: 'stop' as const, text: opts.stop }] : []),
  ];
  const active = opts.running ? targets.slice(opts.drafted, opts.drafted + 24).map((r) => `${SPEC}/${r.id}`) : [];
  return {
    progress: {
      phase: 'cases',
      done: opts.drafted,
      total: targets.length,
      spec: SPEC,
      active,
      drafted: { [SPEC]: opts.drafted },
      phaseStartedAt: at(1),
      updatedAt: at(2 + batches),
      tokens: 9_800 + opts.drafted * 2_600,
    },
    plan: {
      specs: [{ name: SPEC, title: FEATURE, new: 0, changed: targets.length, same: rows.length - targets.length }],
      removed: 0,
    },
    parts: { specs: [{ spec: SPEC, title: FEATURE, order: 0, rows: planRows }], drafts, events },
  };
}

const job140 = jobProgress({ day: 21, start: [16, 41], from: 21, targets: 40, drafted: 16, running: true });
const job131 = jobProgress({
  day: 18,
  start: [14, 6],
  from: 15,
  targets: 12,
  drafted: 8,
  running: false,
  stop: '일시정지 · Claude 플랜 사용 한도(5시간)에 닿았습니다.',
});
export const jobParts: Record<string, JobParts> = { 'job-140': job140.parts, 'job-131': job131.parts };

/** 케이스 수정안 (F-QD-17): Q-3 답변("dot 중심을 누르면 된다")을 TS-027 케이스에 반영한 것. 아직 적용·버리기 전 */
const revised039 = (() => {
  const c = cases130.find((x) => x.sourceId.endsWith('/TS-027'))!;
  const body = CaseBodySchema.parse({
    ...c,
    preconditions: [...c.preconditions, 'dot 터치 영역은 48dp로 확장되어 있다'],
    steps: c.steps.map((s) => ({ ...s, text: s.text.replace(/dot을 누른다/, 'dot의 중심을 누른다') })),
  });
  return { tcId: c.tcId, rev: c.rev, body };
})();

/** 완료(1.3.0 문서를 만든 작업), 생성 중(1.4.0), 플랜 한도로 일시정지(1.3.1), 케이스 수정안(1.3.0 TS-027) */
export const jobs: Job[] = [
  {
    id: 'job-140',
    projectId: project.id,
    kind: 'qa_doc_generate',
    requestedBy: GITHUB[PEOPLE.lead]!,
    requestedByName: PEOPLE.lead,
    createdAt: T(21, 16, 40),
    status: 'running',
    input: { bundleId: 'bundle-140', appVersion: '1.4.0', prevDocId: qaDocV130.id },
    host: '이재성의 MacBook Pro',
    startedAt: T(21, 16, 41),
    progress: job140.progress,
    plan: job140.plan,
  },
  {
    id: 'job-131',
    projectId: project.id,
    kind: 'qa_doc_generate',
    requestedBy: GITHUB[PEOPLE.dev]!,
    requestedByName: PEOPLE.dev,
    createdAt: T(18, 14, 5),
    status: 'paused',
    input: { bundleId: 'bundle-131', appVersion: '1.3.1', prevDocId: qaDocV130.id },
    host: '최서준의 MacBook Air',
    startedAt: T(18, 14, 6),
    progress: job131.progress,
    plan: job131.plan,
    error: {
      kind: 'plan_limit',
      message: 'Claude 플랜 사용 한도(5시간)에 닿았습니다. 한도가 풀린 뒤 다시 시도하면 끝난 호출은 건너뜁니다.',
    },
  },
  {
    id: 'job-rev-039',
    projectId: project.id,
    kind: 'case_revise',
    requestedBy: GITHUB[PEOPLE.lead]!,
    requestedByName: PEOPLE.lead,
    createdAt: T(16, 9, 30),
    status: 'done',
    input: { docId: qaDocV130.id, tcId: revised039.tcId, questionIds: ['Q-3'], baseRev: revised039.rev },
    host: '이재성의 MacBook Pro',
    startedAt: T(16, 9, 30),
    finishedAt: T(16, 9, 31),
    result: {
      kind: 'revise',
      reason: 'Q-3 답변(터치 영역 48dp, dot 중심을 누르면 됨)에 맞춰 dot을 누르는 단계를 "중심을 누른다"로 바꾸고 사전조건에 터치 영역을 적었다.',
      body: revised039.body,
      guessed: [],
      tokens: 3_100,
      costUsd: 0.04,
    },
  },
  {
    id: 'job-130',
    projectId: project.id,
    kind: 'qa_doc_generate',
    requestedBy: GITHUB[PEOPLE.qa]!,
    requestedByName: PEOPLE.qa,
    createdAt: T(15, 10, 2),
    status: 'done',
    input: { bundleId: 'bundle-130', appVersion: '1.3.0', prevDocId: 'doc-120' },
    host: '김민지의 MacBook Pro',
    startedAt: T(15, 10, 3),
    finishedAt: T(15, 10, 20),
    result: { docId: 'doc-130', cases: 62, generated: 7, questions: 2, newPrepFlows: 0, tokens: 41_200, costUsd: 0.38 },
  },
];

export type FixtureDb = {
  projects: Project[];
  members: Member[];
  invitations: Invitation[];
  accounts: TestAccount[];
  qaDocs: QADocument[];
  builds: Build[];
  cycles: TestCycle[];
  /** 사이클을 만들 때 복사한 케이스 내용 (F-CY-02). QA 문서를 나중에 고쳐도 사이클은 이 내용으로 실행·표시한다 */
  cycleCases: Record<string, TestCase[]>;
  results: Record<string, CaseResult[]>;
  defects: Record<string, Defect[]>;
  runs: Record<string, Run[]>;
  prepFlows: PrepFlow[];
  jobs: Job[];
  /** 작업 id → 생성 진행 */
  jobParts: Record<string, JobParts>;
  console: ConsoleSession;
};

/** 매번 새 사본을 만든다 (메모리 구현이 수정해도 원본이 바뀌지 않게). */
export function createFixtureDb(): FixtureDb {
  return structuredClone({
    projects: [project, ...otherProjects],
    members,
    invitations,
    accounts,
    qaDocs: [qaDocV130, qaDocV120],
    builds,
    cycles: [cycle130, cycle121],
    // QA 문서 케이스와 따로 복사한다 (한 번에 복사하면 같은 객체를 가리켜 문서를 고치면 사본도 바뀐다)
    cycleCases: structuredClone({ [cycle130.id]: snapshotCases, [cycle121.id]: snapshot120 }),
    results: { [cycle130.id]: results130, [cycle121.id]: results121 },
    defects: { [cycle130.id]: defects130, [cycle121.id]: defects121 },
    runs: { [cycle130.id]: runs130, [cycle121.id]: [] },
    prepFlows: PREP_FLOWS,
    jobs,
    jobParts,
    console: consoleSession(),
  });
}
