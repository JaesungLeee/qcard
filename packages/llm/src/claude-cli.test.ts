import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createClaudeCliLlm, type CliProcess, type CliResult } from './claude-cli';
import { ClaudeCodeSetupError, LlmOutputError, LlmTimeoutError, PlanLimitError, toolUses } from './messages';
import type { LlmRequest, LlmRetry } from './types';

/**
 * 보낸 메시지를 기록하고, 정해진 result를 차례로 돌려주는 가짜 claude 프로세스. 'silent'면 답하지 않는다.
 * 'overloaded'면 서버 혼잡으로 다시 시도한다는 알림만 보내고 답하지 않는다
 */
function fakeCli(results: (Partial<CliResult> | 'exit' | 'silent' | 'overloaded')[]) {
  const procs: { args: string[]; sent: unknown[]; closed: boolean }[] = [];
  const spawn = (args: string[]): CliProcess => {
    const p = { args, sent: [] as unknown[], closed: false };
    procs.push(p);
    let onMessage: (m: { type: string } & Record<string, unknown>) => void = () => {};
    let onExit: (e?: Error) => void = () => {};
    return {
      send(m) {
        p.sent.push(m);
        const r = results.shift();
        queueMicrotask(() => {
          if (r === 'silent') return;
          if (r === 'overloaded') {
            for (const attempt of [1, 2])
              onMessage({
                type: 'system',
                subtype: 'api_retry',
                attempt,
                max_retries: 10,
                retry_delay_ms: 1000,
                error_status: 529,
                error: 'server_error',
              });
            return;
          }
          if (!r || r === 'exit') return onExit();
          onMessage({ type: 'result', subtype: 'success', is_error: false, ...r });
        });
      },
      onMessage: (cb) => (onMessage = cb),
      onExit: (cb) => (onExit = cb),
      close: () => (p.closed = true),
    };
  };
  return { spawn, procs };
}

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
const tapTool: Anthropic.Tool = {
  name: 'tap',
  description: '요소를 탭한다',
  input_schema: { type: 'object', properties: { element_ref: { type: 'string' } }, required: ['element_ref'] },
};
const execReq = (messages: Anthropic.MessageParam[]): LlmRequest => ({
  model: 'claude-sonnet-5-5',
  max_tokens: 4096,
  output_config: { effort: 'medium' },
  system: [{ type: 'text', text: 'Executor다' }],
  tools: [tapTool],
  messages,
});
const meta = { role: 'executor' as const, caseId: 'TC-1' };
const calls = (thought: string, list: { name: string; input: object }[]) => JSON.stringify({ thought, calls: list });

describe('createClaudeCliLlm', () => {
  it('구조화 출력은 --json-schema로 받아 JSON text로 돌려준다. 내장 도구·설정은 끈다', async () => {
    const cli = fakeCli([{ structured_output: { verdict: 'match' }, usage }]);
    const llm = createClaudeCliLlm({ spawn: cli.spawn });
    const schema = { type: 'object', properties: { verdict: { type: 'string' } } };
    const res = await llm.create(
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        system: '판정한다',
        messages: [{ role: 'user', content: '판정해' }],
      },
      { role: 'verifier' },
    );
    expect(res.content).toEqual([{ type: 'text', text: '{"verdict":"match"}', citations: null }]);
    expect(res.usage).toMatchObject(usage);
    const args = cli.procs[0]!.args;
    expect(args).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
    expect(args[args.indexOf('--system-prompt') + 1]).toMatch(/^판정한다\n\n/);
  });

  it('도구 요청은 호출 목록 JSON 글로 받아 tool_use로 바꾸고, 이어지는 턴은 같은 세션에 결과만 보낸다', async () => {
    const cli = fakeCli([
      { result: calls('로그인 버튼이 보인다', [{ name: 'tap', input: { element_ref: 'e3' } }]), usage },
      { result: calls('', []), usage },
    ]);
    const llm = createClaudeCliLlm({ spawn: cli.spawn });
    const first: Anthropic.MessageParam = { role: 'user', content: '단계 0: 로그인' };
    const r1 = await llm.create(execReq([first]), meta);
    expect(r1.stop_reason).toBe('tool_use');
    expect(r1.content[0]).toMatchObject({ type: 'text', text: '로그인 버튼이 보인다' });
    const [use] = toolUses(r1);
    expect(use).toMatchObject({ name: 'tap', input: { element_ref: 'e3' } });
    // StructuredOutput은 쓰지 않고(턴이 끝나지 않음), 도구 설명·스키마를 시스템 프롬프트에 넣는다
    const args = cli.procs[0]!.args;
    expect(args).not.toContain('--json-schema');
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('### tap\n요소를 탭한다');

    const r2 = await llm.create(
      execReq([
        first,
        { role: 'assistant', content: r1.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: use!.id, content: '탭했습니다' }] },
      ]),
      meta,
    );
    expect(r2.stop_reason).toBe('end_turn');
    expect(cli.procs).toHaveLength(1);
    expect(cli.procs[0]!.sent[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '[tap 결과] 탭했습니다' }] },
    });
  });

  it('호출 목록 형식이 틀리면 같은 세션에서 한 번 다시 묻고, 사용량은 합친다', async () => {
    const cli = fakeCli([
      { result: '탭하겠습니다', usage },
      { result: '```json\n' + calls('다시', [{ name: 'tap', input: { element_ref: 'e1' } }]) + '\n```', usage },
    ]);
    const llm = createClaudeCliLlm({ spawn: cli.spawn });
    const r = await llm.create(execReq([{ role: 'user', content: 'x' }]), meta);
    expect(toolUses(r)).toHaveLength(1);
    expect(r.usage.output_tokens).toBe(usage.output_tokens * 2);
    expect(JSON.stringify(cli.procs[0]!.sent[1])).toContain('응답 형식 오류');
  });

  it('이어 붙일 세션이 없으면 지난 대화를 글로 옮겨 새 세션에 보낸다', async () => {
    const cli = fakeCli([{ result: calls('', []), usage }]);
    const llm = createClaudeCliLlm({ spawn: cli.spawn });
    await llm.create(
      execReq([
        { role: 'user', content: '단계 0' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'tap', input: { element_ref: 'e1' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '실패', is_error: true }] },
      ]),
      meta,
    );
    const sent = cli.procs[0]!.sent[0] as { message: { content: { text?: string }[] } };
    const text = sent.message.content.map((b) => b.text).join('\n');
    expect(text).toContain('[Agent] tap({"element_ref":"e1"})');
    expect(text).toContain('[tap 결과 · 오류] 실패');
  });

  it('로그인 안 됨·플랜 한도·그 밖의 오류를 구분한다', async () => {
    const run = (r: Partial<CliResult> | 'exit') =>
      createClaudeCliLlm({ spawn: fakeCli([r]).spawn })
        .create(execReq([{ role: 'user', content: 'x' }]), meta)
        .catch((e: unknown) => e);
    expect(await run({ is_error: true, result: 'Not logged in · Please run /login' })).toBeInstanceOf(
      ClaudeCodeSetupError,
    );
    expect(
      await run({
        is_error: true,
        result:
          "API Error: 400 Claude Code 2.1.185 does not support this model; version 2.1.280 or newer is required. Run 'claude update'",
      }),
    ).toMatchObject({ name: 'ClaudeCodeSetupError', reason: 'outdated' });
    expect(await run({ is_error: true, api_error_status: 429, result: 'limit' })).toBeInstanceOf(PlanLimitError);
    expect(await run({ is_error: true, result: '알 수 없음' })).toBeInstanceOf(LlmOutputError);
    expect(await run('exit')).toBeInstanceOf(LlmOutputError);
  });

  it('구조화 출력 요청에 결과가 없으면 응답 오류', async () => {
    const cli = fakeCli([{ result: '음', usage }]);
    const err = await createClaudeCliLlm({ spawn: cli.spawn })
      .create(
        {
          model: 'claude-sonnet-5-5',
          max_tokens: 100,
          output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
          messages: [{ role: 'user', content: 'x' }],
        },
        { role: 'verifier' },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmOutputError);
  });

  it('응답이 없으면 다시 묻지 않고 사유를 담은 응답 오류로 끝낸다 (케이스는 Blocked)', async () => {
    const cli = fakeCli(['silent', { result: calls('', []), usage }]);
    const err = await createClaudeCliLlm({ spawn: cli.spawn, turnTimeoutMs: 20 })
      .create(execReq([{ role: 'user', content: 'x' }]), meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmTimeoutError);
    expect(err).toBeInstanceOf(LlmOutputError);
    expect((err as Error).message).toMatch(/Claude Code가 0초 동안 응답하지 않았습니다/);
    // 멈춘 프로세스는 닫고, 새로 띄워 다시 묻지 않는다
    expect(cli.procs.map((p) => [p.closed, p.sent.length])).toEqual([[true, 1]]);
  });

  it('Claude Code가 API 오류로 다시 시도하면 알리고, 응답이 끝내 없으면 그 이유를 사유에 담는다', async () => {
    const cli = fakeCli(['overloaded']);
    const retries: LlmRetry[] = [];
    const err = await createClaudeCliLlm({ spawn: cli.spawn, turnTimeoutMs: 20, onRetry: (r) => retries.push(r) })
      .create(execReq([{ role: 'user', content: 'x' }]), meta)
      .catch((e: unknown) => e);
    expect(retries.map((r) => [r.attempt, r.maxRetries, r.reason])).toEqual([
      [1, 10, 'Claude 서버 혼잡(529)'],
      [2, 10, 'Claude 서버 혼잡(529)'],
    ]);
    expect(err).toBeInstanceOf(LlmTimeoutError);
    expect((err as Error).message).toMatch(/Claude 서버 혼잡\(529\)로 2번 다시 시도하는 중이었습니다/);
  });

  it('close하면 세션 프로세스를 닫는다', async () => {
    const cli = fakeCli([{ result: calls('', []), usage }]);
    const llm = createClaudeCliLlm({ spawn: cli.spawn });
    await llm.create(execReq([{ role: 'user', content: 'x' }]), meta);
    llm.close();
    expect(cli.procs[0]!.closed).toBe(true);
  });
});
