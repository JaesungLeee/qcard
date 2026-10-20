import type { FakeScenario, FakeScreen, UiElement } from '@qcard/device';
import { DEVICE_SIZE, SCREENS, type MockElement, type MockElementKind } from './screens';

/*
 * 목업 화면 배치(SCREENS)로 만든 합성 접근성 트리와 온보딩 전환 규칙.
 * 실기기 녹화 전에 FakeDevice로 Agent 루프를 돌리기 위한 첫 데이터다.
 */

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
    pkg: el.kind === 'app-icon' && el.id.startsWith('launcher_') ? 'com.android.launcher3' : APP_PACKAGE,
    bounds: el.bounds,
    clickable: c.clickable ?? false,
    enabled: true,
    focused: false,
    scrollable: false,
    password: false,
    depth: 1,
  };
}

export function syntheticScreen(key: string): FakeScreen {
  const def = SCREENS[key];
  if (!def) throw new Error(`목업 화면 없음: ${key}`);
  return { tree: def.elements.map(toUi).filter((e): e is UiElement => e !== null) };
}

/** 닉네임 규칙: 2~10자, 한글·영문·숫자 */
export const validNickname = (v = '') => /^[가-힣a-zA-Z0-9]{2,10}$/.test(v);

/** 하루콩 온보딩 플로우 시나리오 (스플래시 → 프로필 → 습관 → 메이트 초대 → 튜토리얼 → 홈) */
export function onboardingScenario(connection: 'usb' | 'wifi' = 'usb'): FakeScenario {
  const tap = (from: string, target: string, to: string, when?: FakeScenario['transitions'][number]['when']) => ({
    from,
    on: { kind: 'tap' as const, target },
    to,
    when,
  });
  const tutorial = [1, 2, 3, 4, 5].flatMap((n) => {
    const from = `tutorial-${n}`;
    return [
      ...(n < 5
        ? [
            tap(from, 'tutorial_skip', 'home'),
            { from, on: { kind: 'swipe', direction: 'left' }, to: `tutorial-${n + 1}` },
          ]
        : [tap(from, 'tutorial_start', 'home')]),
      ...(n > 1 ? [{ from, on: { kind: 'swipe', direction: 'right' }, to: `tutorial-${n - 1}` }] : []),
    ] as FakeScenario['transitions'];
  });
  return {
    info: {
      serial: connection === 'usb' ? 'FAKE-S24' : '192.168.0.24:5555',
      model: 'SM-S921N',
      osMajor: 15,
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
      { from: 'splash', on: { kind: 'auto' }, to: 'profile' },
      tap('profile', 'profile_save', 'room-create', (s) => validNickname(s.values.profile_nickname)),
      tap('room-create', 'room_skip', 'tutorial-1'),
      tap('room-create', 'room_create', 'invite', (s) => Boolean(s.values.room_name?.trim())),
      tap('invite', 'invite_copy', 'invite-toast'),
      { from: 'invite-toast', on: { kind: 'auto' }, to: 'invite' },
      tap('invite', 'invite_share', 'share-sheet'),
      tap('invite', 'invite_close', 'tutorial-1'),
      tap('share-sheet', 'share_copy', 'invite-toast'),
      { from: 'share-sheet', on: { kind: 'key', key: 'back' }, to: 'invite' },
      ...tutorial,
    ],
  };
}
