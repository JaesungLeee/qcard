import type { SaveScreenshot } from '@qcard/agent';
import type { AttemptSummary, CaseResult, PauseReason, Run } from '@qcard/shared';
import { deleteField, doc, getDoc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import type { ApplyOp, UploadQueue } from './queue';

/*
 * Run 진행 상태·결과·증거를 팀이 보는 곳(Firestore·Storage)에 기록한다 (F-DB-07, F-EX-06).
 * 기록은 업로드 큐를 거친다 — 네트워크가 끊겨도 로컬에 남았다가 연결되면 순서대로 보낸다 (F-EX-13).
 *
 *   projects/{p}/cycles/{c}/runs/{run}                 Run (현재 케이스·일시정지 이유)
 *   projects/{p}/cycles/{c}/results/{tc}__{device}     CaseResult (최신 시도. 다시 실행하면 시도 횟수를 올린다)
 *   projects/{p}/cycles/{c}/attempts/{tc}__{device}__{n}  밀려난 n번째 시도 전체 (F-CY-04, 바꾸지 않는다)
 *   Storage projects/{p}/cycles/{c}/runs/{run}/{tc}/obs-NN.png   스크린샷 (결과에는 경로만 남긴다)
 */

export interface RunSink {
  /**
   * tcIds: 실행 큐 (이어서 실행할 때 쓴다). startedAt: 이어서 실행하면 처음 시작한 시각.
   * 지금 케이스(`currentTcId`)는 쓰지 않는다 — 칸 선점의 잠금이라 Functions(claimCell)가 정한다 (F-CY-06)
   */
  start(tcIds: string[], startedAt?: string): Promise<void>;
  /**
   * 호스트가 살아 있다는 신호 (F-DV-04). Run 동안 RUN_HEARTBEAT_MS마다. 업로드 큐를 거치지 않고 바로 보낸다 —
   * 스크린샷 업로드가 밀려 신호가 늦으면 다른 Run이 이 Run의 칸을 끊긴 것으로 보고 가져간다 (F-CY-06). 실패하면 던진다
   */
  heartbeat(): Promise<void>;
  saveScreenshot: SaveScreenshot;
  result(r: CaseResult): Promise<void>;
  /** 실행자를 기다리는 중 (위험 액션·사람 전용·수동 스텝, F-EX-10). 웹에 보인다. undefined면 끝남 */
  waiting(level: 'approval' | 'human' | undefined): Promise<void>;
  /** 플랜 한도·로그인 등으로 멈춤 (F-EX-17). 진행 중 케이스 결과는 쓰지 않는다 */
  pause(reason: PauseReason): Promise<void>;
  /** 끝남. aborted = 실행자가 중단 (진행 중 케이스 결과는 쓰지 않는다) */
  finish(status?: 'done' | 'aborted'): Promise<void>;
  /** 남은 업로드를 보낼 때까지 기다린다. 남은 개수를 돌려준다 */
  drain(timeoutMs?: number): Promise<number>;
}

export type RunTarget = {
  projectId: string;
  cycleId: string;
  deviceId: string;
  runId: string;
  /** 실행자 표시 이름 */
  executor: string;
  /** 실행한 사용자·이 PC의 호스트 연결 (보안 규칙이 Run 소유를 이것으로 본다) */
  executorUid: string;
  hostId: string;
  /** 디바이스 화면 크기 (스크린샷 비율) */
  screen: { w: number; h: number };
};

/** Firestore는 undefined를 저장하지 못한다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Run 기록을 큐 작업으로 바꾼다 */
export function runSink(queue: UploadQueue, t: RunTarget): RunSink {
  const cycle = `projects/${t.projectId}/cycles/${t.cycleId}`;
  const runPath = `${cycle}/runs/${t.runId}`;
  return {
    async start(tcIds, startedAt) {
      const run: Run = {
        id: t.runId,
        cycleId: t.cycleId,
        executor: t.executor,
        executorUid: t.executorUid,
        hostId: t.hostId,
        deviceId: t.deviceId,
        status: 'running',
        tcIds,
        startedAt: startedAt ?? new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      };
      await queue.enqueue({ type: 'set', path: runPath, data: { ...run, _i: Date.now() } });
    },
    waiting: (level) =>
      queue.enqueue(
        level
          ? { type: 'update', path: runPath, data: { waiting: { level, since: new Date().toISOString() } } }
          : { type: 'update', path: runPath, data: {}, remove: ['waiting'] },
      ),
    heartbeat: () => queue.sendNow({ type: 'update', path: runPath, data: { heartbeatAt: new Date().toISOString() } }),
    async saveScreenshot(png, { caseId, index }) {
      const path = `${runPath}/${caseId}/obs-${String(index).padStart(2, '0')}.png`;
      await queue.enqueue({ type: 'upload', path, contentType: 'image/png' }, png);
      return { kind: 'storage', path, w: t.screen.w, h: t.screen.h };
    },
    result: (r) =>
      queue.enqueue({
        type: 'result',
        path: `${cycle}/results/${r.tcId}__${r.deviceId}`,
        data: clean({ ...r, runId: t.runId }),
      }),
    pause: (reason) =>
      queue.enqueue({ type: 'update', path: runPath, data: { status: 'paused', pauseReason: reason } }),
    finish: (status = 'done') =>
      queue.enqueue({
        type: 'update',
        path: runPath,
        data: { status },
        remove: ['currentTcId', 'pauseReason', 'waiting'],
      }),
    drain: (timeoutMs) => queue.drain(timeoutMs),
  };
}

const attemptSummary = (r: CaseResult): AttemptSummary =>
  JSON.parse(
    JSON.stringify({
      attempt: r.attempts,
      verdict: r.verdict,
      decidedBy: r.decidedBy,
      executor: r.executor,
      executedAt: r.executedAt,
      runId: r.runId,
      actualSummary: r.actualSummary,
      blockedReason: r.blockedReason,
    }),
  ) as AttemptSummary;

/** 큐 작업을 Firestore·Storage에 보낸다 */
export function firestoreApply(db: Firestore, storage: FirebaseStorage): ApplyOp {
  return async (op, file) => {
    if (op.type === 'set') return setDoc(doc(db, op.path), op.data);
    if (op.type === 'update') {
      const removed = Object.fromEntries((op.remove ?? []).map((k) => [k, deleteField()]));
      return updateDoc(doc(db, op.path), { ...op.data, ...removed });
    }
    if (op.type === 'upload') {
      await uploadBytes(ref(storage, op.path), file!, { contentType: op.contentType });
      return;
    }
    // 결과 (F-CY-04): 이미 수행한 칸을 다시 실행하면 최신 시도가 최종이 되고, 이전 시도는 attempts에 그대로 보관한다
    // (아직 안 한 칸 N/T는 첫 시도). 같은 시도를 다시 보낸 것이면(업로드 재시도) 보관하지 않는다
    const at = doc(db, op.path);
    const prev = (await getDoc(at)).data() as (CaseResult & { _i?: number; _decision?: string }) | undefined;
    const next = op.data as CaseResult;
    const resent = prev && prev.runId === next.runId && prev.executedAt === next.executedAt;
    if (resent) {
      const kept = prev.previousAttempts ? { previousAttempts: prev.previousAttempts } : {};
      return setDoc(at, { ...op.data, ...kept, attempts: prev.attempts, _i: prev._i ?? Date.now() });
    }
    if (!prev || prev.verdict === 'nt') return setDoc(at, { ...op.data, attempts: 1, _i: prev?._i ?? Date.now() });
    const { _i, _decision: _, ...old } = prev;
    const batch = writeBatch(db);
    batch.set(doc(db, `${op.path}__${old.attempts}`.replace('/results/', '/attempts/')), old);
    batch.set(at, {
      ...op.data,
      attempts: old.attempts + 1,
      previousAttempts: [...(old.previousAttempts ?? []), attemptSummary(old)],
      _i,
    });
    await batch.commit();
  };
}
