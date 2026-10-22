import type {
  AutoConfirmCondition,
  Build,
  CaseBody,
  CaseResult,
  Defect,
  ExecStep,
  PointResult,
  PrepFlow,
  Project,
  QADocument,
  Requirement,
  Run,
  Screenshot,
  SpecQuestion,
  SpecSuggestion,
  TargetDevice,
  TestCase,
  TestCycle,
  ThoughtEntry,
  VerificationPoint,
  Verdict,
} from '@qcard/shared';
import raw from './data/onboarding-flow.json';
import generatedPoints from './data/onboarding-points.json';
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

/** 키 순서와 무관한 JSON (undefined 필드는 뺀다) */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** FNV-1a 32bit — fixture·메모리 구현용 결정적 내용 해시 */
export function hash(value: unknown): string {
  const s = canonical(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

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
    id: 'pf-room',
    name: '온보딩 · 첫 습관 만들기 스텝',
    kind: 'data_state',
    check: '첫 습관 만들기 스텝에 [건너뛰기]가 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]'],
  },
  {
    id: 'pf-invite',
    name: '온보딩 · 메이트 초대 스텝',
    kind: 'data_state',
    check: '`함께할 메이트를 불러볼까요?`가 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 이름 `물 2L 마시기` 입력', '[방 만들기]'],
  },
  {
    id: 'pf-tutorial',
    name: '온보딩 · 튜토리얼 스텝 1',
    kind: 'data_state',
    check: '제목 `튜토리얼`과 STEP 1이 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 [건너뛰기]'],
  },
  {
    id: 'pf-done',
    name: '온보딩 완료',
    kind: 'data_state',
    check: '홈 탭과 바텀 네비게이션이 보인다',
    steps: ['닉네임 `콩콩이` 입력', '[저장]', '습관 [건너뛰기]', '튜토리얼 [건너뛰기]'],
  },
];

/** Given 문장으로 케이스가 시작할 화면과 준비 플로우를 정한다. */
function startOf(row: Row): { screen: string; prep: string[] } {
  // 링크를 받기 전에 네트워크를 끊어야 하므로 메이트 초대 스텝에 들어가기 전(습관 생성)에서 시작한다
  if (row.id === 'EC-008') return { screen: 'room-create', prep: ['pf-clean', 'pf-room'] };
  const g = `${row.given} ${row.kind === 'EC' ? row.title : ''}`;
  const step = /(?:튜토리얼 스텝|dot으로 스텝) ([1-5])/.exec(g);
  if (/완료한|완료 표시가 기록|완료해/.test(g)) return { screen: 'home', prep: ['pf-clean', 'pf-done'] };
  if (step) return { screen: `tutorial-${step[1]}`, prep: ['pf-clean', 'pf-tutorial'] };
  if (/튜토리얼/.test(g)) return { screen: 'tutorial-1', prep: ['pf-clean', 'pf-tutorial'] };
  if (/메이트 초대|초대 링크|공유 시트/.test(g)) return { screen: 'invite', prep: ['pf-clean', 'pf-invite'] };
  if (/습관 생성|습관 스텝|방 정보|습관 이름|프로필을 막 저장|닉네임 저장 직후|습관을 만들/.test(g))
    return { screen: 'room-create', prep: ['pf-clean', 'pf-room'] };
  return { screen: 'profile', prep: ['pf-clean'] };
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
    { text: '습관 이름 `물 2L 마시기`을 입력하고 방을 만들어 메이트 초대 스텝에 들어간다', manual: false },
    { text: '[초대 링크 복사]와 [메이트 초대하기]를 차례로 누른다', manual: false },
  ],
};

const MANUAL_CASES = new Set(['TS-020', 'EC-019']);
const MANUAL_STEP_CASES: Record<string, CaseBody['steps']> = {
  'TS-021': [
    { text: '[메이트 초대하기]를 눌러 OS 공유 시트를 연다', manual: false },
    {
      text: '공유 시트에서 카카오톡으로 링크를 보내거나 시트를 취소한다 (외부 발송이므로 실행자가 직접)',
      manual: true,
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
    data: prep.includes('pf-invite')
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
  'TS-019': '1.5초 뒤 튜토리얼 스텝 1로 자동 이동한다',
};
/** 검증 포인트 생성기(packages/agent/scripts/gen-points.ts)의 입력 */
export const SPEC_INPUT = { spec: SPEC, rows, previousThen: PREVIOUS_THEN, requirements: raw.requirements };

const NEW_IN_130 = new Set(['TS-037', 'TS-038', 'EC-021', 'EC-022']);
const HELD = new Set(['TS-023', 'TS-038']);

export const project: Project = { id: 'haru', name: '하루콩', appName: '하루콩', packageName: 'com.example.harukong' };

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
    prepFlowIds: ['pf-clean', 'pf-room'],
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
      text: '"프로필은 있으나 온보딩 완료 표시가 없는 설치"를 테스트에서 어떻게 만드나요? 온보딩 중 강제 종료로 만들면 되는지, 디버그 메뉴가 따로 필요한지 확인 부탁드립니다.',
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
    text: '초대 링크를 확보하지 못한 상태에서 [X]로 튜토리얼에 나아가는 경로가 TS로 없습니다. EC-008은 실패 알림만 다룹니다.',
  },
  {
    id: 'S-4',
    requirementId: reqId('FR-024'),
    technique: 'state',
    text: '튜토리얼 안에서 스텝을 옮길 때 현재 스텝이 기록되는지 확인하는 TS가 없습니다. EC-022(스텝 1로 복원)와 FR-024(스텝마다 기록)의 관계도 확인이 필요합니다.',
  },
  {
    id: 'S-5',
    requirementId: reqId('FR-005'),
    technique: 'partition',
    text: '키보드가 올라온 상태(프로필 닉네임·습관 이름 입력 중)에서 바텀 네비게이션 비노출을 확인하는 TS가 없습니다.',
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
      next: 'profile',
    });
  const toRoom = () => {
    out.push({
      screen: 'profile',
      el: 'profile_nickname',
      action: 'input',
      input: '콩콩이',
      intent: '준비: 닉네임 입력',
      next: 'profile',
    });
    out.push({
      screen: 'profile',
      el: 'profile_save',
      action: 'tap',
      intent: '준비: 닉네임 저장',
      next: 'room-create',
    });
  };
  if (prep.includes('pf-room')) toRoom();
  if (prep.includes('pf-invite')) {
    toRoom();
    out.push({
      screen: 'room-create',
      el: 'room_name',
      action: 'input',
      input: '물 2L 마시기',
      intent: '준비: 습관 이름 입력',
      next: 'room-create',
    });
    out.push({
      screen: 'room-create',
      el: 'room_create',
      action: 'tap',
      intent: '준비: 습관 만들기',
      next: 'invite',
    });
  }
  if (prep.includes('pf-tutorial') || prep.includes('pf-done')) {
    toRoom();
    out.push({
      screen: 'room-create',
      el: 'room_skip',
      action: 'tap',
      intent: '준비: 습관 건너뛰기',
      next: 'tutorial-1',
    });
  }
  if (prep.includes('pf-done'))
    out.push({
      screen: 'tutorial-1',
      el: 'tutorial_skip',
      action: 'tap',
      intent: '준비: 튜토리얼 건너뛰기',
      next: 'home',
    });
  return out;
}

const TAP_TARGETS: [RegExp, string, string][] = [
  [/초대 링크 복사/, 'invite_copy', 'invite-toast'],
  [/메이트 초대하기/, 'invite_share', 'share-sheet'],
  [/우상단 \[X\]/, 'invite_close', 'tutorial-1'],
  [/하루콩 시작하기/, 'tutorial_start', 'home'],
  [/방을 만든다/, 'room_create', 'invite'],
  [/프로필을 저장/, 'profile_save', 'room-create'],
];

const PRIMARY_TAP: Record<string, [string, string]> = {
  profile: ['profile_save', 'room-create'],
  'room-create': ['room_create', 'invite'],
  invite: ['invite_copy', 'invite-toast'],
};
const onScreen = (screen: string, id: string) =>
  !!SCREENS[screen === 'invite-toast' ? 'invite' : screen]?.elements.some((e) => e.id === id);

function mainActions(row: Row, screen: string): ReturnType<typeof prepActions> {
  const w = `${row.when} ${row.kind === 'EC' ? row.title : ''}`;
  const out: ReturnType<typeof prepActions> = [];
  const tutorialStep = /^tutorial-(\d)$/.exec(screen)?.[1];

  // 튜토리얼 중간 스텝에서 시작하면 스와이프로 이동한다
  if (tutorialStep && Number(tutorialStep) > 1 && !/dot으로 스텝 5에 도달/.test(row.given)) {
    for (let s = 1; s < Number(tutorialStep); s++)
      out.push({
        screen: `tutorial-${s}`,
        action: 'swipe',
        intent: `준비: 튜토리얼 스텝 ${s + 1}로 넘기기`,
        next: `tutorial-${s + 1}`,
      });
  }
  if (/연달아|연타/.test(w)) {
    const matched = TAP_TARGETS.find(([re, el]) => re.test(w) && onScreen(screen, el));
    const target = matched ?? ['', ...(PRIMARY_TAP[screen] ?? ['tutorial_skip', 'home'])];
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
  if (dot && screen.startsWith('tutorial')) {
    out.push({
      screen,
      el: 'tutorial_dots',
      action: 'tap',
      intent: `${dot[1]}번째 dot 탭`,
      next: `tutorial-${dot[1]}`,
    });
    return out;
  }
  if (/뒤로가기/.test(w)) {
    const n = Number(tutorialStep ?? 0);
    out.push({ screen, action: 'back', intent: '시스템 뒤로가기', next: n > 1 ? `tutorial-${n - 1}` : 'launcher' });
    return out;
  }
  if (/건너뛰기/.test(w)) {
    const first = screen.startsWith('tutorial') ? 'tutorial_skip' : 'room_skip';
    out.push({
      screen,
      el: first,
      action: 'tap',
      intent: '[건너뛰기] 탭',
      next: first === 'room_skip' ? 'tutorial-1' : 'home',
    });
    if (/두 번/.test(w))
      out.push({
        screen: 'tutorial-1',
        el: 'tutorial_skip',
        action: 'tap',
        intent: '튜토리얼 [건너뛰기] 탭',
        next: 'home',
      });
    return out;
  }
  if (/다시 켠다|강제 종료|다시 설치|불러온다|되돌아온다/.test(w)) {
    out.push({
      screen,
      action: 'restart',
      intent: '앱 강제 종료 후 다시 실행',
      next: screen === 'home' ? 'home' : screen.startsWith('tutorial') ? 'tutorial-1' : screen,
    });
    return out;
  }
  for (const [re, el, next] of TAP_TARGETS)
    if (re.test(w) && onScreen(screen, el)) {
      out.push({
        screen,
        el,
        action: 'tap',
        intent: `${element(screen === 'invite-toast' ? 'invite' : screen, el).label} 탭`,
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
  const { screen, prep } = row ? startOf(row) : { screen: 'room-create', prep: ['pf-clean', 'pf-room'] };
  const actions = [...prepActions(prep), ...(row ? mainActions(row, screen) : [])];
  let ts = 0;
  const steps: ExecStep[] = actions.map((a, i) => {
    const el = a.el ? element(a.screen === 'invite-toast' ? 'invite' : a.screen, a.el) : undefined;
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
  note?: string;
};

const src = (id: string) => `${SPEC}/${id}`;

const SPECIAL_130: Record<string, Partial<Record<string, Special>>> = {
  [src('EC-009')]: {
    [S24.id]: {
      verdict: 'fail',
      actual: '[초대 링크 복사]를 3번 누르자 토스트가 3개 겹쳐 쌓여 보였다.',
      defectId: 'D-1',
      finalScreen: 'invite-toast',
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
      actual: '튜토리얼 스텝 3에서 뒤로가기를 누르자 스텝 2가 아니라 앱이 백그라운드로 갔다.',
      defectId: 'D-2',
      finalScreen: 'launcher',
      points: {
        0: {
          result: 'mismatch',
          observed: '런처 화면 (앱이 백그라운드로 감)',
          reason: '뒤로가기 뒤 화면이 튜토리얼 스텝 2가 아니라 런처다.',
        },
      },
      attempts: 2,
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
      actual: '본문 두 번째 문장 끝 마침표가 빠져 있다 ("…한눈에 모여요 다음 약속 장소").',
      defectId: 'D-3',
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

const GROUP_ORDER = ['pf-tutorial', 'pf-done', 'pf-clean', 'pf-room', 'pf-invite'];
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
  accounts: [{ role: '익명 사용자', id: '(설치마다 새로 생성)' }],
  createdBy: PEOPLE.lead,
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
    deviceId: S24.id,
    status: 'done',
    startedAt: T(16, 10, 5),
  },
  {
    id: 'run-p8-1',
    cycleId: cycle130.id,
    executor: PEOPLE.lead,
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
    title: '[초대 링크 복사] 연타 시 토스트가 겹쳐 쌓임',
    severity: 'minor',
    tcId: caseBySrc('EC-009').tcId,
    deviceId: S24.id,
    repro: ['온보딩을 메이트 초대 스텝까지 진행', '[초대 링크 복사]를 빠르게 3번 누른다'],
    expected: '토스트가 하나만 보인다 (EC-009)',
    actual: '토스트 3개가 겹쳐 쌓여 보인다',
    status: 'open',
    trackerUrl: 'https://github.com/example/harukong-android/issues/412',
  },
  {
    id: 'D-2',
    title: '튜토리얼 스텝 3에서 뒤로가기 시 앱이 백그라운드로 감',
    severity: 'major',
    tcId: caseBySrc('TS-034').tcId,
    deviceId: P8.id,
    repro: ['온보딩을 튜토리얼 스텝 1까지 진행', '스텝 3까지 넘긴다', '시스템 뒤로가기(제스처)'],
    expected: '튜토리얼 스텝 2가 노출된다 (FR-007, FR-016)',
    actual: '앱이 백그라운드로 간다',
    status: 'open',
  },
  {
    id: 'D-3',
    title: '메이트 초대 안내 본문 마침표 누락',
    severity: 'trivial',
    tcId: caseBySrc('TS-016').tcId,
    deviceId: S24.id,
    repro: ['온보딩을 메이트 초대 스텝까지 진행', '안내 본문을 확인한다'],
    expected: 'FR-009 문구와 같다',
    actual: '"…한눈에 모여요 다음 약속 장소" — 마침표가 빠짐',
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
  accounts: [{ role: '익명 사용자', id: '(설치마다 새로 생성)' }],
  createdBy: PEOPLE.lead,
};

const results121: CaseResult[] = snapshot120.flatMap((tc, i) =>
  devices.map((d, k) =>
    result(
      tc,
      d,
      T(3 + k, 10 + Math.floor(i / 10), (i * 7) % 60),
      k === 0 ? PEOPLE.qa : PEOPLE.lead,
      tc.sourceId === src('EC-004') && k === 1
        ? { verdict: 'fail', actual: '첫 습관 만들기 스텝에서 뒤로가기 시 닉네임 설정 스텝으로 되돌아감', defectId: 'D-0' }
        : undefined,
      `run-121-${k}`,
    ),
  ),
);

export const defects121: Defect[] = [
  {
    id: 'D-0',
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

export type ConsoleDevice = {
  serial: string;
  model: string;
  osBuild: string;
  resolution: string;
  battery: number;
  connection: 'USB' | 'Wi-Fi';
  status: 'idle' | 'running';
};

export type ConsoleQueueItem = {
  tcId: string;
  title: string;
  mode: TestCase['mode'];
  status: 'done' | 'running' | 'pending';
  verdict?: Verdict;
};

export type ConsoleSession = {
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

export type ClaudeCodeState = {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  /** pro · max */
  plan?: string;
  /** 플랜 사용 한도에 닿았으면 풀리는 시각 */
  limitedUntil?: string;
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
        text: `${s.action === 'input' ? `입력 "${s.input}"` : s.action === 'env' ? 'adb shell pm clear com.example.harukong' : s.action}${where}`,
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
  const share = element('invite', 'invite_share');
  const prep = base.steps.filter((s) => s.action !== 'verify');
  const last = prep.at(-1)!;
  const tap: ExecStep = {
    index: prep.length + 1,
    action: 'tap',
    target: { label: share.label, elementId: share.id, bounds: share.bounds },
    intent: '[메이트 초대하기]를 눌러 OS 공유 시트를 연다',
    screenshot: shot('invite'),
    videoTs: last.videoTs + last.durationMs,
    durationMs: 1300,
    caseStepIndex: 0,
  };
  base.steps = [...prep, tap];
  const shareIdx = base.steps.length - 1;
  const manual: ExecStep = {
    index: shareIdx + 2,
    action: 'manual',
    intent: '수동 스텝: 공유 시트에서 카카오톡으로 링크를 보내거나 시트를 취소 (외부 발송 — 실행자 확인 필요)',
    screenshot: shot('share-sheet'),
    videoTs: (base.steps[shareIdx]?.videoTs ?? 0) + (base.steps[shareIdx]?.durationMs ?? 0),
    durationMs: 0,
    risk: { kind: '외부 발송', planned: true },
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

export type FixtureDb = {
  projects: Project[];
  qaDocs: QADocument[];
  builds: Build[];
  cycles: TestCycle[];
  results: Record<string, CaseResult[]>;
  defects: Record<string, Defect[]>;
  runs: Record<string, Run[]>;
  prepFlows: PrepFlow[];
  console: ConsoleSession;
};

/** 매번 새 사본을 만든다 (메모리 구현이 수정해도 원본이 바뀌지 않게). */
export function createFixtureDb(): FixtureDb {
  return structuredClone({
    projects: [project],
    qaDocs: [qaDocV130, qaDocV120],
    builds,
    cycles: [cycle130, cycle121],
    results: { [cycle130.id]: results130, [cycle121.id]: results121 },
    defects: { [cycle130.id]: defects130, [cycle121.id]: defects121 },
    runs: { [cycle130.id]: runs130, [cycle121.id]: [] },
    prepFlows: PREP_FLOWS,
    console: consoleSession(),
  });
}
