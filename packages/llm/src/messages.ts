import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { LlmResponse } from './types';

/** 거절(`stop_reason: refusal`). 검증 포인트는 판단불가, 실행은 Blocked로 처리한다. */
export class LlmRefusalError extends Error {
  override name = 'LlmRefusalError';
  constructor(readonly category: string | null | undefined) {
    super(`LLM이 응답을 거절했습니다${category ? ` (${category})` : ''}`);
  }
}

/** 응답이 잘렸거나 형식이 맞지 않는다 */
export class LlmOutputError extends Error {
  override name = 'LlmOutputError';
}

/** 응답이 제한 시간 안에 오지 않았다 (응답 오류의 한 종류 — 다시 물으면 될 수 있다) */
export class LlmTimeoutError extends LlmOutputError {
  override name = 'LlmTimeoutError';
}

/**
 * Claude Code를 쓸 수 없다(설치 안 됨·로그인 안 됨). 케이스 결함이 아니므로 Blocked가 아니라 Run을 멈추고
 * 실행자에게 해결 방법을 알린다 (F-EX-17).
 */
export class ClaudeCodeSetupError extends Error {
  override name = 'ClaudeCodeSetupError';
  constructor(
    readonly reason: 'not_installed' | 'not_logged_in' | 'outdated',
    message: string,
    /** outdated일 때 필요한 최소 버전 (알면) */
    readonly requiredVersion?: string,
  ) {
    super(message);
  }
}

/** 사용자 플랜의 사용 한도(5시간·주간)에 닿았다. 시간이 지나면 풀리므로 Run을 일시정지한다 (F-EX-17) */
export class PlanLimitError extends Error {
  override name = 'PlanLimitError';
  constructor(
    message: string,
    /** 한도가 풀리는 시각 (ISO). 오류 문구에 없으면 없음 */
    readonly resetsAt?: string,
  ) {
    super(message);
  }
}

export const textOf = (m: LlmResponse) =>
  m.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

export const toolUses = (m: LlmResponse) => m.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

/** 쓸 수 없는 응답이면 던진다. 내용을 읽기 전에 부른다. */
export function assertUsable(m: LlmResponse) {
  if (m.stop_reason === 'refusal') throw new LlmRefusalError(m.stop_details?.category);
  if (m.stop_reason === 'max_tokens') throw new LlmOutputError('max_tokens에 닿아 응답이 잘렸습니다');
}

/** structured output 응답 → 검증된 값 */
export function parseOutput<S extends z.ZodType>(m: LlmResponse, schema: S): z.infer<S> {
  assertUsable(m);
  let raw: unknown;
  try {
    raw = JSON.parse(textOf(m));
  } catch {
    throw new LlmOutputError('응답이 JSON이 아닙니다');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new LlmOutputError(`응답 형식이 스키마와 다릅니다: ${r.error.message}`);
  return r.data;
}

/** 도구 호출 하나를 이름에 맞는 스키마로 검증한다 */
export function parseToolUse<M extends Record<string, z.ZodType>>(
  block: Anthropic.ToolUseBlock,
  schemas: M,
): { [K in keyof M]: { id: string; name: K; input: z.infer<M[K]> } }[keyof M] {
  const schema = schemas[block.name];
  if (!schema) throw new LlmOutputError(`모르는 도구: ${block.name}`);
  const r = schema.safeParse(block.input);
  if (!r.success) throw new LlmOutputError(`${block.name} 인자가 스키마와 다릅니다: ${r.error.message}`);
  return { id: block.id, name: block.name, input: r.data } as never;
}
