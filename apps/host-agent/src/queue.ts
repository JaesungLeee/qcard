import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * 업로드 큐 (F-EX-13). 결과·증거를 먼저 로컬 디스크에 쓰고, 연결되는 대로 순서대로 보낸다.
 * 작업에는 전체 경로가 들어 있어 프로세스가 끝나도 다음 실행이 남은 작업부터 이어서 보낸다.
 *
 *   <dir>/000042.json   작업 (보내면 지운다)
 *   <dir>/000042.png    업로드할 파일
 *   <dir>/dropped/       대상 문서가 사라져 보낼 수 없는 작업 (예: 에뮬레이터 초기화로 Run 문서가 없어짐). 다음 작업으로 넘어간다
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

export class QueueFailedError extends Error {
  override name = 'QueueFailedError';
}

export class UploadQueue {
  private seq = 0;
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
    this.kick();
  }

  /** 큐 폴더를 열고 남은 작업이 있으면 보내기 시작한다 */
  async open(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const ids = await this.ids();
    this.seq = ids.length ? Number(ids.at(-1)) : 0;
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
    for (const id of await this.ids()) {
      const op = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as QueueOp;
      const file = op.type === 'upload' ? new Uint8Array(await readFile(join(this.dir, `${id}.png`))) : undefined;
      let wait = this.opts.retryMs ?? 1000;
      for (;;) {
        try {
          await this.apply(op, file);
          break;
        } catch (e) {
          if (isGone(op, e)) {
            await mkdir(join(this.dir, 'dropped'), { recursive: true });
            await rename(join(this.dir, `${id}.json`), join(this.dir, 'dropped', `${id}.json`));
            this.opts.onDrop?.(op, (e as Error).message);
            break;
          }
          if (!transient(e)) {
            // 다시 해도 안 되는 오류(권한 등): 멈추고 알린다. 작업은 디스크에 남는다
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
