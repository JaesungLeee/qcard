import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseUiTree } from './tree';
import {
  DestructiveActionError,
  DeviceError,
  EnvActionUnavailableError,
  UnsupportedInputError,
  type DeviceDriver,
  type DeviceInfo,
  type InstalledApp,
  type KeyboardState,
  type NetworkKind,
  type Point,
  type SystemKey,
} from './types';

/** `adb <args>` 실행. 테스트에서는 이걸 바꿔 끼워 생성되는 명령만 확인한다. */
export type AdbExec = (args: string[]) => Promise<Buffer>;

export class AdbCommandError extends DeviceError {
  override name = 'AdbCommandError';
}

/**
 * adb 실행 파일: `ADB` 환경변수 → Android SDK(`ANDROID_HOME`·`ANDROID_SDK_ROOT`·macOS 기본 위치) → PATH의 `adb`.
 * Android Studio로 SDK만 깔고 PATH에 넣지 않은 경우가 많아서 SDK 위치를 먼저 본다.
 */
export function resolveAdb(env: Record<string, string | undefined> = process.env, exists = existsSync): string {
  if (env.ADB) return env.ADB;
  const sdks = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk')];
  for (const sdk of sdks) {
    if (!sdk) continue;
    const bin = join(sdk, 'platform-tools', 'adb');
    if (exists(bin)) return bin;
  }
  return 'adb';
}

export const execAdb =
  (bin = resolveAdb(), timeoutMs = 20_000): AdbExec =>
  (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { encoding: 'buffer', maxBuffer: 64 << 20, timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) reject(new AdbCommandError(`adb ${args.join(' ')} 실패: ${stderr.toString().trim() || err.message}`));
        else resolve(stdout);
      });
    });

/** `dumpsys window InputMethod`의 키보드 창 위쪽 y. 버전에 따라 `mFrame=` 또는 `frame=` */
export function parseImeTop(out: string): number | undefined {
  const m = out.match(/\b(?:mFrame|frame)=\[-?\d+,(-?\d+)\]\[-?\d+,-?\d+\]/);
  return m ? Number(m[1]) : undefined;
}

export type AdbDeviceEntry = { serial: string; state: string; model?: string };

/** `adb devices -l` 출력 */
export function parseDevices(out: string): AdbDeviceEntry[] {
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial = '', state = '', ...rest] = l.split(/\s+/);
      const model = rest.find((r) => r.startsWith('model:'))?.slice(6);
      return { serial, state, model };
    });
}

export async function listDevices(exec: AdbExec = execAdb()): Promise<AdbDeviceEntry[]> {
  return parseDevices((await exec(['devices', '-l'])).toString());
}

/** `dumpsys package <pkg>`: 패키지 블록의 versionCode·versionName. 설치돼 있지 않으면 undefined */
export function parseInstalledApp(out: string, pkg: string): InstalledApp | undefined {
  const block = out.split(/\n\s*Package \[/).find((b) => b.startsWith(`${pkg}]`));
  const code = block && /versionCode=(\d+)/.exec(block)?.[1];
  if (!code) return undefined;
  const name = /versionName=(\S+)/.exec(block)?.[1];
  return { versionCode: Number(code), ...(name ? { versionName: name } : {}) };
}

/** `wm size` / `wm density`: 덮어쓴 값(Override)이 있으면 그것이 실제 화면 기준 */
export function parseWm(out: string): string | undefined {
  return (out.match(/Override \w+: (\S+)/) ?? out.match(/Physical \w+: (\S+)/))?.[1];
}

/** Wi-Fi ADB 시리얼: `192.168.0.5:5555`, `adb-XXXX._adb-tls-connect._tcp` */
export const isWifiSerial = (serial: string) => serial.includes(':') || serial.includes('._adb-tls-');

const SHELL_SPECIAL = /[\\'"()<>|;&*~$`?#[\]{}!]/g;

/**
 * `adb shell input text`용 이스케이프. 공백은 `%s`, 셸 특수문자는 역슬래시.
 * `input text`는 ASCII만 입력할 수 있어 한글 등은 거부한다 — IME(ADBKeyboard)나 Appium이 필요하다.
 */
export function escapeInputText(text: string): string {
  if (/[^\x20-\x7e]/.test(text)) {
    throw new UnsupportedInputError(
      'adb input text는 ASCII만 입력할 수 있습니다. 한글은 ADBKeyboard를 설치·활성화해야 합니다 (ime enable com.android.adbkeyboard/.AdbIME).',
    );
  }
  return text.replace(SHELL_SPECIAL, (c) => `\\${c}`).replace(/ /g, '%s');
}

/** 한글 등 ASCII가 아닌 입력용 IME (https://github.com/senzhk/ADBKeyBoard) */
export const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME';
const isAscii = (t: string) => /^[\x20-\x7e]*$/.test(t);

const KEYCODE: Record<SystemKey, number> = { back: 4, home: 3, enter: 66 };
const DUMP_PATH = '/sdcard/qcard_window_dump.xml';

/**
 * ADB로 실기기를 제어한다. 파괴적 명령(앱 데이터 삭제·설치)은 `allowDestructive`로 켜야 한다.
 * UIAutomator 덤프가 느리면(실측 후) 같은 인터페이스로 Appium 구현을 추가한다.
 */
export class AdbDriver implements DeviceDriver {
  private cachedInfo?: DeviceInfo;
  private readonly exec: AdbExec;
  private readonly allowDestructive: boolean;
  private readonly imeSwitchDelayMs: number;
  private adbKeyboard?: boolean;

  constructor(
    readonly serial: string,
    options: { exec?: AdbExec; allowDestructive?: boolean; imeSwitchDelayMs?: number } = {},
  ) {
    this.exec = options.exec ?? execAdb();
    this.allowDestructive = options.allowDestructive ?? false;
    this.imeSwitchDelayMs = options.imeSwitchDelayMs ?? 300;
  }

  private run(...args: string[]) {
    return this.exec(['-s', this.serial, ...args]);
  }
  private async shell(...args: string[]) {
    return (await this.run('shell', ...args)).toString();
  }
  private guard(what: string) {
    if (!this.allowDestructive)
      throw new DestructiveActionError(`${what}은(는) allowDestructive가 꺼져 있어 막았습니다`);
  }

  async info(): Promise<DeviceInfo> {
    if (this.cachedInfo) return this.cachedInfo;
    const [model, release, size, density] = await Promise.all([
      this.shell('getprop', 'ro.product.model'),
      this.shell('getprop', 'ro.build.version.release'),
      this.shell('wm', 'size'),
      this.shell('wm', 'density'),
    ]);
    const [w, h] = (parseWm(size) ?? '0x0').split('x').map(Number) as [number, number];
    this.cachedInfo = {
      serial: this.serial,
      model: model.trim(),
      osMajor: parseInt(release, 10),
      size: { w, h },
      density: Number(parseWm(density) ?? 0),
      connection: isWifiSerial(this.serial) ? 'wifi' : 'usb',
    };
    return this.cachedInfo;
  }

  async screenshot() {
    return new Uint8Array(await this.run('exec-out', 'screencap', '-p'));
  }

  /** uiautomator 덤프 원본 XML (녹화용) */
  async dumpXml() {
    await this.shell('uiautomator', 'dump', DUMP_PATH);
    return (await this.run('exec-out', 'cat', DUMP_PATH)).toString();
  }

  async dumpTree() {
    return parseUiTree(await this.dumpXml());
  }

  async foregroundPackage() {
    const out = await this.shell('dumpsys', 'window');
    // 일반 창: `Window{abc u0 com.pkg/com.pkg.MainActivity}` · 스플래시(Android 12+): `Window{abc u0 Splash Screen com.pkg}`
    return out.match(/mCurrentFocus=Window\{\S+ \S+ (?:Splash Screen )?([\w.]+)[/}]/)?.[1];
  }

  async keyboard(): Promise<KeyboardState> {
    if (!/mInputShown=true/.test(await this.shell('dumpsys', 'input_method'))) return { shown: false };
    return { shown: true, top: parseImeTop(await this.shell('dumpsys', 'window', 'InputMethod')) };
  }

  async tap(x: number, y: number) {
    await this.shell('input', 'tap', String(Math.round(x)), String(Math.round(y)));
  }

  /**
   * ASCII는 `input text`. 그 밖(한글 등)은 ADBKeyboard로 잠깐 바꿔 base64로 보내고 원래 키보드로 되돌린다.
   * ADBKeyboard가 없으면 UnsupportedInputError → 케이스 Blocked.
   */
  async inputText(text: string) {
    if (isAscii(text)) {
      await this.shell('input', 'text', escapeInputText(text));
      return;
    }
    this.adbKeyboard ??= (await this.shell('ime', 'list', '-s')).split('\n').some((l) => l.trim() === ADB_KEYBOARD_IME);
    if (!this.adbKeyboard) escapeInputText(text); // ADBKeyboard 안내와 함께 던진다
    const prev = (await this.shell('settings', 'get', 'secure', 'default_input_method')).trim();
    const pause = () => new Promise((r) => setTimeout(r, this.imeSwitchDelayMs));
    if (prev !== ADB_KEYBOARD_IME) {
      await this.shell('ime', 'set', ADB_KEYBOARD_IME);
      await pause();
    }
    try {
      await this.shell(
        'am',
        'broadcast',
        '-a',
        'ADB_INPUT_B64',
        '--es',
        'msg',
        Buffer.from(text, 'utf8').toString('base64'),
      );
    } finally {
      if (prev && prev !== 'null' && prev !== ADB_KEYBOARD_IME) await this.shell('ime', 'set', prev);
    }
  }

  async swipe(from: Point, to: Point, durationMs = 300) {
    await this.shell('input', 'swipe', ...[...from, ...to].map((n) => String(Math.round(n))), String(durationMs));
  }

  async pressKey(key: SystemKey) {
    await this.shell('input', 'keyevent', String(KEYCODE[key]));
  }

  async launchApp(pkg: string) {
    await this.shell('monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
  }

  async stopApp(pkg: string) {
    await this.shell('am', 'force-stop', pkg);
  }

  async clearAppData(pkg: string) {
    this.guard('앱 데이터 삭제');
    await this.shell('pm', 'clear', pkg);
  }

  async installApk(path: string) {
    this.guard('APK 설치');
    await this.run('install', '-r', path);
  }

  async installedApp(pkg: string) {
    return parseInstalledApp(await this.shell('dumpsys', 'package', pkg), pkg);
  }


  async setNetwork(kind: NetworkKind, enabled: boolean) {
    if (!enabled && kind === 'wifi' && (await this.info()).connection === 'wifi') {
      throw new EnvActionUnavailableError('Wi-Fi ADB로 연결된 디바이스는 Wi-Fi를 끌 수 없습니다 (USB 연결 필요)');
    }
    await this.shell('svc', kind, enabled ? 'enable' : 'disable');
  }

  async setPermission(pkg: string, permission: string, granted: boolean) {
    await this.shell('pm', granted ? 'grant' : 'revoke', pkg, permission);
  }
}
