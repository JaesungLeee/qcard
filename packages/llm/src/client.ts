import Anthropic from '@anthropic-ai/sdk';
import { createCassetteLlm } from './cassette';
import { withSecretGuard, type SecretVault } from './secrets';
import type { LlmClient } from './types';
import { withUsage, type UsageMeter } from './usage';

/**
 * 실제 Claude 호출. 자격 증명은 SDK가 환경(ANTHROPIC_API_KEY 또는 `ant auth login` 프로필)에서 읽는다.
 * M1에서 LLM 프록시(Cloud Run)를 붙이면 baseURL만 바꾼다.
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
}): LlmClient {
  const mode = options.mode ?? llmModeFromEnv();
  const live = () => options.live ?? createAnthropicLlm();
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
