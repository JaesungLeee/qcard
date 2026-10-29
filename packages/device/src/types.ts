import type { Bounds } from '@qcard/shared';

export type Point = readonly [x: number, y: number];

/** 접근성 트리 요소 하나 (uiautomator dump의 node). 좌표는 디바이스 px. */
export type UiElement = {
  /** 한 번의 덤프 안에서만 유효한 번호 (`e0`, `e1` … 문서 순서) */
  ref: string;
  /** resource-id. `패키지:id/` 접두어는 뗀다 (Compose testTag는 접두어가 없다) */
  resourceId?: string;
  text?: string;
  desc?: string;
  cls: string;
  pkg?: string;
  bounds: Bounds;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  scrollable: boolean;
  checked?: boolean;
  password: boolean;
  depth: number;
  /** 부모 요소의 ref */
  parent?: string;
};

export type DeviceInfo = {
  serial: string;
  model: string;
  osMajor: number;
  /** 빌드 번호 (설정 > 휴대전화 정보의 빌드 번호, 예: AP3A.240905.015.A2). 결과에 기록한다 (F-CY-01) */
  build?: string;
  /** 보안 패치 수준 (예: 2025-09-01) */
  securityPatch?: string;
  size: { w: number; h: number };
  /** dpi. dp = px × 160 / dpi */
  density: number;
  /** Wi-Fi ADB면 디바이스 네트워크를 끌 수 없다 (F-EX-16) */
  connection: 'usb' | 'wifi';
};

/** top: 키보드 창의 위쪽 y (px). 모르면 없음 */
export type KeyboardState = { shown: boolean; top?: number };

export type SystemKey = 'back' | 'home' | 'enter';
export type NetworkKind = 'wifi' | 'data';

/**
 * 디바이스 제어. 실기기는 `AdbDriver`, 테스트는 `FakeDevice`.
 * 입력은 포커스된 필드에 들어가므로 `inputText` 전에 필드를 탭한다.
 */
export interface DeviceDriver {
  info(): Promise<DeviceInfo>;
  /** PNG */
  screenshot(): Promise<Uint8Array>;
  dumpTree(): Promise<UiElement[]>;
  foregroundPackage(): Promise<string | undefined>;
  /** 소프트 키보드. 키보드 창은 앱 트리에 없어서, 가려진 버튼을 누르면 키보드 키가 눌린다 */
  keyboard(): Promise<KeyboardState>;

  tap(x: number, y: number): Promise<void>;
  inputText(text: string): Promise<void>;
  swipe(from: Point, to: Point, durationMs?: number): Promise<void>;
  pressKey(key: SystemKey): Promise<void>;

  launchApp(pkg: string): Promise<void>;
  stopApp(pkg: string): Promise<void>;
  /** 앱 데이터 삭제 (`pm clear`). 파괴적 — 드라이버가 허용한 경우에만 */
  clearAppData(pkg: string): Promise<void>;
  /** 파괴적 — 드라이버가 허용한 경우에만. 기존 앱 데이터는 유지한다(`install -r`) */
  installApk(path: string): Promise<void>;
  /** 설치된 앱 버전 (없으면 undefined). 읽기 전용 */
  installedApp(pkg: string): Promise<InstalledApp | undefined>;
  /** 화면 켜짐·잠금 화면 여부. 읽기 전용. 꺼졌거나 잠겨 있으면 Agent가 앱에 닿지 못한다 */
  screenState(): Promise<ScreenState>;
  /**
   * "충전 중 화면 켜짐 유지" (settings global stay_on_while_plugged_in: 0 = 끔, 1 AC·2 USB·4 무선의 합).
   * Run 동안 켜서 화면이 꺼지며 잠기지 않게 하고, 끝나면 원래 값으로 되돌린다
   */
  stayOnWhilePlugged(): Promise<number>;
  setStayOnWhilePlugged(value: number): Promise<void>;

  /** 환경 조작 (F-EX-16) */
  setNetwork(kind: NetworkKind, enabled: boolean): Promise<void>;
  setPermission(pkg: string, permission: string, granted: boolean): Promise<void>;
}

export type InstalledApp = { versionCode: number; versionName?: string };
export type ScreenState = { awake: boolean; locked: boolean };

export class DeviceError extends Error {
  override name = 'DeviceError';
}
/** 파괴적 명령을 허용하지 않은 드라이버에서 호출했다 */
export class DestructiveActionError extends DeviceError {
  override name = 'DestructiveActionError';
}
/** 이 연결·디바이스에서 할 수 없는 환경 조작 → 케이스 Blocked (F-EX-05) */
export class EnvActionUnavailableError extends DeviceError {
  override name = 'EnvActionUnavailableError';
}
export class UnsupportedInputError extends DeviceError {
  override name = 'UnsupportedInputError';
}
/** 디바이스 연결이 끊겼다 (케이스 결함이 아니다 → Run 일시정지, 다시 연결하면 이어서) */
export class DeviceDisconnectedError extends DeviceError {
  override name = 'DeviceDisconnectedError';
}
