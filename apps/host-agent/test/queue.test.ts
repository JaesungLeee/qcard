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

  it('다시 해도 안 되는 그 밖의 오류면 멈추고 알린다. 작업은 디스크에 남는다', async () => {
    const d = dir();
    const invalid = Object.assign(new Error('bad data'), { code: 'invalid-argument' });
    const q = await new UploadQueue(d, () => Promise.reject(invalid), { retryMs: 5 }).open();
    await q.enqueue(set(1));
    await expect(q.drain()).rejects.toBeInstanceOf(QueueFailedError);
    await expect(q.enqueue(set(2))).rejects.toBeInstanceOf(QueueFailedError);
    expect(readdirSync(d).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('고칠 문서가 사라진 작업(에뮬레이터 초기화 등)은 dropped로 빼고 다음 작업을 보낸다', async () => {
    const d = dir();
    const gone = Object.assign(new Error('5 NOT_FOUND: no entity to update'), { code: 'not-found' });
    const sent: string[] = [];
    const dropped: string[] = [];
    const q = await new UploadQueue(
      d,
      async (op) => {
        if (op.type === 'update') throw gone;
        sent.push(op.path);
      },
      { retryMs: 5, onDrop: (op) => dropped.push(op.path) },
    ).open();
    await q.enqueue({ type: 'update', path: 'runs/old', data: { status: 'done' } });
    await q.enqueue(set(2));
    expect(await q.drain()).toBe(0);
    expect([sent, dropped]).toEqual([['docs/2'], ['runs/old']]);
    expect(readdirSync(join(d, 'dropped'))).toEqual(['000001.json']);
  });

  it('보안 규칙이 거절한 작업(연결 해제된 PC·권한 없는 역할)은 파일과 함께 dropped로 빼고, 지금 Run에 알린다', async () => {
    const d = dir();
    const denied = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    const unauthorized = Object.assign(new Error('User does not have permission'), { code: 'storage/unauthorized' });
    const sent: string[] = [];
    const dropped: string[] = [];
    const q = await new UploadQueue(
      d,
      async (op) => {
        if (op.path === 'runs/old') throw denied;
        if (op.type === 'upload') throw unauthorized;
        sent.push(op.path);
      },
      { retryMs: 5, onDrop: (op) => dropped.push(op.path) },
    ).open();
    await q.enqueue({ type: 'update', path: 'runs/old', data: { status: 'done' } });
    await expect(q.drain()).rejects.toThrow('보안 규칙이 거절');
    // 다음 Run(retry): 그 전에 넣은 작업이 거절돼도 멈추지 않고 빼고 넘어간다 — 뒤의 업로드가 막히지 않는다
    q.retry();
    await q.enqueue({ type: 'upload', path: 'shots/a.png', contentType: 'image/png' }, new Uint8Array([1]));
    await q.enqueue(set(3));
    await expect(q.drain()).rejects.toThrow('보안 규칙이 거절');
    q.retry();
    expect(await q.drain()).toBe(0);
    expect([sent, dropped]).toEqual([['docs/3'], ['runs/old', 'shots/a.png']]);
    expect(readdirSync(join(d, 'dropped')).sort()).toEqual(['000001.json', '000002.json', '000002.png']);
  });

  it('지난 실행에서 남은 작업이 거절되면 조용히 빼고 큐를 멈추지 않는다 (다른 계정·연결 해제 뒤 다시 켬)', async () => {
    const d = dir();
    const denied = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    const first = await new UploadQueue(d, () => Promise.reject(offline), { retryMs: 5 }).open();
    await first.enqueue(set(1));
    await first.drain(30);
    const sent: string[] = [];
    const next = await new UploadQueue(
      d,
      async (op) => {
        if (op.path === 'docs/1') throw denied;
        sent.push(op.path);
      },
      { retryMs: 5 },
    ).open();
    await next.enqueue(set(2));
    expect(await next.drain()).toBe(0);
    expect(sent).toEqual(['docs/2']);
  });

  it('멈춘 큐는 retry()로 다시 보낸다', async () => {
    const invalid = Object.assign(new Error('bad data'), { code: 'invalid-argument' });
    let allowed = false;
    const q = await new UploadQueue(
      dir(),
      async () => {
        if (!allowed) throw invalid;
      },
      { retryMs: 5 },
    ).open();
    await q.enqueue(set(1));
    await expect(q.drain()).rejects.toBeInstanceOf(QueueFailedError);
    allowed = true;
    q.retry();
    expect(await q.drain()).toBe(0);
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
