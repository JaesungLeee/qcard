import { describe, expect, it } from 'vitest';
import { CellLease, LEASE_LOST_MS } from '../src/cells';

/* 칸 리스 (F-CY-06): 연결 신호로 이 Run이 칸을 잃었는지 본다 */

describe('CellLease', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, set: (ms: number) => (t = ms) };
  };

  it('신호가 계속 성공하면 잃지 않고, 마지막 신호에서 LEASE_LOST_MS가 지나면 잃는다', async () => {
    const c = clock();
    const lease = new CellLease(c.now);
    for (const at of [30_000, 60_000, 90_000]) {
      c.set(at);
      await lease.beat(async () => {});
    }
    c.set(90_000 + LEASE_LOST_MS);
    expect(lease.lost()).toBe(false);
    c.set(90_000 + LEASE_LOST_MS + 1);
    expect(lease.lost()).toBe(true);
  });

  it('신호가 실패하면 마지막 성공 시각 그대로다 (네트워크 끊김)', async () => {
    const c = clock();
    const lease = new CellLease(c.now);
    c.set(30_000);
    await expect(lease.beat(() => Promise.reject(new Error('fetch failed')))).rejects.toThrow();
    c.set(LEASE_LOST_MS + 1);
    expect(lease.lost()).toBe(true);
  });

  it('절전에서 깨어나 신호가 성공해도 잃은 채로 두고, 다음 칸을 잡으면 다시 산다', async () => {
    const c = clock();
    const lease = new CellLease(c.now);
    // 30초 신호 뒤 잠들었다가 5분 뒤 깨어남 — 타이머가 바로 신호를 보내 성공한다
    c.set(30_000);
    await lease.beat(async () => {});
    c.set(330_000);
    await lease.beat(async () => {});
    expect(lease.lost()).toBe(true);
    c.set(331_000);
    await lease.beat(async () => {});
    expect(lease.lost()).toBe(true);
    lease.claimed(332_000);
    expect(lease.lost()).toBe(false);
  });
});
