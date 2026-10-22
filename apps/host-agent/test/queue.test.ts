import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QueueFailedError, UploadQueue, type QueueOp } from '../src/queue';

const dir = () => mkdtempSync(join(tmpdir(), 'qcard-queue-test-'));
const offline = Object.assign(new Error('fetch failed'), { code: 'unavailable' });
const set = (n: number): QueueOp => ({ type: 'set', path: `docs/${n}`, data: { n } });

describe('UploadQueue (F-EX-13)', () => {
  it('일시적 오류는 다시 시도하고 순서대로 보낸다', async () => {
    const sent: string[] = [];
    let fails = 3;
    const q = await new UploadQueue(
      dir(),
      async (op) => {
        if (fails-- > 0) throw offline;
        sent.push(op.path);
      },
      { retryMs: 5 },
    ).open();
    for (const n of [1, 2, 3]) await q.enqueue(set(n));
    expect(await q.drain()).toBe(0);
    expect(sent).toEqual(['docs/1', 'docs/2', 'docs/3']);
  });

  it('다시 해도 안 되는 오류(권한)면 멈추고 알린다. 작업은 디스크에 남는다', async () => {
    const d = dir();
    const denied = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    const q = await new UploadQueue(d, () => Promise.reject(denied), { retryMs: 5 }).open();
    await q.enqueue(set(1));
    await expect(q.drain()).rejects.toBeInstanceOf(QueueFailedError);
    await expect(q.enqueue(set(2))).rejects.toBeInstanceOf(QueueFailedError);
    expect(readdirSync(d).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('보내지 못한 작업은 다음 실행(새 큐)이 이어서 보낸다 — 파일 포함', async () => {
    const d = dir();
    const first = await new UploadQueue(d, () => Promise.reject(offline), { retryMs: 5 }).open();
    await first.enqueue(set(1));
    await first.enqueue({ type: 'upload', path: 'shots/a.png', contentType: 'image/png' }, new Uint8Array([1, 2, 3]));
    await first.enqueue(set(2));
    expect(await first.drain(50)).toBe(3);

    const sent: [string, number[] | undefined][] = [];
    const next = await new UploadQueue(d, async (op, file) => {
      sent.push([op.path, file && [...file]]);
    }).open();
    expect(await next.drain()).toBe(0);
    expect(sent).toEqual([
      ['docs/1', undefined],
      ['shots/a.png', [1, 2, 3]],
      ['docs/2', undefined],
    ]);
    expect(readdirSync(d)).toEqual([]);
  });
});
