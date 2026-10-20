import type Anthropic from '@anthropic-ai/sdk';
import { EXECUTOR_TOOL_DESCRIPTIONS, EXECUTOR_TOOL_INPUTS, type ExecutorToolName } from '@qcard/shared';
import { z } from 'zod';

type Json = Record<string, unknown>;

/** strict 도구·structured output이 받는 키워드. 나머지(숫자 범위·길이 등)는 설명문으로 옮기고 응답은 Zod로 다시 검증한다 */
const KEEP = new Set([
  'type',
  'description',
  'enum',
  'const',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
]);

function strictify(node: Json): Json {
  const out: Json = {};
  const moved: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue;
    if (!KEEP.has(k)) moved.push(`${k}: ${JSON.stringify(v)}`);
    else if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, Json>).map(([p, s]) => [p, strictify(s)]));
    } else if (k === 'items') out[k] = strictify(v as Json);
    else if (k === 'anyOf') out[k] = (v as Json[]).map(strictify);
    else out[k] = v;
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (moved.length) out.description = [out.description, `(${moved.join(', ')})`].filter(Boolean).join(' ');
  // nullable은 `type: [x, 'null']` 대신 anyOf로 쓴다
  if (Array.isArray(out.type)) {
    const { type, description, ...rest } = out;
    return { ...(description ? { description } : {}), anyOf: (type as string[]).map((t) => (t === 'null' ? { type: t } : { ...rest, type: t })) };
  }
  return out;
}

/** Zod → strict JSON Schema. 선택 필드는 쓰지 않는다(전부 required, 없을 수 있으면 nullable) */
export const jsonSchema = (schema: z.ZodType): Json => strictify(z.toJSONSchema(schema) as Json);

/**
 * strict 도구. Sonnet 5.5는 특정 도구 강제(tool_choice any/tool)를 받지 않으므로(400)
 * tool_choice는 기본값(auto)으로 두고 프롬프트로 유도하며, 인자 형식은 strict로 보장한다.
 */
export function toTool(name: string, description: string, schema: z.ZodType): Anthropic.Tool {
  return { name, description, input_schema: jsonSchema(schema) as Anthropic.Tool.InputSchema, strict: true };
}

export const EXECUTOR_TOOLS: Anthropic.Tool[] = (Object.keys(EXECUTOR_TOOL_INPUTS) as ExecutorToolName[]).map((name) =>
  toTool(name, EXECUTOR_TOOL_DESCRIPTIONS[name], EXECUTOR_TOOL_INPUTS[name]),
);

/** structured output 형식 (`output_config.format`). 녹화 키가 흔들리지 않게 순수 JSON만 남긴다. */
export function outputFormat(schema: z.ZodType): Anthropic.JSONOutputFormat {
  return { type: 'json_schema', schema: jsonSchema(schema) };
}

/**
 * 캐시 지점을 찍은 시스템 프롬프트. 캐시는 tools → system → messages 순서의 접두어 일치이므로,
 * 도구와 시스템 프롬프트는 케이스 내내 바꾸지 않고 매 스텝의 트리·스크린샷은 messages 끝에 붙인다.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
