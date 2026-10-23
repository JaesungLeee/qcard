import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeviceDriver } from '@qcard/device';

/*
 * Run 동안 디바이스 화면이 꺼지며 잠기지 않게 "충전 중 화면 켜짐 유지"를 켜고, 끝나면 원래 값으로 되돌린다.
 * 잠긴 폰을 푸는 것은 하지 않는다(PIN·패턴은 adb로 풀 수 없고, 풀어서도 안 된다) — Run 시작 때는 잠금이 풀려 있어야 한다.
 * 바꾸기 전 값을 파일에 적어 두어, 호스트가 비정상 종료돼 못 되돌렸으면 다음 시작 때 복구한다.
 */

export const RESTORED = '지난 Run에서 켠 폰의 "충전 중 화면 켜짐 유지"를 원래대로 되돌렸습니다';

/** 모든 충전 방식(AC 1 + USB 2 + 무선 4) */
const ALL_PLUGGED = 7;

const markerFile = (serial: string, dir = join(homedir(), '.qcard', 'stay-awake')) => join(dir, `${serial}.json`);

/**
 * 화면 켜짐 유지를 켠다. release로 원래 값으로 되돌린다.
 * 이미 켜져 있었으면(사용자가 켜 둔 설정) 아무것도 바꾸지 않는다 — changed: false
 */
export async function holdAwake(
  device: DeviceDriver,
  serial: string,
  opts: { dir?: string; log?: (line: string) => void } = {},
): Promise<{ release: () => Promise<void>; changed: boolean }> {
  // 지난번에 못 되돌린 값이 있으면 먼저 되돌린다 (켜진 값을 원래 값으로 착각하지 않게)
  await restoreAwake(device, serial, opts);
  const original = await device.stayOnWhilePlugged();
  if (original !== 0) return { release: async () => {}, changed: false };
  const file = markerFile(serial, opts.dir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ original }));
  await device.setStayOnWhilePlugged(ALL_PLUGGED);
  opts.log?.('Run 동안 "충전 중 화면 켜짐 유지"를 켭니다 (끝나면 되돌림)');
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await device.setStayOnWhilePlugged(original).catch(() => {});
    // 되돌리지 못했으면(연결 끊김) 표시를 남겨 두고 다음에 복구한다
    if ((await device.stayOnWhilePlugged().catch(() => -1)) === original) await rm(file, { force: true });
  };
  return { release, changed: true };
}

/** 지난번에 못 되돌린 변경이 있으면 되돌린다. 되돌렸으면 true */
export async function restoreAwake(
  device: DeviceDriver,
  serial: string,
  opts: { dir?: string; log?: (line: string) => void } = {},
): Promise<boolean> {
  const file = markerFile(serial, opts.dir);
  const saved = await readFile(file, 'utf8').catch(() => undefined);
  if (!saved) return false;
  const { original } = JSON.parse(saved) as { original: number };
  await device.setStayOnWhilePlugged(original);
  await rm(file, { force: true });
  opts.log?.(RESTORED);
  return true;
}
