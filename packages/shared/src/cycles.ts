import { leaseLive } from './accounts';
import { RUN_STALE_MS, type CaseResult, type Member, type Run, type TestCycle } from './domain';
import { MembershipError, requireEditor, type Actor } from './membership';

/*
 * 사이클 삭제 규칙. 메모리 구현과 Cloud Functions가 같은 함수를 쓰고, 화면은 막는 이유를 미리 보인다.
 * 하위 문서·Storage 증거를 지우는 일은 Functions가 한다(클라이언트는 사이클 문서를 지우지 못한다).
 * 칸 자동 선점 규칙. Functions(claimCell)가 트랜잭션에서 쓴다.
 */

const rule = (m: string) => new MembershipError('rule', m);

/** 지금 삭제를 막는 이유. 없으면 삭제할 수 있다 — 권한·이름 확인은 `cycleDeletion`이 따로 본다 */
export function cycleDeleteBlocker(cycle: TestCycle, runs: Run[], now: string): string | undefined {
  // 완료 기록은 사이클 간 비교의 기준이라 실수로 지우지 않게 다시 열어야 한다
  if (cycle.period.end) return '완료된 사이클은 다시 연 뒤 삭제할 수 있습니다.';
  // 연결 신호가 끊긴 Run은 더 쓰지 않으므로 막지 않는다 (테스트 계정 배정과 같은 기준)
  const live = runs.filter((r) => leaseLive(r, now)).length;
  if (live > 0) return `실행 중인 Run ${live}개가 끝나거나 중단된 뒤 삭제할 수 있습니다.`;
  return undefined;
}

/** 사이클 삭제: Admin·QA만, 사이클 이름을 입력해 확인한다 */
export function cycleDeletion(
  members: Member[],
  actor: Actor,
  cycle: TestCycle,
  runs: Run[],
  confirmName: string,
  now: string,
): void {
  requireEditor(members, actor.uid);
  const blocker = cycleDeleteBlocker(cycle, runs, now);
  if (blocker) throw rule(blocker);
  if (confirmName.trim() !== cycle.name) throw rule('사이클 이름이 일치하지 않습니다.');
}

/**
 * 이 Run이 지금 칸(`currentTcId`)을 잡고 있는가: 실행 중이고 연결 신호가 RUN_STALE_MS 안에 있다.
 * 테스트 계정 배정(leaseLive)과 같은 신호를 쓰되, 일시정지된 Run은 칸을 놓는다 — 진행 중 케이스 결과를 쓰지 않고 멈추므로
 * 그 칸은 남은 칸이다(이어서 실행하면 다시 잡는다)
 */
export function holdsCell(run: Pick<Run, 'status' | 'heartbeatAt'>, now: string): boolean {
  if (run.status !== 'running' || !run.heartbeatAt) return false;
  return Date.parse(now) - Date.parse(run.heartbeatAt) <= RUN_STALE_MS;
}

/** 칸을 건너뛰는 이유 */
export type CellSkip = { reason: 'running'; executor: string; runId: string } | { reason: 'done'; runId?: string };

/**
 * 칸 자동 선점: `run`이 "케이스 × 대상 디바이스" 칸 하나를 잡을 수 있는가. 건너뛸 이유가 없으면 undefined.
 * - 같은 대상 디바이스의 다른 Run이 그 칸을 잡고 있으면(holdsCell) 건너뛴다
 * - 결과가 있는 칸은 건너뛴다. `rerun`(완료된 칸을 일부러 고름)이면 다시 돌리되, 이 Run이 시작한 뒤
 *   다른 Run이 끝낸 칸은 건너뛴다 — 같은 칸을 두 사람이 다시 실행하지 않게
 * `runs`는 그 사이클의 Run들, `result`는 그 칸의 결과 문서
 */
export function cellSkip(
  run: Run,
  runs: Run[],
  result: Pick<CaseResult, 'verdict' | 'runId' | 'executedAt'> | undefined,
  tcId: string,
  rerun: boolean,
  now: string,
): CellSkip | undefined {
  const holder = runs.find(
    (r) => r.id !== run.id && r.deviceId === run.deviceId && r.currentTcId === tcId && holdsCell(r, now),
  );
  if (holder) return { reason: 'running', executor: holder.executor, runId: holder.id };
  if (!result || result.verdict === 'nt') return undefined;
  const byOther =
    result.runId !== run.id && !!result.executedAt && Date.parse(result.executedAt) > Date.parse(run.startedAt);
  if (!rerun || byOther) return { reason: 'done', ...(result.runId ? { runId: result.runId } : {}) };
  return undefined;
}
