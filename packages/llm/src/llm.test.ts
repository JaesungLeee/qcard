import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXECUTOR_TOOL_INPUTS, VerifierOutput } from '@qcard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CassetteMissError, createCassetteLlm, requestKey } from './cassette';
import { createLlm, llmModeFromEnv } from './client';
import { LlmOutputError, LlmRefusalError, parseOutput, parseToolUse, toolUses } from './messages';
import { assertNoSecrets, SecretLeakError, SecretVault, withSecretGuard } from './secrets';
import { totpCode } from './totp';
import { EXECUTOR_TOOLS, jsonSchema, outputFormat } from './tools';
import type { LlmClient, LlmRequest, LlmResponse } from './types';
import { costUsd, LimitExceededError, UsageMeter, withUsage } from './usage';

/** 정해진 응답을 돌려주고 호출 수를 세는 가짜 LLM */
function fakeLlm(make: (req: LlmRequest) => Partial<LlmResponse> = () => ({})) {
  let calls = 0;
  const client: LlmClient = {
    async create(req) {
      calls++;
      return {
        id: `msg_${calls}`,
        type: 'message',
        role: 'assistant',
        model: req.model,
        content: [{ type: 'text', text: '{}', citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        ...make(req),
      } as LlmResponse;
    },
  };
  return { client, calls: () => calls };
}

const req = (text: string, image = 'AAAA'): LlmRequest => ({
  model: 'claude-sonnet-5-5',
  max_tokens: 1024,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
      ],
    },
  ],
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qcard-cassette-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('녹화·재생', () => {
  it('녹화한 응답을 재생 모드에서 API 없이 돌려준다', async () => {
    const live = fakeLlm();
    const recorded = await createCassetteLlm({ dir, mode: 'record', inner: live.client }).create(req('a'), {
      role: 'executor',
    });
    const replayed = await createCassetteLlm({ dir, mode: 'replay' }).create(req('a'), { role: 'executor' });
    expect(replayed).toEqual(recorded);
    expect(live.calls()).toBe(1);
  });

  it('녹화가 없으면 실패한다 (조용히 실제 호출하지 않는다)', async () => {
    await expect(createCassetteLlm({ dir, mode: 'replay' }).create(req('없음'), { role: 'verifier' })).rejects.toThrow(
      CassetteMissError,
    );
  });

  it('resume: 녹화가 있는 요청은 재생하고 없는 요청만 실제로 부른다 (중단된 작업 이어 하기)', async () => {
    const live = fakeLlm();
    const llm = createCassetteLlm({ dir, mode: 'resume', inner: live.client });
    await llm.create(req('a'), { role: 'generator' });
    await llm.create(req('a'), { role: 'generator' });
    await llm.create(req('b'), { role: 'generator' });
    expect(live.calls()).toBe(2);
  });

  it('키는 객체 키 순서와 무관하고, 내용·이미지가 바뀌면 달라진다', () => {
    const a = req('a');
    const reordered = { messages: a.messages, max_tokens: a.max_tokens, model: a.model } as LlmRequest;
    expect(requestKey(reordered)).toBe(requestKey(a));
    expect(requestKey(req('b'))).not.toBe(requestKey(a));
    expect(requestKey(req('a', 'BBBB'))).not.toBe(requestKey(a));
  });

  it('녹화 파일에는 이미지 원본 대신 해시만 남는다', async () => {
    const big = 'Q'.repeat(10_000);
    await createCassetteLlm({ dir, mode: 'record', inner: fakeLlm().client }).create(req('a', big), {
      role: 'executor',
      caseId: 'TC-1',
    });
    const [file] = await readdir(dir);
    const text = await readFile(join(dir, file!), 'utf8');
    expect(text).not.toContain(big);
    expect(text).toContain('"sha256"');
    expect(JSON.parse(text).meta).toEqual({ role: 'executor', caseId: 'TC-1' });
  });

  it('응답에 API 키가 섞이면 녹화 파일을 쓰지 않는다', async () => {
    const leaky = fakeLlm(() => ({ content: [{ type: 'text', text: 'sk-ant-api03-abcdefghijkl', citations: null }] }));
    await expect(
      createCassetteLlm({ dir, mode: 'record', inner: leaky.client }).create(req('a'), { role: 'helper' }),
    ).rejects.toThrow(SecretLeakError);
    expect(await readdir(dir)).toEqual([]);
  });

  it('LLM_MODE 기본값은 replay, 모르는 값은 에러', () => {
    expect(llmModeFromEnv(undefined)).toBe('replay');
    expect(llmModeFromEnv('record')).toBe('record');
    expect(() => llmModeFromEnv('prod')).toThrow();
  });
});

describe('사용량·한도 (F-EX-12)', () => {
  it('캐시 읽기는 0.1배, 캐시 쓰기는 1.25배로 계산한다', () => {
    const usage = {
      input_tokens: 1_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 500,
    };
    // Sonnet 5.5: (1,000 + 12,500 + 10,000) × $2 + 500 × $10 = 47,000 + 5,000 → $0.052
    expect(costUsd('claude-sonnet-5-5', usage)).toBeCloseTo(0.052, 6);
    expect(() => costUsd('gpt-x', usage)).toThrow();
  });

  it('케이스 호출 한도에 닿으면 다음 호출 전에 막는다', async () => {
    const live = fakeLlm();
    const meter = new UsageMeter({ maxCallsPerCase: 2 });
    const llm = withUsage(live.client, meter);
    await llm.create(req('1'), { role: 'executor', caseId: 'TC-1' });
    await llm.create(req('2'), { role: 'verifier', caseId: 'TC-1' });
    const err = await llm.create(req('3'), { role: 'executor', caseId: 'TC-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect((err as LimitExceededError).limit).toBe('maxCallsPerCase');
    expect(live.calls()).toBe(2);
    // 다른 케이스는 계속 간다
    await llm.create(req('4'), { role: 'executor', caseId: 'TC-2' });
    expect(meter.forCase('TC-1')).toMatchObject({ calls: 2, tokens: 240 });
    expect(meter.forRole('executor').calls).toBe(2);
    expect(meter.run.calls).toBe(3);
  });

  it('재생 모드에서도 녹화된 usage로 한도를 계산한다', async () => {
    await createCassetteLlm({ dir, mode: 'record', inner: fakeLlm().client }).create(req('a'), { role: 'executor' });
    const meter = new UsageMeter({ maxTokensPerRun: 100 });
    const llm = createLlm({ mode: 'replay', cassetteDir: dir, meter });
    await llm.create(req('a'), { role: 'executor' });
    await expect(llm.create(req('a'), { role: 'executor' })).rejects.toThrow(LimitExceededError);
  });
});

describe('비밀값 (F-EX-09)', () => {
  it('플레이스홀더 ↔ 실제 값, 로그용 마스킹', () => {
    const v = new SecretVault();
    const ph = v.set('owner_password', 'pa55word!');
    expect(ph).toBe('{{secret.owner_password}}');
    expect(v.resolve(`입력: ${ph}`)).toBe('입력: pa55word!');
    expect(v.mask('입력: pa55word!')).toBe(`입력: ${ph}`);
    expect(() => v.resolve('{{secret.otp}}')).toThrow(/otp/);
    v.clear();
    expect(v.findLeak('pa55word!')).toBeUndefined();
  });

  it('TOTP 코드는 입력할 때 만들고, 만든 코드는 가리고 유출 검사에도 쓴다', () => {
    // RFC 6238 부록 B (SHA-1 시드 "12345678901234567890"의 base32, 59초 → 94287082의 뒤 6자리)
    const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(seed, 59_000, 8)).toBe('94287082');
    expect(totpCode(seed, 59_000)).toBe('287082');
    let now = 59_000;
    const v = new SecretVault();
    v.setDynamic('totp', () => totpCode(seed, now));
    expect(v.has('totp')).toBe(true);
    expect(v.resolve('{{secret.totp}}')).toBe('287082');
    expect(v.mask('코드 287082 입력됨')).toBe('코드 {{secret.totp}} 입력됨');
    expect(v.findLeak('287082')).toBe('totp');
    now = 1_111_111_109_000;
    expect(v.resolve('{{secret.totp}}')).toBe('081804');
    v.clear();
    expect(v.has('totp')).toBe(false);
    expect(v.findLeak('287082')).toBeUndefined();
  });

  it('LLM 요청에 실제 비밀값이 있으면 보내지 않는다', async () => {
    const v = new SecretVault();
    v.set('owner_password', 'pa55word!');
    const live = fakeLlm();
    const llm = withSecretGuard(live.client, v);
    await expect(llm.create(req('비번은 pa55word!'), { role: 'executor' })).rejects.toThrow(SecretLeakError);
    await llm.create(req('비번은 {{secret.owner_password}}'), { role: 'executor' });
    expect(live.calls()).toBe(1);
  });

  it('이미지 데이터는 검사하지 않는다 (base64 우연 일치 오탐 방지)', () => {
    const v = new SecretVault();
    v.set('pin', 'QQQQ');
    expect(() => assertNoSecrets(req('a', 'QQQQQQQQ'), v)).not.toThrow();
    expect(() => assertNoSecrets(req('QQQQ'), v)).toThrow(SecretLeakError);
    v.set('quoted', 'a"b\\c');
    expect(() => assertNoSecrets(req('값 a"b\\c'), v)).toThrow(/quoted/);
  });
});

describe('도구·출력 스키마', () => {
  type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; [k: string]: unknown };

  it('Executor 도구는 strict이고 모든 필드가 필수, 추가 필드 금지', () => {
    expect(EXECUTOR_TOOLS.map((t) => t.name)).toEqual(Object.keys(EXECUTOR_TOOL_INPUTS));
    for (const tool of EXECUTOR_TOOLS) {
      const s = tool.input_schema as Schema;
      expect(tool.strict).toBe(true);
      expect(s).toMatchObject({ type: 'object', additionalProperties: false });
      expect(s.required?.slice().sort()).toEqual(Object.keys(s.properties ?? {}).sort());
      expect(JSON.stringify(s)).not.toContain('$schema');
    }
  });

  it('enum은 유지하고, 숫자 범위는 설명으로 옮기고, nullable은 anyOf로', () => {
    const s = outputFormat(VerifierOutput).schema as Schema;
    expect(s.properties?.result).toEqual({ type: 'string', enum: ['match', 'mismatch', 'unknown'] });
    expect(s.properties?.target_element).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    const wait = jsonSchema(EXECUTOR_TOOL_INPUTS.wait) as Schema;
    expect(wait.properties?.seconds).toEqual({ type: 'integer', description: '(minimum: 1, maximum: 10)' });
  });
});

describe('응답 해석', () => {
  it('structured output을 스키마로 검증한다', async () => {
    const verdict = { result: 'match', observed: '저장 버튼', reason: '보임', target_element: 'e5' };
    const ok = await fakeLlm(() => ({
      content: [{ type: 'text', text: JSON.stringify(verdict), citations: null }],
    })).client.create(req('a'), { role: 'verifier' });
    expect(parseOutput(ok, VerifierOutput)).toEqual(verdict);

    const bad = await fakeLlm(() => ({
      content: [{ type: 'text', text: '{"result":"maybe"}', citations: null }],
    })).client.create(req('a'), { role: 'verifier' });
    expect(() => parseOutput(bad, VerifierOutput)).toThrow(LlmOutputError);
  });

  it('거절·잘림은 내용을 읽기 전에 에러', async () => {
    const refused = await fakeLlm(() => ({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    })).client.create(req('a'), { role: 'verifier' });
    expect(() => parseOutput(refused, z.object({}))).toThrow(LlmRefusalError);
    const cut = await fakeLlm(() => ({ stop_reason: 'max_tokens' })).client.create(req('a'), { role: 'verifier' });
    expect(() => parseOutput(cut, z.object({}))).toThrow(/max_tokens/);
  });

  it('도구 호출을 이름별 스키마로 검증한다', async () => {
    const m = await fakeLlm(() => ({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'tap', input: { element_ref: 'e5', intent: '저장' }, caller: null },
        { type: 'tool_use', id: 'tu_2', name: 'swipe', input: { direction: 'diagonal', intent: '?' }, caller: null },
      ] as unknown as LlmResponse['content'],
    })).client.create(req('a'), { role: 'executor' });
    const [tap, swipe] = toolUses(m);
    expect(parseToolUse(tap!, EXECUTOR_TOOL_INPUTS)).toEqual({
      id: 'tu_1',
      name: 'tap',
      // 빠진 위험 표시는 null (위험 아님)
      input: { element_ref: 'e5', intent: '저장', risk: null },
    });
    expect(() => parseToolUse(swipe!, EXECUTOR_TOOL_INPUTS)).toThrow(LlmOutputError);
  });
});
