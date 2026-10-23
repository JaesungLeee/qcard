import { contains } from './tree';
import {
  DeviceError,
  EnvActionUnavailableError,
  type DeviceDriver,
  type DeviceInfo,
  type InstalledApp,
  type ScreenState,
  type NetworkKind,
  type Point,
  type SystemKey,
  type UiElement,
} from './types';

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export type FakeScreen = {
  /** 녹화한 트리(`parseUiTree` 결과) 또는 합성 트리. ref는 덤프할 때마다 다시 매긴다 */
  tree: UiElement[];
  /** PNG. 없으면 1×1 자리표시 이미지 */
  screenshot?: Uint8Array;
};

export type FakeState = {
  /** resource-id → 입력한 값 (앱 데이터, `clearAppData`로 초기화) */
  values: Record<string, string>;
  network: Record<NetworkKind, boolean>;
  permissions: Record<string, boolean>;
};

export type FakeAction =
  | { kind: 'tap'; target: string }
  | { kind: 'swipe'; direction: SwipeDirection }
  | { kind: 'key'; key: SystemKey }
  /** 화면을 한 번 관찰(`dumpTree`)한 뒤 다음 관찰에서 넘어간다 (스플래시·토스트) */
  | { kind: 'auto' };

export type FakeTransition = {
  from: string;
  on: FakeAction;
  to: string;
  /** 이 조건일 때만 넘어간다 (예: 닉네임 형식이 맞을 때만 저장) */
  when?: (state: FakeState) => boolean;
};

export type FakeScenario = {
  info: DeviceInfo;
  appPackage: string;
  screens: Record<string, FakeScreen>;
  /** 앱을 실행하면 나오는 첫 화면 */
  launch: string;
  /** 런처(홈) 화면. 홈 키·앱 종료 시 여기로 */
  home: string;
  /** 시작 화면 (기본 home) */
  start?: string;
  /** 입력란에 포커스하면 키보드를 띄운다 (top: 키보드 위쪽 y) */
  keyboardOnFocus?: { top: number };
  transitions: FakeTransition[];
};

/** 시나리오에 없는 동작. 테스트가 Agent의 엉뚱한 조작을 바로 잡아내게 한다. */
export class UnexpectedActionError extends DeviceError {
  override name = 'UnexpectedActionError';
}

const LAUNCHER_PKG = 'com.android.launcher3';
const PLACEHOLDER_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);
const isInput = (e: UiElement) => /EditText|TextField/.test(e.cls);

export function swipeDirection(from: Point, to: Point): SwipeDirection {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * 녹화·합성 화면과 전환 규칙(화면 + 동작 → 다음 화면)으로 움직이는 상태 기계.
 * 정의되지 않은 탭·스와이프·뒤로가기는 `UnexpectedActionError`. 홈 키와 앱 실행·종료는 항상 된다.
 */
export class FakeDevice implements DeviceDriver {
  current: string;
  readonly state: FakeState = { values: {}, network: { wifi: true, data: true }, permissions: {} };
  /** 받은 동작 기록 (테스트 확인용) */
  readonly log: string[] = [];
  readonly installed: string[] = [];
  /** 설치된 앱 버전 (테스트가 정한다) */
  readonly apps: Record<string, InstalledApp> = {};
  /** 화면 켜짐·잠금 (테스트가 바꾼다) */
  display: ScreenState = { awake: true, locked: false };
  private focused?: string;
  private observedCurrent = false;
  /** 홈 키로 백그라운드에 간 앱의 화면. 다시 실행하면 여기로 돌아온다 */
  private background?: string;

  constructor(readonly scenario: FakeScenario) {
    this.current = scenario.start ?? scenario.home;
    for (const s of [scenario.launch, scenario.home, this.current, ...scenario.transitions.map((t) => t.to)]) {
      if (!scenario.screens[s]) throw new Error(`시나리오에 화면이 없음: ${s}`);
    }
  }

  private screen() {
    return this.scenario.screens[this.current]!;
  }

  private go(to: string) {
    if (to !== this.current) {
      this.current = to;
      this.focused = undefined;
      this.observedCurrent = false;
    }
  }

  private transition(match: (on: FakeAction) => boolean) {
    return this.scenario.transitions.find(
      (t) => t.from === this.current && match(t.on) && (t.when?.(this.state) ?? true),
    );
  }

  private unexpected(what: string): never {
    throw new UnexpectedActionError(`화면 '${this.current}'에서 ${what}은(는) 시나리오에 없습니다`);
  }

  async info() {
    return this.scenario.info;
  }

  async screenshot() {
    return this.screen().screenshot ?? PLACEHOLDER_PNG;
  }

  async dumpTree(): Promise<UiElement[]> {
    if (this.observedCurrent) {
      const auto = this.transition((on) => on.kind === 'auto');
      if (auto) this.go(auto.to);
    }
    this.observedCurrent = true;
    return this.screen().tree.map((e, i) => ({
      ...e,
      ref: `e${i}`,
      text: (e.resourceId && this.state.values[e.resourceId]) || e.text,
      focused: e.resourceId !== undefined && e.resourceId === this.focused,
    }));
  }

  async foregroundPackage() {
    return this.current === this.scenario.home ? LAUNCHER_PKG : this.scenario.appPackage;
  }

  async keyboard() {
    const k = this.scenario.keyboardOnFocus;
    return k && this.focused ? { shown: true, top: k.top } : { shown: false };
  }

  async tap(x: number, y: number) {
    this.log.push(`tap ${x},${y}`);
    const k = await this.keyboard();
    if (k.shown && k.top !== undefined && y >= k.top) this.unexpected(`키보드에 가려진 (${x},${y}) 탭`);
    const hits = this.screen()
      .tree.filter((e) => e.resourceId && contains(e.bounds, [x, y]))
      .sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h);
    for (const el of hits) {
      const t = this.transition((on) => on.kind === 'tap' && on.target === el.resourceId);
      if (t) return this.go(t.to);
      if (isInput(el)) {
        this.focused = el.resourceId;
        return;
      }
    }
    this.unexpected(`(${x},${y}) 탭${hits[0] ? ` [${hits[0].resourceId}]` : ''}`);
  }

  async inputText(text: string) {
    this.log.push(`input ${text}`);
    if (!this.focused) this.unexpected('포커스 없는 입력');
    this.state.values[this.focused] = (this.state.values[this.focused] ?? '') + text;
  }

  async swipe(from: Point, to: Point) {
    const direction = swipeDirection(from, to);
    this.log.push(`swipe ${direction}`);
    const t = this.transition((on) => on.kind === 'swipe' && on.direction === direction);
    if (!t) this.unexpected(`${direction} 스와이프`);
    this.go(t.to);
  }

  async pressKey(key: SystemKey) {
    this.log.push(`key ${key}`);
    // 키보드가 떠 있으면 뒤로가기는 키보드만 닫는다
    if (key === 'back' && (await this.keyboard()).shown) {
      this.focused = undefined;
      return;
    }
    const t = this.transition((on) => on.kind === 'key' && on.key === key);
    if (t) return this.go(t.to);
    if (key === 'home') {
      if (this.current !== this.scenario.home) this.background = this.current;
      return this.go(this.scenario.home);
    }
    this.unexpected(`${key} 키`);
  }

  async launchApp(pkg: string) {
    this.log.push(`launch ${pkg}`);
    if (pkg !== this.scenario.appPackage) this.unexpected(`다른 앱 실행(${pkg})`);
    // 이미 앱 화면이면 그대로 앞으로 가져온다
    if (this.current === this.scenario.home) this.go(this.background ?? this.scenario.launch);
    this.background = undefined;
  }

  async stopApp(pkg: string) {
    this.log.push(`stop ${pkg}`);
    if (pkg === this.scenario.appPackage) {
      this.background = undefined;
      this.go(this.scenario.home);
    }
  }

  async clearAppData(pkg: string) {
    this.log.push(`clear ${pkg}`);
    if (pkg !== this.scenario.appPackage) return;
    this.state.values = {};
    this.background = undefined;
    this.go(this.scenario.home);
  }

  async installApk(path: string) {
    this.log.push(`install ${path}`);
    this.installed.push(path);
  }

  async installedApp(pkg: string) {
    return this.apps[pkg];
  }

  /** 충전 중 화면 켜짐 유지 (테스트가 본다) */
  stayOn = 0;
  async stayOnWhilePlugged() {
    return this.stayOn;
  }
  async setStayOnWhilePlugged(value: number) {
    this.log.push(`stay-on ${value}`);
    this.stayOn = value;
  }

  async screenState() {
    return this.display;
  }


  async setNetwork(kind: NetworkKind, enabled: boolean) {
    this.log.push(`network ${kind} ${enabled ? 'on' : 'off'}`);
    if (!enabled && kind === 'wifi' && this.scenario.info.connection === 'wifi') {
      throw new EnvActionUnavailableError('Wi-Fi ADB로 연결된 디바이스는 Wi-Fi를 끌 수 없습니다 (USB 연결 필요)');
    }
    this.state.network[kind] = enabled;
  }

  async setPermission(pkg: string, permission: string, granted: boolean) {
    this.log.push(`permission ${permission} ${granted ? 'grant' : 'revoke'}`);
    this.state.permissions[`${pkg}/${permission}`] = granted;
  }
}
