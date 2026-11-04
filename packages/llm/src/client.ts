import Anthropic from '@anthropic-ai/sdk';
import { createCassetteLlm } from './cassette';
import { createClaudeCliLlm } from './claude-cli';
import { withSecretGuard, type SecretVault } from './secrets';
import type { LlmClient, LlmRetry } from './types';
import { withUsage, type UsageMeter } from './usage';

/**
 * Anthropic API 직접 호출 (개발·테스트용, docs/security.md). 자격 증명은 SDK가 환경(ANTHROPIC_API_KEY 또는
 * `ant auth login` 프로필)에서 읽는다. 제품 경로는 사용자 본인의 Claude Code(`createClaudeCliLlm`)다.
 */
export function createAnthropicLlm(options: { client?: Anthropic; baseURL?: string } = {}): LlmClient {
  const client = options.client ?? new Anthropic({ baseURL: options.baseURL, maxRetries: 2 });
  return { create: (req) => client.messages.create(req) };
}

/** replay(기본): 녹화만 재생 · record: 실제 호출하고 녹화 · live: 실제 호출만 */
export type LlmMode = 'replay' | 'record' | 'live';

export function llmModeFromEnv(value = process.env.LLM_MODE): LlmMode {
  const mode = value ?? 'replay';
  if (mode !== 'replay' && mode !== 'record' && mode !== 'live') {
    throw new Error(`LLM_MODE는 replay·record·live 중 하나: ${mode}`);
  }
  return mode;
}

/** 실제 호출을 누가 하는가. claude-cli(기본): 사용자 본인 플랜의 Claude Code · api: Anthropic API 키 */
export type LlmProvider = 'claude-cli' | 'api';

export function llmProviderFromEnv(value = process.env.LLM_PROVIDER): LlmProvider {
  const provider = value ?? 'claude-cli';
  if (provider !== 'claude-cli' && provider !== 'api') {
    throw new Error(`LLM_PROVIDER는 claude-cli·api 중 하나: ${provider}`);
  }
  return provider;
}

/** 실제 호출 구현. claude-cli는 세션 프로세스를 닫을 수 있게 `close`를 함께 돌려준다 */
export function createLiveLlm(
  provider = llmProviderFromEnv(),
  options: { turnTimeoutMs?: number; onRetry?: (r: LlmRetry) => void } = {},
): LlmClient & { close?: () => void } {
  return provider === 'api' ? createAnthropicLlm() : createClaudeCliLlm(options);
}

/**
 * 모드에 맞는 LlmClient를 조립한다. 바깥부터: 비밀값 검사 → 사용량·한도 → 녹화/재생 또는 실제 호출.
 * 재생할 때도 녹화된 usage로 한도를 계산하므로 한도 동작을 오프라인으로 시험할 수 있다.
 */
export function createLlm(options: {
  mode?: LlmMode;
  cassetteDir: string;
  vault?: SecretVault;
  meter?: UsageMeter;
  live?: LlmClient;
  /** 실제 호출이 Claude Code일 때, API 오류로 다시 시도하는 중임을 알린다 */
  onRetry?: (r: LlmRetry) => void;
}): LlmClient {
  const mode = options.mode ?? llmModeFromEnv();
  const live = () => options.live ?? createLiveLlm(undefined, { onRetry: options.onRetry });
  let client: LlmClient =
    mode === 'replay'
      ? createCassetteLlm({ dir: options.cassetteDir, mode: 'replay' })
      : mode === 'record'
        ? createCassetteLlm({ dir: options.cassetteDir, mode: 'record', inner: live() })
        : live();
  if (options.meter) client = withUsage(client, options.meter);
  if (options.vault) client = withSecretGuard(client, options.vault);
  return client;
}
