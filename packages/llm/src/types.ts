import type Anthropic from '@anthropic-ai/sdk';

/** 호출 목적. 사용량을 역할별로 나눠 보고, 녹화 파일에도 남긴다. */
export type LlmRole = 'executor' | 'verifier' | 'locator' | 'helper' | 'generator';
export type LlmCallMeta = { role: LlmRole; caseId?: string };

export type LlmRequest = Anthropic.MessageCreateParamsNonStreaming;
export type LlmResponse = Anthropic.Message;

/**
 * Claude 호출. 요청·응답은 SDK 타입 그대로 쓴다.
 * 구현: 실제 호출(`createAnthropicLlm`), 녹화·재생(`createCassetteLlm`), 감싸기(`withUsage`·`withSecretGuard`).
 */
/**
 * Claude Code가 API 오류로 혼자 다시 시도하는 중 (stream-json `system/api_retry`).
 * reason은 사람이 읽는 이유 (`retryReason`)
 */
export type LlmRetry = { attempt: number; maxRetries: number; delayMs: number; status?: number; reason: string };

export interface LlmClient {
  create(req: LlmRequest, meta: LlmCallMeta): Promise<LlmResponse>;
}

/**
 * 역할별 기본 모델. Verifier는 PRD상 고정. 요소 찾기(locator)는 M0 실측 정확도를 보고 Haiku로 내릴지 정한다.
 */
export const MODELS: Record<LlmRole, string> = {
  executor: 'claude-sonnet-5-5',
  verifier: 'claude-sonnet-5-5',
  locator: 'claude-sonnet-5-5',
  helper: 'claude-haiku-5-5',
  /** QA Doc Generator (PRD §6.3) */
  generator: 'claude-opus-5-5',
};
