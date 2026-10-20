/**
 * 실기기의 지금 화면을 녹화한다 (스크린샷 + 접근성 트리). 디바이스 상태는 바꾸지 않는다.
 *
 *   pnpm device:record <화면 이름> [--set <녹화 묶음>] [--serial <시리얼>]
 *
 * 저장 위치: packages/device/recordings/<묶음>/ (기본 묶음 `default`). 앱 화면이 들어 있으므로 커밋하지 않는다.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, formatTree, listDevices, parseUiTree, recordScreen } from '../src/node';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { set: { type: 'string', default: 'default' }, serial: { type: 'string' } },
});
const name = positionals[0];
if (!name) {
  console.error('사용법: pnpm device:record <화면 이름> [--set <묶음>] [--serial <시리얼>]');
  process.exit(1);
}

let serial = values.serial;
if (!serial) {
  const ready = (await listDevices()).filter((d) => d.state === 'device');
  if (ready.length !== 1) {
    console.error(
      ready.length === 0
        ? '연결된 디바이스가 없습니다 (adb devices 확인)'
        : `디바이스가 여러 대입니다. --serial로 고르세요: ${ready.map((d) => `${d.serial}(${d.model ?? '?'})`).join(', ')}`,
    );
    process.exit(1);
  }
  serial = ready[0]!.serial;
}

const dir = resolve(import.meta.dirname, '..', 'recordings', values.set);
const meta = await recordScreen(new AdbDriver(serial), dir, name);
const tree = parseUiTree(await readFile(resolve(dir, `${name}.xml`), 'utf8'));
console.log(formatTree(tree));
console.log(
  `\n저장: ${dir}/${name}.{png,xml,json} · ${meta.device.model} Android ${meta.device.osMajor} · ${meta.foregroundPackage ?? '?'}`,
);
