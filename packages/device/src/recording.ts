import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FakeScreen } from './fake';
import { parseUiTree } from './tree';
import type { DeviceDriver, DeviceInfo } from './types';

/*
 * 실기기 화면 녹화. 화면 하나 = `<이름>.png` + `<이름>.xml`(uiautomator 원본) + `<이름>.json`(메타).
 * 녹화 폴더 하나가 FakeDevice 시나리오의 `screens`가 된다.
 */

export type RecordingMeta = { name: string; recordedAt: string; device: DeviceInfo; foregroundPackage?: string };

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** 디바이스의 지금 화면을 저장한다. 읽기만 하므로 디바이스 상태를 바꾸지 않는다. */
export async function recordScreen(
  device: Pick<DeviceDriver, 'screenshot' | 'info' | 'foregroundPackage'> & { dumpXml(): Promise<string> },
  dir: string,
  name: string,
): Promise<RecordingMeta> {
  if (!NAME.test(name)) throw new Error(`화면 이름은 소문자·숫자·하이픈만: ${name}`);
  await mkdir(dir, { recursive: true });
  const [png, xml, info, foregroundPackage] = await Promise.all([
    device.screenshot(),
    device.dumpXml(),
    device.info(),
    device.foregroundPackage(),
  ]);
  const meta: RecordingMeta = { name, recordedAt: new Date().toISOString(), device: info, foregroundPackage };
  await Promise.all([
    writeFile(join(dir, `${name}.png`), png),
    writeFile(join(dir, `${name}.xml`), xml),
    writeFile(join(dir, `${name}.json`), JSON.stringify(meta, null, 2) + '\n'),
  ]);
  return meta;
}

/** 녹화 폴더 → FakeDevice 화면 목록 */
export async function loadRecording(dir: string): Promise<Record<string, FakeScreen>> {
  const names = (await readdir(dir)).filter((f) => f.endsWith('.xml')).map((f) => f.slice(0, -4));
  const screens: Record<string, FakeScreen> = {};
  for (const name of names) {
    const [xml, png] = await Promise.all([
      readFile(join(dir, `${name}.xml`), 'utf8'),
      readFile(join(dir, `${name}.png`)).catch(() => undefined),
    ]);
    screens[name] = { tree: parseUiTree(xml), screenshot: png && new Uint8Array(png) };
  }
  return screens;
}
