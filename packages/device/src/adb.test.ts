import { describe, expect, it } from 'vitest';
import {
  AdbDriver,
  escapeInputText,
  isWifiSerial,
  parseDevices,
  parseImeTop,
  isDisconnected,
  parseInstalledApp,
  parseScreenState,
  parseWm,
  resolveAdb,
  type AdbExec,
} from './adb';
import { DestructiveActionError, EnvActionUnavailableError, UnsupportedInputError } from './types';

/** 명령만 기록하고 정해진 출력을 돌려주는 가짜 adb */
function fakeAdb(outputs: Record<string, string> = {}) {
  const calls: string[] = [];
  const exec: AdbExec = async (args) => {
    const cmd = args.join(' ');
    calls.push(cmd);
    const hit = Object.entries(outputs).find(([k]) => cmd.endsWith(k));
    return Buffer.from(hit?.[1] ?? '');
  };
  return { exec, calls };
}

const INFO = {
  'getprop ro.product.model': 'SM-S921N\n',
  'getprop ro.build.version.release': '15\n',
  'getprop ro.build.display.id': 'AP3A.240905.015.A2.S921NKSU2BXK1\n',
  'getprop ro.build.id': 'AP3A.240905.015.A2\n',
  'getprop ro.build.version.security_patch': '2025-09-01\n',
  'wm size': 'Physical size: 1080x2340\n',
  'wm density': 'Physical density: 450\nOverride density: 420\n',
};

describe('AdbDriver 명령', () => {
  it('조작은 시리얼을 붙인 adb shell input 명령이 된다', async () => {
    const { exec, calls } = fakeAdb();
    const d = new AdbDriver('R3CX123', { exec });
    await d.tap(540.4, 2240.6);
    await d.swipe([900, 1200], [180, 1200], 250);
    await d.pressKey('back');
    await d.inputText('qa user');
    await d.launchApp('com.example.harukong');
    expect(calls).toEqual([
      '-s R3CX123 shell input tap 540 2241',
      '-s R3CX123 shell input swipe 900 1200 180 1200 250',
      '-s R3CX123 shell input keyevent 4',
      '-s R3CX123 shell input text qa%suser',
      '-s R3CX123 shell monkey -p com.example.harukong -c android.intent.category.LAUNCHER 1',
    ]);
  });

  it('한글은 ADBKeyboard로 바꿔 base64로 보내고 원래 키보드로 되돌린다', async () => {
    const { exec, calls } = fakeAdb({
      'ime list -s': 'com.samsung.android.honeyboard/.service.HoneyBoardService\ncom.android.adbkeyboard/.AdbIME\n',
      'settings get secure default_input_method': 'com.samsung.android.honeyboard/.service.HoneyBoardService\n',
    });
    await new AdbDriver('R3CX123', { exec, imeSwitchDelayMs: 0 }).inputText('콩콩이');
    expect(calls).toEqual([
      '-s R3CX123 shell ime list -s',
      '-s R3CX123 shell settings get secure default_input_method',
      '-s R3CX123 shell ime set com.android.adbkeyboard/.AdbIME',
      `-s R3CX123 shell am broadcast -a ADB_INPUT_B64 --es msg ${Buffer.from('콩콩이').toString('base64')}`,
      '-s R3CX123 shell ime set com.samsung.android.honeyboard/.service.HoneyBoardService',
    ]);
  });

  it('ADBKeyboard가 없으면 한글 입력은 거부한다', async () => {
    const { exec, calls } = fakeAdb({ 'ime list -s': 'com.samsung.android.honeyboard/.service.HoneyBoardService\n' });
    await expect(new AdbDriver('R3CX123', { exec }).inputText('하루콩')).rejects.toBeInstanceOf(UnsupportedInputError);
    expect(calls).toEqual(['-s R3CX123 shell ime list -s']);
  });

  it('디바이스 정보를 읽는다 (덮어쓴 density 우선, USB 연결)', async () => {
    const { exec } = fakeAdb(INFO);
    expect(await new AdbDriver('R3CX123', { exec }).info()).toEqual({
      serial: 'R3CX123',
      model: 'SM-S921N',
      osMajor: 15,
      build: 'AP3A.240905.015.A2.S921NKSU2BXK1',
      securityPatch: '2025-09-01',
      size: { w: 1080, h: 2340 },
      density: 420,
      connection: 'usb',
    });
  });

  it('빌드 번호는 display.id가 비면 build.id, 값이 없는 속성은 넣지 않는다 (F-CY-01)', async () => {
    const { exec } = fakeAdb({
      ...INFO,
      'getprop ro.build.display.id': '\n',
      'getprop ro.build.version.security_patch': '',
    });
    const info = await new AdbDriver('R3CX123', { exec }).info();
    expect(info.build).toBe('AP3A.240905.015.A2');
    expect(info).not.toHaveProperty('securityPatch');
  });

  it('트리는 덤프 파일을 받아 파싱한다', async () => {
    const { exec, calls } = fakeAdb({
      'cat /sdcard/qcard_window_dump.xml': '<node text="저장" class="android.widget.Button" bounds="[0,0][10,10]" />',
    });
    const tree = await new AdbDriver('R3CX123', { exec }).dumpTree();
    expect(tree[0]?.text).toBe('저장');
    expect(calls).toEqual([
      '-s R3CX123 shell uiautomator dump /sdcard/qcard_window_dump.xml',
      '-s R3CX123 exec-out cat /sdcard/qcard_window_dump.xml',
    ]);
  });

  it('포그라운드 앱 패키지를 dumpsys에서 찾는다', async () => {
    const { exec } = fakeAdb({
      'dumpsys window': '  mCurrentFocus=Window{a1b2c3 u0 com.example.harukong/com.example.harukong.MainActivity}\n',
    });
    expect(await new AdbDriver('R3CX123', { exec }).foregroundPackage()).toBe('com.example.harukong');
    const splash = fakeAdb({ 'dumpsys window': '  mCurrentFocus=Window{d4e5f6 u0 Splash Screen com.example.harukong.qa}\n' });
    expect(await new AdbDriver('R3CX123', { exec: splash.exec }).foregroundPackage()).toBe('com.example.harukong.qa');
  });

  it('키보드 표시 여부와 위쪽 y를 읽는다', async () => {
    const shown = fakeAdb({
      'dumpsys input_method': '  mInputShown=true\n',
      'dumpsys window InputMethod':
        '  Window #1 Window{1 u0 InputMethod}:\n    mFrame=[0,1386][1080,2340] last=[0,0][0,0]\n',
    });
    expect(await new AdbDriver('R3CX123', { exec: shown.exec }).keyboard()).toEqual({ shown: true, top: 1386 });
    const hidden = fakeAdb({ 'dumpsys input_method': '  mInputShown=false\n' });
    expect(await new AdbDriver('R3CX123', { exec: hidden.exec }).keyboard()).toEqual({ shown: false });
    expect(hidden.calls).toEqual(['-s R3CX123 shell dumpsys input_method']);
    expect(parseImeTop('    frame=[0,1200][1080,2340]')).toBe(1200);
    expect(parseImeTop('nothing')).toBeUndefined();
  });

  it('파괴적 명령은 허용하지 않으면 막는다', async () => {
    const { exec, calls } = fakeAdb();
    const safe = new AdbDriver('R3CX123', { exec });
    await expect(safe.clearAppData('com.example.harukong')).rejects.toBeInstanceOf(DestructiveActionError);
    await expect(safe.installApk('/tmp/app.apk')).rejects.toBeInstanceOf(DestructiveActionError);
    expect(calls).toEqual([]);
    await new AdbDriver('R3CX123', { exec, allowDestructive: true }).clearAppData('com.example.harukong');
    expect(calls).toEqual(['-s R3CX123 shell pm clear com.example.harukong']);
  });

  it('Wi-Fi ADB 디바이스에서는 Wi-Fi를 끌 수 없다 (F-EX-16)', async () => {
    const { exec, calls } = fakeAdb(INFO);
    const wifi = new AdbDriver('192.168.0.5:5555', { exec });
    await expect(wifi.setNetwork('wifi', false)).rejects.toBeInstanceOf(EnvActionUnavailableError);
    await wifi.setNetwork('data', false);
    expect(calls.at(-1)).toBe('-s 192.168.0.5:5555 shell svc data disable');
  });

  it('권한 부여·회수', async () => {
    const { exec, calls } = fakeAdb();
    await new AdbDriver('R3CX123', { exec }).setPermission(
      'com.example.harukong',
      'android.permission.POST_NOTIFICATIONS',
      false,
    );
    expect(calls).toEqual(['-s R3CX123 shell pm revoke com.example.harukong android.permission.POST_NOTIFICATIONS']);
  });
});

describe('파서·이스케이프', () => {
  it('adb 위치: ADB 환경변수 → SDK의 platform-tools → PATH', () => {
    expect(resolveAdb({ ADB: '/opt/adb' }, () => false)).toBe('/opt/adb');
    expect(resolveAdb({ ANDROID_HOME: '/sdk' }, (p) => p === '/sdk/platform-tools/adb')).toBe(
      '/sdk/platform-tools/adb',
    );
    expect(resolveAdb({}, () => false)).toBe('adb');
  });

  it('adb devices -l', () => {
    expect(
      parseDevices(
        'List of devices attached\nR3CX123  device usb:1-1 product:e1q model:SM_S921N device:e1q transport_id:1\nemulator-5554 offline\n\n',
      ),
    ).toEqual([
      { serial: 'R3CX123', state: 'device', model: 'SM_S921N' },
      { serial: 'emulator-5554', state: 'offline', model: undefined },
    ]);
  });

  it('dumpsys package: 해당 패키지 블록의 버전만 읽는다 (설치 안 됐으면 undefined)', () => {
    const out = [
      'Activity Resolver Table:',
      'Packages:',
      '  Package [com.example.harukong.qa.helper] (1a2b3c):',
      '    versionCode=7 minSdk=24 targetSdk=35',
      '    versionName=0.1',
      '  Package [com.example.harukong.qa] (4d5e6f):',
      '    userId=10321',
      '    versionCode=130 minSdk=26 targetSdk=36',
      '    versionName=1.3.0-qa',
      '',
    ].join('\n');
    expect(parseInstalledApp(out, 'com.example.harukong.qa')).toEqual({ versionCode: 130, versionName: '1.3.0-qa' });
    expect(parseInstalledApp('Unable to find package: com.x\n', 'com.x')).toBeUndefined();
  });

  it('wm 출력은 Override가 있으면 그 값', () => {
    expect(parseWm('Physical size: 1080x2400\n')).toBe('1080x2400');
    expect(parseWm('Physical size: 1080x2400\nOverride size: 720x1600\n')).toBe('720x1600');
  });

  it('Wi-Fi 시리얼 판별', () => {
    expect(isWifiSerial('192.168.0.5:5555')).toBe(true);
    expect(isWifiSerial('adb-R3CX123-abc._adb-tls-connect._tcp')).toBe(true);
    expect(isWifiSerial('R3CX123')).toBe(false);
  });

  it('입력 텍스트: 공백은 %s, 셸 특수문자는 이스케이프, 한글은 거부', () => {
    expect(escapeInputText(`a b&c'd$(e)`)).toBe(`a%sb\\&c\\'d\\$\\(e\\)`);
    expect(() => escapeInputText('하루콩러버')).toThrow(UnsupportedInputError);
  });
});

describe('parseScreenState', () => {
  it('켜짐은 mWakefulness=Awake, 잠금은 isKeyguardShowing=true', () => {
    const power = (w: string) => `Power Manager State:\n  mWakefulness=${w}\n  mWakefulnessChanging=false\n`;
    const window = (k: boolean) => `    mShowingDream=false mDreamingLockscreen=${k}\n    isKeyguardShowing=${k}\n`;
    expect(parseScreenState(power('Awake'), window(false))).toEqual({ awake: true, locked: false });
    expect(parseScreenState(power('Dozing'), window(true))).toEqual({ awake: false, locked: true });
    expect(parseScreenState(power('Asleep'), window(false))).toEqual({ awake: false, locked: false });
  });
});

describe('isDisconnected', () => {
  it('디바이스를 찾지 못하는 adb 오류만 연결 끊김으로 본다', () => {
    expect(isDisconnected("adb: device 'R5CWB31DAVX' not found")).toBe(true);
    expect(isDisconnected('error: device offline')).toBe(true);
    expect(isDisconnected('adb: no devices/emulators found')).toBe(true);
    expect(isDisconnected('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')).toBe(false);
  });
});
