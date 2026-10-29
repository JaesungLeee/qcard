import { z } from 'zod';
import type { Member, Project } from './domain';
import { MembershipError, requireAdmin, type Actor } from './membership';

/*
 * 실행 안전장치 (F-EX-08·F-EX-12). 프로젝트 설정으로 Admin이 바꾸고, 호스트가 Run을 시작할 때 읽는다
 * (사이클에 고정하지 않아 진행 중 사이클도 다음 Run부터 적용). 저장하지 않은 프로젝트는 기본값.
 * 메모리 구현·Cloud Functions가 같은 검사를 쓰고, 화면은 저장 전에 같은 이유를 보인다.
 */

/** 값마다 범위. 화면의 입력 칸과 저장 검사가 함께 쓴다 */
export const RUN_LIMIT_RANGE = {
  turnsPerStep: { min: 1, max: 10 },
  extraTurns: { min: 0, max: 100 },
  repeatLimit: { min: 2, max: 10 },
  retryLimit: { min: 0, max: 20 },
  callsPerCase: { min: 5, max: 500 },
  tokensPerCase: { min: 50_000, max: 10_000_000 },
  tokensPerRun: { min: 500_000, max: 500_000_000 },
  waitTimeoutMin: { min: 1, max: 60 },
} as const;

const int = (k: keyof typeof RUN_LIMIT_RANGE) =>
  z.number().int().min(RUN_LIMIT_RANGE[k].min).max(RUN_LIMIT_RANGE[k].max);

export const RunLimits = z.object({
  /** 케이스당 최대 Agent 턴 = 단계 수 × turnsPerStep + extraTurns (준비·원복 플로우도 그 스텝 수로) */
  turnsPerStep: int('turnsPerStep'),
  extraTurns: int('extraTurns'),
  /** 같은 화면 + 같은 액션을 이만큼 반복하면 Blocked */
  repeatLimit: int('repeatLimit'),
  /** 자가 복구(액션 실패 후 다시 시도)가 이보다 많으면 Pass를 자동 확정하지 않는다 (F-RP-03 ④) */
  retryLimit: int('retryLimit'),
  /** 케이스당 LLM 호출·토큰 (준비·검증·원복 포함). 넘으면 그 케이스 Blocked("실행 한도 초과") */
  callsPerCase: int('callsPerCase'),
  tokensPerCase: int('tokensPerCase'),
  /** Run당 토큰 (이어서 실행한 부분 포함). 케이스가 끝날 때 넘었으면 Run을 일시정지한다 */
  tokensPerRun: int('tokensPerRun'),
  /** 수동 스텝·위험 액션에서 실행자를 기다리는 시간(분). 지나면 그 케이스 Blocked */
  waitTimeoutMin: int('waitTimeoutMin'),
});
export type RunLimits = z.infer<typeof RunLimits>;

/** 기본값 (M0 실측: 케이스당 토큰은 PoC 평균의 약 3배) */
export const DEFAULT_RUN_LIMITS: RunLimits = {
  turnsPerStep: 3,
  extraTurns: 10,
  repeatLimit: 3,
  retryLimit: 3,
  callsPerCase: 40,
  tokensPerCase: 600_000,
  tokensPerRun: 20_000_000,
  waitTimeoutMin: 10,
};

/** 프로젝트에 적용되는 한도. 저장하지 않았거나 예전에 없던 값은 기본값 */
export const runLimitsOf = (project: Pick<Project, 'runLimits'>): RunLimits => ({
  ...DEFAULT_RUN_LIMITS,
  ...project.runLimits,
});

/** 케이스(또는 준비·원복 플로우)의 최대 Agent 턴 */
export const maxTurnsFor = (limits: Pick<RunLimits, 'turnsPerStep' | 'extraTurns'>, steps: number) =>
  steps * limits.turnsPerStep + limits.extraTurns;

/** 저장할 수 없는 이유. 없으면 저장할 수 있다 */
export function runLimitsProblem(limits: RunLimits): string | undefined {
  const r = RunLimits.safeParse(limits);
  if (r.success) return undefined;
  const key = r.error.issues[0]?.path[0] as keyof typeof RUN_LIMIT_RANGE | undefined;
  if (!key || !(key in RUN_LIMIT_RANGE)) return '실행 안전장치 값이 올바르지 않습니다.';
  const { min, max } = RUN_LIMIT_RANGE[key];
  return `${RUN_LIMIT_LABEL[key]}은(는) ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 사이의 정수여야 합니다.`;
}

export const RUN_LIMIT_LABEL: Record<keyof RunLimits, string> = {
  turnsPerStep: '단계당 턴',
  extraTurns: '추가 턴',
  repeatLimit: '같은 액션 반복',
  retryLimit: '자가 복구 횟수',
  callsPerCase: '케이스당 LLM 호출',
  tokensPerCase: '케이스당 토큰',
  tokensPerRun: 'Run당 토큰',
  waitTimeoutMin: '실행자 대기 시간(분)',
};

/** 실행 안전장치 변경 (F-EX-12): Admin만. 값이 범위를 벗어나면 `rule` */
export function runLimitsChange(members: Member[], actor: Actor, limits: RunLimits): RunLimits {
  requireAdmin(members, actor.uid);
  const problem = runLimitsProblem(limits);
  if (problem) throw new MembershipError('rule', problem);
  return RunLimits.parse(limits);
}
