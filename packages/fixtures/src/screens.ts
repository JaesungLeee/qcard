import type { Bounds } from '@qcard/shared';

/** 목업 디바이스 해상도 (px). Galaxy S24·Pixel 8과 같은 1080×2400 비율. */
export const DEVICE_SIZE = { w: 1080, h: 2400 } as const;

export type MockElementKind =
  | 'statusbar'
  | 'appbar-title'
  | 'text-button'
  | 'icon-button'
  | 'title'
  | 'body'
  | 'input'
  | 'image'
  | 'button'
  | 'dots'
  | 'toast'
  | 'sheet'
  | 'app-icon'
  | 'bottom-nav'
  | 'label';

export type MockElement = {
  /** 접근성 트리의 resource-id 역할 (testTag) */
  id: string;
  kind: MockElementKind;
  label: string;
  bounds: Bounds;
};

export type MockScreenDef = { name: string; dim?: boolean; elements: MockElement[] };

const b = (x: number, y: number, w: number, h: number): Bounds => ({ x, y, w, h });
const STATUS: MockElement = { id: 'statusbar', kind: 'statusbar', label: '9:41', bounds: b(0, 0, 1080, 80) };

const GUIDES = [
  '오늘 탭에서 습관 카드를 눌러 체크해요',
  '카드를 길게 누르면 한 줄 메모를 남겨요',
  '연속 기록이 쌓이면 콩이 자라요',
  '기록 탭에서 주간 리포트를 확인해요',
  '작은 습관부터 오늘 바로 시작해요',
];

/** 사용법 안내 스텝 1~5 (가상 앱 하루콩의 온보딩 마지막 단계) */
function guide(step: number): MockScreenDef {
  const last = step === 5;
  return {
    name: `사용법 안내 스텝 ${step}`,
    elements: [
      STATUS,
      { id: 'guide_title', kind: 'appbar-title', label: '사용법', bounds: b(340, 110, 400, 100) },
      ...(last
        ? []
        : [{ id: 'guide_skip', kind: 'text-button' as const, label: '건너뛰기', bounds: b(820, 110, 220, 100) }]),
      { id: 'guide_step', kind: 'label', label: `STEP ${step}`, bounds: b(60, 280, 300, 70) },
      { id: 'guide_text', kind: 'title', label: GUIDES[step - 1]!, bounds: b(60, 360, 960, 160) },
      { id: 'guide_image', kind: 'image', label: `예시 이미지 ${step}`, bounds: b(140, 600, 800, 1180) },
      { id: 'guide_dots', kind: 'dots', label: `${step}/5`, bounds: b(390, 1860, 300, 60) },
      ...(last
        ? [{ id: 'guide_start', kind: 'button' as const, label: '하루콩 시작하기', bounds: b(60, 2160, 960, 160) }]
        : []),
    ],
  };
}

const MATE_BASE: MockElement[] = [
  STATUS,
  { id: 'mate_close', kind: 'icon-button', label: '닫기', bounds: b(930, 110, 110, 110) },
  { id: 'mate_title', kind: 'title', label: '함께할 메이트를 불러볼까요?', bounds: b(60, 320, 960, 120) },
  {
    id: 'mate_body',
    kind: 'body',
    label: '혼자 하면 사흘, 같이 하면 습관이 돼요. 메이트가 들어오면 서로의 체크를 응원할 수 있어요.',
    bounds: b(60, 460, 960, 220),
  },
  { id: 'mate_image', kind: 'image', label: '메이트 일러스트', bounds: b(240, 820, 600, 600) },
  { id: 'mate_share', kind: 'button', label: '메이트 초대하기', bounds: b(60, 1960, 960, 160) },
  { id: 'mate_copy', kind: 'text-button', label: '초대 링크 복사', bounds: b(60, 2150, 960, 130) },
];

export const SCREENS: Record<string, MockScreenDef> = {
  splash: {
    name: '스플래시',
    elements: [STATUS, { id: 'splash_logo', kind: 'image', label: '하루콩', bounds: b(390, 1000, 300, 300) }],
  },
  nickname: {
    name: '닉네임 설정',
    elements: [
      STATUS,
      { id: 'nickname_title', kind: 'appbar-title', label: '닉네임 설정', bounds: b(300, 110, 480, 100) },
      { id: 'nickname_avatar', kind: 'image', label: '캐릭터 이미지', bounds: b(390, 320, 300, 300) },
      { id: 'nickname_input', kind: 'input', label: '닉네임', bounds: b(60, 720, 960, 150) },
      { id: 'nickname_helper', kind: 'body', label: '2~10자, 한글·영문·숫자', bounds: b(60, 890, 960, 70) },
      { id: 'nickname_save', kind: 'button', label: '저장', bounds: b(60, 2160, 960, 160) },
    ],
  },
  'habit-create': {
    name: '첫 습관 만들기',
    elements: [
      STATUS,
      { id: 'habit_skip', kind: 'text-button', label: '건너뛰기', bounds: b(820, 110, 220, 100) },
      { id: 'habit_title', kind: 'title', label: '첫 습관을 하나 정해 볼까요?', bounds: b(60, 280, 960, 120) },
      { id: 'habit_name', kind: 'input', label: '습관 이름', bounds: b(60, 480, 960, 150) },
      { id: 'habit_icon', kind: 'image', label: '습관 아이콘', bounds: b(60, 700, 960, 540) },
      { id: 'habit_create', kind: 'button', label: '습관 만들기', bounds: b(60, 2160, 960, 160) },
    ],
  },
  'mate-invite': { name: '메이트 초대', elements: MATE_BASE },
  'mate-toast': {
    name: '메이트 초대 · 복사 토스트',
    elements: [
      ...MATE_BASE,
      { id: 'toast', kind: 'toast', label: '초대 링크를 복사했어요', bounds: b(90, 2120, 900, 120) },
    ],
  },
  'share-sheet': {
    name: 'OS 공유 시트',
    dim: true,
    elements: [
      ...MATE_BASE,
      { id: 'share_sheet', kind: 'sheet', label: '공유', bounds: b(0, 1480, 1080, 920) },
      { id: 'share_messenger', kind: 'app-icon', label: '메신저', bounds: b(80, 1700, 200, 240) },
      { id: 'share_message', kind: 'app-icon', label: '메시지', bounds: b(320, 1700, 200, 240) },
      { id: 'share_copy', kind: 'app-icon', label: '복사', bounds: b(560, 1700, 200, 240) },
    ],
  },
  'guide-1': guide(1),
  'guide-2': guide(2),
  'guide-3': guide(3),
  'guide-4': guide(4),
  'guide-5': guide(5),
  today: {
    name: '오늘',
    elements: [
      STATUS,
      { id: 'today_title', kind: 'appbar-title', label: '오늘', bounds: b(60, 110, 300, 100) },
      { id: 'today_list', kind: 'image', label: '오늘의 습관', bounds: b(0, 240, 1080, 1980) },
      { id: 'today_empty', kind: 'body', label: '오늘 체크한 습관이 아직 없어요', bounds: b(140, 1100, 800, 90) },
      { id: 'bottom_nav', kind: 'bottom-nav', label: '오늘 · 기록 · 마이', bounds: b(0, 2220, 1080, 180) },
    ],
  },
  launcher: {
    name: '런처 (앱 백그라운드)',
    elements: [
      STATUS,
      { id: 'launcher_harukong', kind: 'app-icon', label: '하루콩', bounds: b(100, 1700, 200, 240) },
      { id: 'launcher_camera', kind: 'app-icon', label: '카메라', bounds: b(330, 1700, 200, 240) },
      { id: 'launcher_settings', kind: 'app-icon', label: '설정', bounds: b(560, 1700, 200, 240) },
      { id: 'launcher_store', kind: 'app-icon', label: 'Play 스토어', bounds: b(790, 1700, 200, 240) },
    ],
  },
};

export type ScreenKey = keyof typeof SCREENS;

export function element(screen: string, id: string): MockElement {
  const el = SCREENS[screen]?.elements.find((e) => e.id === id);
  if (!el) throw new Error(`목업 화면 요소 없음: ${screen}#${id}`);
  return el;
}
