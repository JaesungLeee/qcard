import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeDevice } from '@qcard/device';
import { onboardingScenario } from '@qcard/fixtures';
import { describe, expect, it } from 'vitest';
import { holdAwake, restoreAwake } from '../src/awake';

describe('Run 동안 화면 켜짐 유지', () => {
  it('꺼져 있으면 켰다가 되돌리고, 이미 켜져 있으면 건드리지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qcard-awake-'));
    const device = new FakeDevice(onboardingScenario());
    const { release, changed } = await holdAwake(device, 'S1', { dir });
    expect([device.stayOn, changed]).toEqual([7, true]);
    expect(existsSync(join(dir, 'S1.json'))).toBe(true);
    await release();
    expect(device.stayOn).toBe(0);
    expect(existsSync(join(dir, 'S1.json'))).toBe(false);

    device.stayOn = 2; // 사용자가 직접 켜 둔 설정
    const mine = await holdAwake(device, 'S1', { dir });
    await mine.release();
    expect([device.stayOn, mine.changed]).toEqual([2, false]);
  });

  it('비정상 종료로 못 되돌린 값은 다음에 복구한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qcard-awake-'));
    const device = new FakeDevice(onboardingScenario());
    await holdAwake(device, 'S1', { dir }); // 되돌리기 전에 호스트가 죽었다
    expect(device.stayOn).toBe(7);
    expect(await restoreAwake(device, 'S1', { dir })).toBe(true);
    expect(device.stayOn).toBe(0);

    // 다음 Run이 먼저 시작돼도 켜진 값을 원래 값으로 착각하지 않는다
    await holdAwake(device, 'S1', { dir });
    const { release } = await holdAwake(device, 'S1', { dir });
    await release();
    expect(device.stayOn).toBe(0);
  });
});
