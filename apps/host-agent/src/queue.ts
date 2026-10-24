import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * 업로드 큐 (F-EX-13). 결과·증거를 먼저 로컬 디스크에 쓰고, 연결되는 대로 순서대로 보낸다.
 * 작업에는 전체 경로가 들어 있어 프로세스가 끝나도 다음 실행이 남은 작업부터 이어서 보낸다.
 *
 *   <dir>/000042.json   작업 (보내면 지운다)
 *   <dir>/000042.png    업로드할 파일
 *   <dir>/dropped/       보낼 수 없는 작업. 다음 작업으로 넘어간다 — 대상 문서가 사라졌거나(에뮬레이터 초기화로 Run 문서가 없어짐),
 *                        보안 규칙이 거절함(이 PC의 연결 해제, 예전 Run, 권한 없는 역할). 하나가 막혀 뒤의 업로드가 모두 멈추지 않게 한다.
 *                        이번 실행에서 넣은 작업이 거절됐으면 큐를 멈춰 지금 Run에 알린다(더 돌려 봐야 올라가지 않는다).
 *                        다음 Run을 시작하면(retry) 남은 작업부터 다시 보낸다
 */

export type QueueOp =
  /** 문서 쓰기 (덮어쓰기) */
  | { type: 'set'; path: string; data: Record<string, unknown> }
  /** 문서 일부 수정. remove의 필드는 지운다 */
  | { type: 'update'; path: string; data: Record<string, unknown>; remove?: string[] }
  /** 케이스 결과: 보낼 때 기존 칸을 읽어 시도 횟수·정렬 순서를 정한다 */
  | { type: 'result'; path: string; data: Record<string, unknown> }
  /** Storage 업로드 (파일은 큐 폴더의 같은 번호 .png) */
  | { type: 'upload'; path: string; contentType: string };

export type ApplyOp = (op: QueueOp, file?: Uint8Array) => Promise<void>;

/** 다시 시도하면 될 오류인가 (네트워크·일시적 서버 오류) */
export function isTransient(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  const text = String((e as Error).message ?? e);
  return (
    /unavailable|deadline-exceeded|retry-limit-exceeded|network-request-failed|internal/.test(code) ||
    /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(text)
  );
}

/** 고칠 문서가 없다 — 다시 해도 안 되고, 기다릴 이유도 없다 */
export function isGone(op: QueueOp, e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  return (
    op.type === 'update' &&
    (code === 'not-found' || /NOT_FOUND|no entity to update/.test(String((e as Error).message ?? e)))
  );
}

/** 보안 규칙이 거절했다 — 다시 해도 안 된다 (연결 해제된 PC, 다른 사람의 Run, 예전 Run) */
export function isRejected(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  return (
    code === 'permission-denied' ||
    code === 'storage/unauthorized' ||
    /PERMISSION_DENIED|Missing or insufficient permissions/.test(String((e as Error).message ?? e))
  );
}

export class QueueFailedError extends Error {
  override name = 'QueueFailedError';
}

export class UploadQueue {
  private seq = 0;
  /** 열 때 남아 있던 작업의 마지막 번호 (지난 실행의 작업은 거절돼도 지금 Run을 멈추지 않는다) */
  private leftoverUpTo = 0;
  private running: Promise<void> | undefined;
  private failure: Error | undefined;
  private waiters: (() => void)[] = [];

  constructor(
    readonly dir: string,
    private readonly apply: ApplyOp,
    private readonly opts: {
      retryMs?: number;
      maxRetryMs?: number;
      transient?: (e: unknown) => boolean;
      /** 보낼 수 없어 뺀 작업 */
      onDrop?: (op: QueueOp, reason: string) => void;
    } = {},
  ) {}

  /** 멈춘 큐를 다시 보내 본다 (새 Run을 시작할 때). 같은 오류면 다시 멈춘다 */
  retry() {
    if (!this.failure) return;
    this.failure = undefined;
    // 멈추기 전에 넣은 작업은 지난 Run의 것 — 거절돼도 새 Run을 멈추지 않는다
    this.leftoverUpTo = this.seq;
    this.kick();
  }

  /** 큐 폴더를 열고 남은 작업이 있으면 보내기 시작한다 */
  async open(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const ids = await this.ids();
    this.seq = ids.length ? Number(ids.at(-1)) : 0;
    this.leftoverUpTo = this.seq;
    if (ids.length) this.kick();
    return this;
  }

  /** 로컬에 저장하면 끝난다 (보내기는 뒤에서) */
  async enqueue(op: QueueOp, file?: Uint8Array): Promise<void> {
    if (this.failure) throw this.failure;
    const id = String(++this.seq).padStart(6, '0');
    if (file) await writeFile(join(this.dir, `${id}.png`), file);
    // 쓰는 도중의 파일을 보내지 않게 임시 이름으로 쓴 뒤 바꾼다
    await writeFile(join(this.dir, `${id}.json.tmp`), JSON.stringify(op));
    await rename(join(this.dir, `${id}.json.tmp`), join(this.dir, `${id}.json`));
    this.kick();
  }

  async pending(): Promise<number> {
    return (await this.ids()).length;
  }

  /** 모두 보낼 때까지 기다린다. timeoutMs가 지나면 남은 개수를 돌려준다(작업은 디스크에 남는다) */
  async drain(timeoutMs = Infinity): Promise<number> {
    this.kick();
    const done = new Promise<void>((r) => this.waiters.push(r));
    const timer = timeoutMs === Infinity ? undefined : new Promise<void>((r) => setTimeout(r, timeoutMs).unref());
    await Promise.race([done, ...(timer ? [timer] : [])]);
    if (this.failure) throw this.failure;
    return this.pending();
  }

  private async ids(): Promise<string[]> {
    const files = await readdir(this.dir).catch(() => [] as string[]);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
  }

  private kick() {
    this.running ??= this.loop().finally(() => {
      this.running = undefined;
      if (!this.failure) {
        // 처리하는 동안 새로 들어온 작업이 있으면 다시 돈다
        void this.ids().then((ids) => (ids.length ? this.kick() : this.settle()));
      } else this.settle();
    });
  }

  private settle() {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  private async loop() {
    const transient = this.opts.transient ?? isTransient;
    outer: for (const id of await this.ids()) {
      const op = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as QueueOp;
      const file = op.type === 'upload' ? new Uint8Array(await readFile(join(this.dir, `${id}.png`))) : undefined;
      let wait = this.opts.retryMs ?? 1000;
      for (;;) {
        try {
          await this.apply(op, file);
          break;
        } catch (e) {
          if (isGone(op, e) || isRejected(e)) {
            const dropped = join(this.dir, 'dropped');
            await mkdir(dropped, { recursive: true });
            await rename(join(this.dir, `${id}.json`), join(dropped, `${id}.json`));
            if (file) await rename(join(this.dir, `${id}.png`), join(dropped, `${id}.png`));
            this.opts.onDrop?.(op, (e as Error).message);
            if (isRejected(e) && Number(id) > this.leftoverUpTo) {
              this.failure ??= new QueueFailedError(
                `업로드 실패 — 보안 규칙이 거절했습니다 (${op.type} ${op.path}): ${(e as Error).message}`,
              );
            }
            // 옮겼으니 아래에서 지울 것이 없다. 뒤의 작업은 계속 보낸다
            continue outer;
          }
          if (!transient(e)) {
            // 그 밖의 다시 해도 안 되는 오류: 멈추고 알린다. 작업은 디스크에 남는다
            this.failure = new QueueFailedError(`업로드 실패 (${op.type} ${op.path}): ${(e as Error).message}`);
            return;
          }
          await new Promise((r) => setTimeout(r, wait));
          wait = Math.min(wait * 2, this.opts.maxRetryMs ?? 30_000);
        }
      }
      await rm(join(this.dir, `${id}.json`), { force: true });
      if (file) await rm(join(this.dir, `${id}.png`));
    }
  }
}
