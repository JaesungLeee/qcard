import type { SaveScreenshot } from '@qcard/agent';
import type { CaseResult, PauseReason, Run } from '@qcard/shared';
import { deleteField, doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import type { ApplyOp, UploadQueue } from './queue';

/*
 * Run 진행 상태·결과·증거를 팀이 보는 곳(Firestore·Storage)에 기록한다 (F-DB-07, F-EX-06).
 * 기록은 업로드 큐를 거친다 — 네트워크가 끊겨도 로컬에 남았다가 연결되면 순서대로 보낸다 (F-EX-13).
 *
 *   projects/{p}/cycles/{c}/runs/{run}                 Run (현재 케이스·일시정지 이유)
 *   projects/{p}/cycles/{c}/results/{tc}__{device}     CaseResult (칸을 덮어쓰고 시도 횟수를 올린다)
 *   Storage projects/{p}/cycles/{c}/runs/{run}/{tc}/obs-NN.png   스크린샷 (결과에는 경로만 남긴다)
 */

export interface RunSink {
  /** tcIds: 실행 큐 (이어서 실행할 때 쓴다) */
  start(tcIds: string[]): Promise<void>;
  /** 이 케이스 칸을 잡는다 (F-CY-06 칸 자동 선점) */
  progress(tcId: string): Promise<void>;
  saveScreenshot: SaveScreenshot;
  result(r: CaseResult): Promise<void>;
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
    async start(tcIds) {
      const run: Run = {
        id: t.runId,
        cycleId: t.cycleId,
        executor: t.executor,
        deviceId: t.deviceId,
        status: 'running',
        tcIds,
        startedAt: new Date().toISOString(),
      };
      await queue.enqueue({ type: 'set', path: runPath, data: { ...run, _i: Date.now() } });
    },
    progress: (tcId) =>
      queue.enqueue({
        type: 'update',
        path: runPath,
        data: { status: 'running', currentTcId: tcId },
        remove: ['pauseReason'],
      }),
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
        remove: ['currentTcId', 'pauseReason'],
      }),
    drain: (timeoutMs) => queue.drain(timeoutMs),
  };
}

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
    // 결과: 이미 수행한 칸을 다시 실행하면 시도 횟수를 올린다 (아직 안 한 칸 N/T는 첫 시도)
    const at = doc(db, op.path);
    const prev = (await getDoc(at)).data() as (CaseResult & { _i?: number }) | undefined;
    const attempts = prev && prev.verdict !== 'nt' ? prev.attempts + 1 : 1;
    await setDoc(at, { ...op.data, attempts, _i: prev?._i ?? Date.now() });
  };
}
