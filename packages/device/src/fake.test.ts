import { describe, expect, it } from 'vitest';
import { FakeDevice, swipeDirection, UnexpectedActionError, type FakeScenario } from './fake';
import { center, findElement } from './tree';
import { EnvActionUnavailableError, type DeviceInfo, type UiElement } from './types';

const el = (resourceId: string, cls: string, y: number, text?: string): UiElement => ({
  ref: '',
  resourceId,
  cls,
  text,
  bounds: { x: 0, y, w: 1080, h: 100 },
  clickable: true,
  enabled: true,
  focused: false,
  scrollable: false,
  password: false,
  depth: 0,
});

const INFO: DeviceInfo = {
  serial: 'fake-1',
  model: 'Fake',
  osMajor: 15,
  size: { w: 1080, h: 2400 },
  density: 420,
  connection: 'usb',
};

const scenario = (info = INFO): FakeScenario => ({
  info,
  appPackage: 'com.example',
  home: 'launcher',
  launch: 'splash',
  screens: {
    launcher: { tree: [el('app_icon', 'android.widget.TextView', 1700, '예제')] },
    splash: { tree: [] },
    form: { tree: [el('name', 'android.widget.EditText', 700), el('save', 'android.widget.Button', 2100, '저장')] },
    page1: { tree: [] },
    page2: { tree: [] },
  },
  transitions: [
    { from: 'launcher', on: { kind: 'tap', target: 'app_icon' }, to: 'splash' },
    { from: 'splash', on: { kind: 'auto' }, to: 'form' },
    { from: 'form', on: { kind: 'tap', target: 'save' }, to: 'page1', when: (s) => (s.values.name ?? '').length >= 2 },
    { from: 'page1', on: { kind: 'swipe', direction: 'left' }, to: 'page2' },
    { from: 'page2', on: { kind: 'key', key: 'back' }, to: 'page1' },
  ],
});

async function tapId(d: FakeDevice, id: string) {
  const target = findElement(await d.dumpTree(), id)!;
  await d.tap(...center(target.bounds));
}

describe('FakeDevice', () => {
  it('시나리오를 따라 화면이 바뀐다', async () => {
    const d = new FakeDevice(scenario());
    await tapId(d, 'app_icon');
    expect(d.current).toBe('splash');
    await d.dumpTree(); // 스플래시를 한 번 본다
    await d.dumpTree(); // 다음 관찰에서 자동 전환
    expect(d.current).toBe('form');
    expect(await d.foregroundPackage()).toBe('com.example');
  });

  it('입력은 포커스한 필드에 들어가고 트리에 보인다', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'form' });
    await expect(d.inputText('x')).rejects.toBeInstanceOf(UnexpectedActionError);
    await tapId(d, 'name');
    await d.inputText('하루콩');
    await d.inputText('러버');
    const tree = await d.dumpTree();
    expect(findElement(tree, 'name')).toMatchObject({ text: '하루콩러버', focused: true });
  });

  it('조건이 맞지 않으면 넘어가지 않는다 (strict라 에러)', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'form' });
    await expect(tapId(d, 'save')).rejects.toBeInstanceOf(UnexpectedActionError);
    await tapId(d, 'name');
    await d.inputText('ab');
    await tapId(d, 'save');
    expect(d.current).toBe('page1');
  });

  it('스와이프·키 전환, 정의되지 않은 동작은 에러', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'page1' });
    await expect(d.swipe([540, 1200], [540, 400])).rejects.toThrow(/up 스와이프/);
    await d.swipe([900, 1200], [180, 1200]);
    expect(d.current).toBe('page2');
    await d.pressKey('back');
    expect(d.current).toBe('page1');
    await expect(d.pressKey('back')).rejects.toBeInstanceOf(UnexpectedActionError);
    await d.pressKey('home');
    expect(d.current).toBe('launcher');
  });

  it('홈 키로 보낸 앱은 다시 열면 보던 화면으로 돌아온다 (종료하면 처음부터)', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'page2' });
    await d.pressKey('home');
    await d.launchApp('com.example');
    expect(d.current).toBe('page2');
    await d.stopApp('com.example');
    await d.launchApp('com.example');
    expect(d.current).toBe('splash');
  });

  it('앱 실행·종료·데이터 삭제', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'form' });
    await tapId(d, 'name');
    await d.inputText('ab');
    await d.stopApp('com.example');
    expect(d.current).toBe('launcher');
    await d.launchApp('com.example');
    expect(d.current).toBe('splash');
    await d.clearAppData('com.example');
    expect(d.state.values).toEqual({});
    expect(d.log).toContain('clear com.example');
  });

  it('환경 조작은 상태에 남고, Wi-Fi ADB에서 Wi-Fi 끄기는 불가', async () => {
    const usb = new FakeDevice(scenario());
    await usb.setNetwork('wifi', false);
    await usb.setPermission('com.example', 'android.permission.CAMERA', true);
    expect(usb.state.network.wifi).toBe(false);
    expect(usb.state.permissions['com.example/android.permission.CAMERA']).toBe(true);
    const wifi = new FakeDevice(scenario({ ...INFO, connection: 'wifi' }));
    await expect(wifi.setNetwork('wifi', false)).rejects.toBeInstanceOf(EnvActionUnavailableError);
  });

  it('입력란 포커스 시 키보드가 뜨고, 가려진 곳 탭은 에러, 뒤로가기는 키보드만 닫는다', async () => {
    const d = new FakeDevice({ ...scenario(), start: 'form', keyboardOnFocus: { top: 1400 } });
    expect(await d.keyboard()).toEqual({ shown: false });
    await tapId(d, 'name');
    expect(await d.keyboard()).toEqual({ shown: true, top: 1400 });
    await expect(tapId(d, 'save')).rejects.toThrow(/키보드에 가려진/);
    await d.pressKey('back');
    expect(d.current).toBe('form');
    expect(await d.keyboard()).toEqual({ shown: false });
  });

  it('시나리오에 없는 화면을 가리키면 만들 때 에러', () => {
    const s = scenario();
    expect(() => new FakeDevice({ ...s, transitions: [{ from: 'form', on: { kind: 'auto' }, to: 'ghost' }] })).toThrow(
      /ghost/,
    );
  });

  it('스와이프 방향은 손가락이 움직인 쪽', () => {
    expect(swipeDirection([900, 1200], [180, 1200])).toBe('left');
    expect(swipeDirection([540, 1800], [540, 600])).toBe('up');
    expect(swipeDirection([540, 600], [560, 1800])).toBe('down');
  });
});
