import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmRequest } from '@qcard/llm';

/*
 * 테스트용 가짜 LLM: 정해진 응답을 순서대로 돌려준다. 받은 요청은 `requests`에 남는다.
 */

type Reply = Anthropic.ContentBlock[] | ((req: LlmRequest) => Anthropic.ContentBlock[]);

let seq = 0;
export const toolUse = (name: string, input: Record<string, unknown>): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id: `toolu_${++seq}`, name, input, caller: { type: 'direct' } }) as Anthropic.ContentBlock;
export const text = (t: string): Anthropic.ContentBlock => ({ type: 'text', text: t, citations: null });
export const json = (v: unknown) => [text(JSON.stringify(v))];

export function scriptedLlm(replies: Reply[], usage = { input_tokens: 100, output_tokens: 20 }) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    async create(req) {
      requests.push(structuredClone(req));
      const reply = replies.shift();
      if (!reply) throw new Error(`스크립트에 남은 응답 없음 (요청 ${requests.length}번째)`);
      const content = typeof reply === 'function' ? reply(req) : reply;
      return {
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: req.model,
        content,
        stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as Anthropic.Message;
    },
  };
  return { client, requests, left: () => replies.length };
}
