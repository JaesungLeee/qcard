import type { AutoConfirmCondition, PointResult, Verdict } from '@qcard/shared';
import type { ExecOutcome } from './executor';

export type Judgement = {
  /** 자동 확정 여부를 반영한 판정 */
  verdict: Verdict;
  /** Agent가 낸 원래 판정 */
  agentVerdict: Verdict;
  unmet: AutoConfirmCondition[];
  autoConfirmed: boolean;
};

/**
 * 케이스 판정 집계 (F-EX-04): 불일치 1개 이상 → Fail, 판단불가 포함 → 확인필요, 모두 일치 → Pass.
 * 실행이 막혔으면 Blocked, 크래시면 Fail. Pass는 자동 확정 조건(F-RP-03)을 모두 충족할 때만 Pass로 확정하고
 * 아니면 확인필요로 둔다.
 */
export function judge(
  exec: Pick<ExecOutcome, 'status' | 'recoveries'>,
  points: PointResult[],
  retryLimit = 3,
): Judgement {
  const unmet: AutoConfirmCondition[] = [];
  if (points.length === 0 || points.some((p) => p.result !== 'match')) unmet.push('all_match');
  if (points.some((p) => p.method === 'vision')) unmet.push('tree_only');
  if (exec.recoveries > retryLimit) unmet.push('within_retry');

  const agentVerdict: Verdict =
    exec.status === 'blocked'
      ? 'blocked'
      : exec.status === 'fail' || points.some((p) => p.result === 'mismatch')
        ? 'fail'
        : points.length === 0 || points.some((p) => p.result === 'unknown')
          ? 'check'
          : 'pass';
  const autoConfirmed = agentVerdict === 'pass' && unmet.length === 0;
  return {
    verdict: agentVerdict === 'pass' && !autoConfirmed ? 'check' : agentVerdict,
    agentVerdict,
    unmet,
    autoConfirmed,
  };
}
