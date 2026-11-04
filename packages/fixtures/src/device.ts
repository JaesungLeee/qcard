import type { FakeScenario, FakeScreen, UiElement } from '@qcard/device';
import { DEVICE_SIZE, SCREENS, type MockElement, type MockElementKind } from './screens';

/*
 * 목업 화면 배치(SCREENS)로 만든 합성 접근성 트리와 온보딩 전환 규칙.
 * 실기기 녹화 전에 FakeDevice로 Agent 루프를 돌리기 위한 첫 데이터다.
 */

/** 가상 앱 하루콩 (qcard 개발·테스트용, 실제 앱 아님) */
export const APP_PACKAGE = 'com.example.harukong';

const CLS: Record<MockElementKind, { cls: string; clickable?: boolean; asDesc?: boolean } | null> = {
  statusbar: null,
  'appbar-title': { cls: 'android.widget.TextView' },
  title: { cls: 'android.widget.TextView' },
  body: { cls: 'android.widget.TextView' },
  label: { cls: 'android.widget.TextView' },
  'text-button': { cls: 'android.widget.Button', clickable: true },
  button: { cls: 'android.widget.Button', clickable: true },
  'icon-button': { cls: 'android.widget.ImageButton', clickable: true, asDesc: true },
  input: { cls: 'android.widget.EditText', clickable: true },
  image: { cls: 'android.widget.ImageView', asDesc: true },
  dots: { cls: 'android.view.View', asDesc: true },
  toast: { cls: 'android.widget.Toast' },
  sheet: { cls: 'android.widget.TextView' },
  'app-icon': { cls: 'android.widget.TextView', clickable: true },
  'bottom-nav': { cls: 'android.view.View' },
};

function toUi(el: MockElement, i: number): UiElement | null {
  const c = CLS[el.kind];
  if (!c) return null;
  return {
    ref: `e${i}`,
    resourceId: el.id,
    text: c.asDesc ? undefined : el.label,
    desc: c.asDesc ? el.label : undefined,
    cls: c.cls,
    pkg:
      el.kind === 'app-icon' && el.id.startsWith('launcher_')
        ? 'com.android.launcher3'
        : el.id.startsWith('share_')
          ? SHARE_SHEET_PKG
          : APP_PACKAGE,
    bounds: el.bounds,
    clickable: c.clickable ?? false,
    enabled: true,
    focused: false,
    scrollable: false,
    password: false,
    depth: 1,
  };
}

/** OS 공유 시트는 대상 앱이 아니라 시스템(`android`)이 띄운다 — 그 안의 탭은 앱 밖 액션이다 */
export const SHARE_SHEET_PKG = 'android';

export function syntheticScreen(key: string): FakeScreen {
  const def = SCREENS[key];
  if (!def) throw new Error(`목업 화면 없음: ${key}`);
  const tree = def.elements.map(toUi).filter((e): e is UiElement => e !== null);
  return key === 'share-sheet' ? { tree, foreground: SHARE_SHEET_PKG } : { tree };
}

/** 닉네임 규칙: 2~10자, 한글·영문·숫자 */
export const validNickname = (v = '') => /^[가-힣a-zA-Z0-9]{2,10}$/.test(v);

/** 하루콩 온보딩 시나리오 (스플래시 → 닉네임 → 첫 습관 → 메이트 초대 → 사용법 안내 → 오늘) */
export function onboardingScenario(connection: 'usb' | 'wifi' = 'usb'): FakeScenario {
  const tap = (from: string, target: string, to: string, when?: FakeScenario['transitions'][number]['when']) => ({
    from,
    on: { kind: 'tap' as const, target },
    to,
    when,
  });
  const guide = [1, 2, 3, 4, 5].flatMap((n) => {
    const from = `guide-${n}`;
    return [
      ...(n < 5
        ? [tap(from, 'guide_skip', 'today'), { from, on: { kind: 'swipe', direction: 'left' }, to: `guide-${n + 1}` }]
        : [tap(from, 'guide_start', 'today')]),
      ...(n > 1 ? [{ from, on: { kind: 'swipe', direction: 'right' }, to: `guide-${n - 1}` }] : []),
    ] as FakeScenario['transitions'];
  });
  return {
    info: {
      serial: connection === 'usb' ? 'FAKE-S24' : '192.168.0.24:5555',
      model: 'SM-S921N',
      osMajor: 15,
      build: 'AP3A.240905.015.A2',
      securityPatch: '2024-10-01',
      size: { w: DEVICE_SIZE.w, h: DEVICE_SIZE.h },
      density: 420,
      connection,
    },
    appPackage: APP_PACKAGE,
    home: 'launcher',
    launch: 'splash',
    screens: Object.fromEntries(Object.keys(SCREENS).map((k) => [k, syntheticScreen(k)])),
    transitions: [
      tap('launcher', 'launcher_harukong', 'splash'),
      { from: 'splash', on: { kind: 'auto' }, to: 'nickname' },
      tap('nickname', 'nickname_save', 'habit-create', (s) => validNickname(s.values.nickname_input)),
      tap('habit-create', 'habit_skip', 'guide-1'),
      tap('habit-create', 'habit_create', 'mate-invite', (s) => Boolean(s.values.habit_name?.trim())),
      tap('mate-invite', 'mate_copy', 'mate-toast'),
      { from: 'mate-toast', on: { kind: 'auto' }, to: 'mate-invite' },
      tap('mate-invite', 'mate_share', 'share-sheet'),
      tap('mate-invite', 'mate_close', 'guide-1'),
      tap('share-sheet', 'share_copy', 'mate-toast'),
      { from: 'share-sheet', on: { kind: 'key', key: 'back' }, to: 'mate-invite' },
      ...guide,
    ],
  };
}
