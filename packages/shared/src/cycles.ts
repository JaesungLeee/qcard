import { leaseLive } from './accounts';
import type { Member, Run, TestCycle } from './domain';
import { MembershipError, requireEditor, type Actor } from './membership';

/*
 * 사이클 삭제 규칙 (F-CY-10). 메모리 구현과 Cloud Functions가 같은 함수를 쓰고, 화면은 막는 이유를 미리 보인다.
 * 하위 문서·Storage 증거를 지우는 일은 Functions가 한다(클라이언트는 사이클 문서를 지우지 못한다).
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

/** 사이클 삭제 (F-CY-10): Admin·QA만, 사이클 이름을 입력해 확인한다 */
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
