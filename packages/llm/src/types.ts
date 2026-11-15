import type Anthropic from '@anthropic-ai/sdk';

/** 호출 목적. 사용량을 역할별로 나눠 보고, 녹화 파일에도 남긴다. */
export type LlmRole = 'executor' | 'verifier' | 'locator' | 'helper' | 'generator' | 'reporter';
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
 * 역할별 기본 모델. Verifier는 Sonnet 고정. 요소 찾기(locator)는 M0 실측 정확도를 보고 Haiku로 내릴지 정한다.
 */
export const MODELS: Record<LlmRole, string> = {
  executor: 'claude-sonnet-5-5',
  verifier: 'claude-sonnet-5-5',
  locator: 'claude-sonnet-5-5',
  helper: 'claude-haiku-5-5',
  /** QA Doc Generator */
  generator: 'claude-opus-5-5',
  /** Reporter: 결함 → 이슈 초안 */
  reporter: 'claude-sonnet-5-5',
};

/** 작업 종류별로 부르는 모델. 시작 전에 Claude Code가 이 모델들을 지원하는 버전인지 본다 */
export const MODELS_FOR = {
  run: [...new Set([MODELS.executor, MODELS.verifier, MODELS.locator])],
  qadoc: [MODELS.generator],
  reporter: [MODELS.reporter],
} as const satisfies Record<string, readonly string[]>;

/**
 * 모델을 처음 지원한 Claude Code 버전 (Claude Code CHANGELOG의 "Added Claude … (`model-id`)" 항목).
 * 이보다 낮으면 그 모델 호출이 "version … or newer is required"로 거절된다. 모델을 바꾸면 함께 고친다
 */
export const CLAUDE_CODE_MIN_VERSION: Record<string, string> = {
  'claude-opus-5-5': '2.1.280',
  'claude-sonnet-5-5': '2.1.284',
  'claude-haiku-5-5': '2.1.293',
};
