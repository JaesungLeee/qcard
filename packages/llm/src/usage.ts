import type Anthropic from '@anthropic-ai/sdk';
import type { LlmCallMeta, LlmClient } from './types';

/** 100만 토큰당 USD. 캐시 읽기는 입력의 0.1배, 캐시 쓰기(5분)는 1.25배 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

type Usage = Pick<
  Anthropic.Usage,
  'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'
>;

/** 한도 계산용 토큰 수: 입력(캐시 포함) + 출력 */
export const totalTokens = (u: Usage) =>
  u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens;

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`단가를 모르는 모델: ${model}`);
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + u.output_tokens * p.output) / 1_000_000;
}

export type UsageTotals = { calls: number; tokens: number; costUsd: number; cacheReadTokens: number };
const empty = (): UsageTotals => ({ calls: 0, tokens: 0, costUsd: 0, cacheReadTokens: 0 });

/**
 * 실행 안전장치 중 케이스 단위. 값은 프로젝트 설정(`RunLimits`)에서 온다.
 * Run당 토큰은 케이스 도중에 끊지 않고 케이스 사이에서 Run을 일시정지하므로 호스트가 따로 본다
 */
export type UsageLimits = { maxCallsPerCase?: number; maxTokensPerCase?: number };

/** 한도 초과 → 해당 케이스 Blocked("실행 한도 초과") */
export class LimitExceededError extends Error {
  override name = 'LimitExceededError';
  constructor(
    readonly limit: keyof UsageLimits,
    message: string,
  ) {
    super(message);
  }
}

export class UsageMeter {
  readonly run: UsageTotals = empty();
  private readonly cases = new Map<string, UsageTotals>();
  private readonly roles = new Map<string, UsageTotals>();

  constructor(readonly limits: UsageLimits = {}) {}

  forCase(caseId: string): UsageTotals {
    return this.cases.get(caseId) ?? empty();
  }
  forRole(role: string): UsageTotals {
    return this.roles.get(role) ?? empty();
  }

  record(model: string, usage: Usage, meta: LlmCallMeta) {
    const add = (t: UsageTotals) => {
      t.calls++;
      t.tokens += totalTokens(usage);
      t.costUsd += costUsd(model, usage);
      t.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      return t;
    };
    add(this.run);
    this.roles.set(meta.role, add(this.forRole(meta.role)));
    if (meta.caseId) this.cases.set(meta.caseId, add(this.forCase(meta.caseId)));
  }

  /** 다음 호출 전에 확인한다. 이미 한도에 닿았으면 던진다. */
  check(meta: LlmCallMeta) {
    const { maxCallsPerCase, maxTokensPerCase } = this.limits;
    if (!meta.caseId) return;
    const c = this.forCase(meta.caseId);
    if (maxCallsPerCase !== undefined && c.calls >= maxCallsPerCase) {
      throw new LimitExceededError('maxCallsPerCase', `케이스 LLM 호출 한도 초과 (${c.calls} ≥ ${maxCallsPerCase})`);
    }
    if (maxTokensPerCase !== undefined && c.tokens >= maxTokensPerCase) {
      throw new LimitExceededError('maxTokensPerCase', `케이스 토큰 한도 초과 (${c.tokens} ≥ ${maxTokensPerCase})`);
    }
  }
}

export function withUsage(inner: LlmClient, meter: UsageMeter): LlmClient {
  return {
    async create(req, meta) {
      meter.check(meta);
      const res = await inner.create(req, meta);
      meter.record(req.model, res.usage, meta);
      return res;
    },
  };
}
