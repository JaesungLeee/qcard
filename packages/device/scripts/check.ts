/**
 * 실기기 점검 (읽기 전용 — 디바이스 상태를 바꾸지 않는다).
 * 연결·기기 정보, 대상 앱 설치 여부, 키보드(IME), 트리 덤프·스크린샷 속도를 본다.
 *
 *   pnpm device:check [--serial <시리얼>] [--package com.example.harukong]
 */
import { parseArgs } from 'node:util';
import { AdbDriver, execAdb, listDevices, resolveAdb } from '../src/node';

const { values } = parseArgs({
  options: { serial: { type: 'string' }, package: { type: 'string', default: 'com.example.harukong' } },
});

console.log(`adb: ${resolveAdb()}`);
const devices = await listDevices();
if (devices.length === 0) {
  console.log(
    '연결된 디바이스가 없습니다. USB 디버깅을 켜고 케이블로 연결한 뒤, 기기의 "USB 디버깅 허용"을 눌러 주세요.',
  );
  process.exit(1);
}
for (const d of devices) console.log(`- ${d.serial} · ${d.state}${d.model ? ` · ${d.model}` : ''}`);
const unauthorized = devices.find((d) => d.state === 'unauthorized');
if (unauthorized) console.log('  ↳ unauthorized: 기기 화면의 "USB 디버깅을 허용하시겠습니까?"에서 허용을 눌러 주세요.');

const ready = devices.filter((d) => d.state === 'device');
const serial = values.serial ?? (ready.length === 1 ? ready[0]!.serial : undefined);
if (!serial) {
  console.log(ready.length ? '여러 대입니다. --serial로 고르세요.' : '사용할 수 있는 디바이스가 없습니다.');
  process.exit(1);
}

const exec = execAdb();
const sh = async (...args: string[]) => (await exec(['-s', serial, 'shell', ...args])).toString().trim();
const d = new AdbDriver(serial, { exec });
const info = await d.info();
console.log(
  `\n기기: ${info.model} · Android ${info.osMajor} · ${info.size.w}×${info.size.h} · ${info.density}dpi · ${info.connection === 'usb' ? 'USB' : 'Wi-Fi'}`,
);

const pkgs = await sh('pm', 'list', 'packages', values.package);
console.log(
  `앱 ${values.package}: ${pkgs.split('\n').some((l) => l.trim() === `package:${values.package}`) ? '설치됨' : '없음'}`,
);
console.log(`포그라운드: ${(await d.foregroundPackage()) ?? '?'}`);

const imes = (await sh('ime', 'list', '-s')).split('\n').filter(Boolean);
console.log(`키보드(IME): ${imes.join(', ') || '?'}`);
console.log(
  imes.some((i) => i.includes('adbkeyboard'))
    ? '  ↳ ADBKeyboard 있음: 한글 입력 가능'
    : '  ↳ ADBKeyboard 없음: adb input text로는 한글을 입력할 수 없다',
);

const time = async <T>(f: () => Promise<T>) => {
  const t = performance.now();
  const r = await f();
  return { ms: Math.round(performance.now() - t), r };
};
const dumps: number[] = [];
const shots: number[] = [];
let nodes = 0;
for (let i = 0; i < 3; i++) {
  const t = await time(() => d.dumpTree());
  dumps.push(t.ms);
  nodes = t.r.length;
  shots.push((await time(() => d.screenshot())).ms);
}
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
console.log(`\n트리 덤프: ${dumps.join(' / ')}ms (평균 ${avg(dumps)}ms, 요소 ${nodes}개)`);
console.log(`스크린샷: ${shots.join(' / ')}ms (평균 ${avg(shots)}ms)`);
console.log(`관찰 1회 ≈ ${avg(dumps) + avg(shots)}ms`);
