import type Anthropic from '@anthropic-ai/sdk';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { compareVersions } from '@qcard/shared';
import { canonicalJson } from './canonical';
import { ClaudeCodeSetupError, LlmOutputError, LlmTimeoutError, PlanLimitError } from './messages';
import { CLAUDE_CODE_MIN_VERSION, type LlmClient, type LlmRequest, type LlmResponse, type LlmRetry } from './types';

/*
 * 사용자 PC에 설치·로그인된 Claude Code를 헤드리스(`claude -p`)로 실행해 LLM을 부른다 (docs/security.md).
 * 사용자 본인의 Claude 플랜으로 과금되고, qcard는 자격 증명을 읽거나 전달하지 않는다.
 *
 * 요청·응답은 다른 구현과 같은 Messages API 형태로 주고받는다. 그래서 녹화·재생·사용량·비밀값 검사는 그대로 쓴다.
 * - 구조화 출력(`output_config.format`) → `--json-schema`, 결과 JSON을 text 블록으로 돌려준다
 * - 도구(`tools`) → "이번 턴에 실행할 도구 호출 목록" JSON 글로 받아 tool_use 블록으로 바꾼다 (형식이 틀리면 한 번 다시 묻는다)
 * - 이어지는 대화는 같은 프로세스(stream-json 세션)에 새 user 메시지만 보낸다. 이어 붙일 세션이 없으면
 *   (처음이거나 유휴로 닫혔으면) 지난 대화를 글로 옮겨 새 세션에 한 번에 보낸다
 * Claude Code 내장 도구·MCP·사용자/프로젝트 설정은 모두 끄고, 세션은 디스크에 남기지 않는다.
 */

/** stream-json 출력의 result 이벤트 */
export type CliResult = {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  stop_reason?: string | null;
  api_error_status?: number | null;
  structured_output?: unknown;
  usage?: Partial<Anthropic.Usage>;
};

/** CLI 프로세스 하나. 테스트에서는 가짜로 바꾼다 */
export interface CliProcess {
  /** 한 줄 JSON 메시지를 보낸다 */
  send(message: unknown): void;
  onMessage(cb: (message: { type: string } & Record<string, unknown>) => void): void;
  onExit(cb: (error?: Error) => void): void;
  close(): void;
}
export type CliSpawn = (args: string[]) => CliProcess;

const NO_TRAILING_TEXT = '답은 StructuredOutput 도구로 한 번만 내고, 그 뒤에는 아무 글도 쓰지 않는다.';

/**
 * 도구 요청: 내장 도구 없이 "이번 턴에 실행할 호출 목록" JSON 하나로 답하게 한다.
 * `--json-schema`(StructuredOutput 도구)는 부른 뒤에도 턴이 끝나지 않아, 모델이 결과를 기다리며 같은 턴에서
 * 호출을 반복한다(실측). 글로 답하면 턴마다 모델 호출이 정확히 한 번이고, 인자는 Executor가 Zod로 다시 검증한다.
 */
function toolProtocol(tools: Anthropic.Tool[]): string {
  return [
    '## 응답 방식',
    '도구는 직접 실행되지 않는다. 매 턴 아래 형식의 JSON 객체 하나만 답한다(코드 블록·다른 글 없이).',
    '시스템이 calls를 순서대로 실행하고, 각 호출의 결과("[도구이름 결과] …")와 새 화면 관찰을 다음 메시지로 보낸다.',
    '{"thought": "지금 화면에서 판단한 내용과 이번 호출의 이유 (짧게)", "calls": [{"name": "도구 이름", "input": {…}}]}',
    '',
    '## 도구',
    ...tools.map((t) => `### ${t.name}\n${t.description ?? ''}\ninput 스키마: ${JSON.stringify(t.input_schema)}`),
  ].join('\n');
}

/** 한 턴 응답을 기다리는 시간. 넘으면 그 호출은 실패하고 케이스는 Blocked */
export const TURN_TIMEOUT_MS = 180_000;

export function createClaudeCliLlm(
  options: {
    spawn?: CliSpawn;
    /** 한 턴 응답을 기다리는 시간 (기본 180초) */
    turnTimeoutMs?: number;
    /** 이어 붙일 요청이 없을 때 세션을 닫기까지 (기본 60초) */
    idleMs?: number;
    /** Claude Code가 API 오류로 다시 시도할 때 (응답이 늦어지는 이유) */
    onRetry?: (r: LlmRetry) => void;
  } = {},
): LlmClient & { close(): void } {
  const spawnCli = options.spawn ?? spawnClaude;
  const sessions = new Set<Session>();

  return {
    async create(req) {
      const last = req.messages.at(-1);
      if (!last || last.role !== 'user') throw new Error('마지막 메시지는 user여야 합니다');
      const kind = req.tools?.length ? 'tools' : req.output_config?.format ? 'json' : 'text';
      const schema = kind === 'json' ? (req.output_config!.format as Anthropic.JSONOutputFormat).schema : undefined;
      const rule =
        kind === 'tools' ? toolProtocol(req.tools as Anthropic.Tool[]) : kind === 'json' ? NO_TRAILING_TEXT : undefined;
      const system = [systemText(req.system), rule].filter(Boolean).join('\n\n');
      const effort = req.output_config?.effort ?? undefined;
      const config = canonicalJson({ model: req.model, system, schema, effort });

      const priorKey = canonicalJson(req.messages.slice(0, -1));
      let session = [...sessions].find((s) => s.usable && s.config === config && s.historyKey === priorKey);
      let content: Anthropic.ContentBlockParam[];
      if (session) {
        content = toCliContent(last.content, session.toolNames);
      } else {
        const s: Session = new Session(
          spawnCli(cliArgs({ model: req.model, system, schema, effort })),
          config,
          options.idleMs ?? 60_000,
          () => sessions.delete(s),
          options.onRetry,
        );
        sessions.add(s);
        session = s;
        // 새 프로세스에는 대화 전체를 보낸다
        content = req.messages.length === 1 ? toCliContent(last.content, s.toolNames) : transcript(req.messages);
      }

      const timeout = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
      const turn = (c: Anthropic.ContentBlockParam[]) =>
        session.turn(c, timeout).catch((e: unknown) => {
          // 버전 미달로 거절되면 그 버전을 기억해, 표가 낡았어도 다음 시작 전 점검에서 막는다
          if (e instanceof ClaudeCodeSetupError && e.requiredVersion) learnMinVersion(req.model, e.requiredVersion);
          throw e;
        });
      // 응답이 없으면 다시 묻지 않는다 — 그 케이스는 사유와 함께 Blocked로 넘어간다
      let r = await turn(content);
      let blocks: Anthropic.ContentBlock[];
      try {
        blocks = toBlocks(kind, r, session.toolNames);
      } catch (e) {
        if (kind !== 'tools' || !(e instanceof LlmOutputError)) throw e;
        // 형식이 틀리면 같은 세션에서 한 번 다시 묻는다
        const again = await turn([
          { type: 'text', text: `응답 형식 오류: ${e.message}. 정해진 형식의 JSON 객체 하나만 다시 답한다.` },
        ]);
        r = { ...again, usage: addUsage(r.usage, again.usage) };
        blocks = toBlocks(kind, r, session.toolNames);
      }
      session.historyKey = canonicalJson([...req.messages, { role: 'assistant', content: blocks }]);
      return message(req.model, blocks, r);
    },
    close() {
      for (const s of sessions) s.close();
    },
  };
}

class Session {
  historyKey = '';
  /** 우리가 만든 tool_use id → 도구 이름 (tool_result를 글로 옮길 때 쓴다) */
  readonly toolNames = new Map<string, string>();
  private busy = false;
  private dead = false;
  private idle?: NodeJS.Timeout;
  private waiting?: { resolve: (r: CliResult) => void; reject: (e: Error) => void };
  /** 이번 턴에 Claude Code가 마지막으로 보낸 재시도 알림 */
  private retry?: LlmRetry;
  /** 이번 턴에 Claude Code가 보낸 한도 알림 (`rate_limit_event`). 막혔으면 풀리는 시각을 여기서 읽는다 */
  private limit?: RateLimitInfo;

  constructor(
    private readonly proc: CliProcess,
    readonly config: string,
    private readonly idleMs: number,
    private readonly onClose: () => void,
    private readonly onRetry?: (r: LlmRetry) => void,
  ) {
    proc.onMessage((m) => {
      if (m.type === 'result') this.settle((w) => w.resolve(m as unknown as CliResult));
      else if (m.type === 'rate_limit_event') this.limit = m.rate_limit_info as RateLimitInfo | undefined;
      else if (m.type === 'system' && m.subtype === 'api_retry') {
        this.retry = parseRetry(m);
        this.onRetry?.(this.retry);
      }
    });
    proc.onExit((e) => {
      this.dead = true;
      this.onClose();
      this.settle((w) => w.reject(e ?? new LlmOutputError('Claude Code가 응답 없이 종료됐습니다')));
    });
  }

  get usable() {
    return !this.busy && !this.dead;
  }

  async turn(content: Anthropic.ContentBlockParam[], timeoutMs: number): Promise<CliResult> {
    clearTimeout(this.idle);
    this.busy = true;
    this.retry = undefined;
    this.limit = undefined;
    try {
      const result = new Promise<CliResult>((resolve, reject) => (this.waiting = { resolve, reject }));
      const timer = setTimeout(
        () =>
          this.settle((w) =>
            w.reject(
              new LlmTimeoutError(
                this.retry
                  ? `이 PC의 Claude Code가 ${Math.round(timeoutMs / 1000)}초 동안 응답하지 않았습니다 — ${this.retry.reason}로 ${this.retry.attempt}번 다시 시도하는 중이었습니다`
                  : `이 PC의 Claude Code가 ${Math.round(timeoutMs / 1000)}초 동안 응답하지 않았습니다 (Claude Code·네트워크 상태를 확인하세요)`,
              ),
            ),
          ),
        timeoutMs,
      );
      this.proc.send({ type: 'user', message: { role: 'user', content } });
      const r = await result.finally(() => clearTimeout(timer));
      if (r.is_error) throw cliError(r, this.limit);
      return r;
    } catch (e) {
      this.close();
      throw e;
    } finally {
      this.busy = false;
      if (!this.dead) this.idle = setTimeout(() => this.close(), this.idleMs).unref();
    }
  }

  close() {
    clearTimeout(this.idle);
    if (this.dead) return;
    this.dead = true;
    this.onClose();
    this.proc.close();
  }

  private settle(fn: (w: NonNullable<Session['waiting']>) => void) {
    const w = this.waiting;
    this.waiting = undefined;
    if (w) fn(w);
  }
}

/** stream-json `system/api_retry` → LlmRetry */
export function parseRetry(m: Record<string, unknown>): LlmRetry {
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const status = num(m.error_status);
  return {
    attempt: num(m.attempt) ?? 1,
    maxRetries: num(m.max_retries) ?? 0,
    delayMs: num(m.retry_delay_ms) ?? 0,
    ...(status !== undefined ? { status } : {}),
    reason: retryReason(typeof m.error === 'string' ? m.error : '', status, Boolean(m.no_response)),
  };
}

/** 재시도 이유를 사람이 읽는 말로 */
export function retryReason(error: string, status?: number, noResponse = false): string {
  if (noResponse) return 'Claude 서버 응답 없음';
  if (status === 529 || /overload/i.test(error)) return 'Claude 서버 혼잡(529)';
  if (status === 429 || /rate.?limit/i.test(error)) return '요청 한도 초과(429)';
  if (status !== undefined && status >= 500) return `Claude 서버 오류(${status})`;
  if (/connect|network|timeout|ECONN|socket/i.test(error)) return '네트워크 연결 오류';
  return `API 오류${status ? `(${status})` : ''}${error ? ` ${error}` : ''}`;
}

/** 로그인·한도 오류는 Run을 멈춰야 하므로 따로 구분한다. 나머지는 응답 오류(→ Blocked) */
/**
 * stream-json의 `rate_limit_event.rate_limit_info` (공개 문서 아님. Claude Code 2.1.308 `-p` 출력에서 확인 — 턴마다 오고,
 * 평소에는 status `allowed`). 막혔으면 status가 rejected, resetsAt은 풀리는 시각(초)
 */
export type RateLimitInfo = { status?: string; resetsAt?: number | null; rateLimitType?: string | null };

export function cliError(r: CliResult, limit?: RateLimitInfo): Error {
  const text = r.result ?? '';
  if (/not logged in|\/login|invalid api key|oauth token/i.test(text)) {
    return new ClaudeCodeSetupError('not_logged_in', `Claude Code에 로그인되어 있지 않습니다: ${text}`);
  }
  // 새 모델은 Claude Code 최소 버전이 있다 (예: "does not support this model; version 2.1.280 or newer is required")
  if (/does not support this model|or newer is required|claude update/i.test(text)) {
    return new ClaudeCodeSetupError(
      'outdated',
      `Claude Code 업데이트가 필요합니다(터미널에서 claude update): ${text}`,
      /version (\d+(?:\.\d+)+) or newer/i.exec(text)?.[1],
    );
  }
  if (r.api_error_status === 429 || /usage limit|limit reached|hit your limit|rate.?limit/i.test(text)) {
    // 풀리는 시각은 구조화된 한도 알림을 먼저 보고, 없으면 오류 문구에서 읽는다
    const at =
      limit?.status === 'rejected' && typeof limit.resetsAt === 'number'
        ? new Date(limit.resetsAt * 1000).toISOString()
        : resetsAt(text);
    return new PlanLimitError(`Claude 플랜 사용 한도에 닿았습니다: ${text}`, at);
  }
  return new LlmOutputError(`Claude Code 오류: ${text || r.subtype}`);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * 한도 오류 문구의 풀리는 시각 (ISO). 읽지 못하면 undefined — 콘솔은 시각 없이 "한도 도달"로 보인다.
 * - 시각 표기: "resets 3pm", "Resets at 3:10 PM", "resets Nov 3 at 9am (Asia/Seoul)". 시간대가 없으면 이 PC의 시간대,
 *   날짜가 없으면 now 이후 가장 가까운 그 시각
 * - 옛 형식: "Claude AI usage limit reached|1793260800" (초 단위)
 */
export function resetsAt(text: string, now = new Date()): string | undefined {
  const sec = /\|(\d{10})\s*$/.exec(text)?.[1];
  if (sec) return new Date(Number(sec) * 1000).toISOString();
  const m =
    /resets?\s+(?:at\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([^)]+)\))?/i.exec(
      text,
    );
  if (!m) return undefined;
  const [, mon, day, hh, mm, ap, zone] = m;
  const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
  if (mon && month < 0) return undefined;
  const tz = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let today: { y: number; mo: number; d: number };
  try {
    today = wallDate(now, tz);
  } catch {
    return undefined; // 모르는 시간대
  }
  const hour = (Number(hh) % 12) + (ap!.toLowerCase() === 'p' ? 12 : 0);
  const at = (y: number, mo: number, d: number) => zonedTime(y, mo, d, hour, Number(mm ?? 0), tz);
  if (mon) {
    const t = at(today.y, month, Number(day));
    return new Date(t > now.getTime() ? t : at(today.y + 1, month, Number(day))).toISOString();
  }
  const t = at(today.y, today.mo, today.d);
  return new Date(t > now.getTime() ? t : t + 24 * 3600_000).toISOString();
}

/** 그 시간대에서 본 날짜 */
function wallDate(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day) };
}

/** 그 시간대의 벽시계 시각 → epoch ms */
function zonedTime(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
        .formatToParts(t)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - t;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

type ToolCalls = { thought: string; calls: { name: string; input: Record<string, unknown> }[] };

/** 도구 요청의 글 응답 → 호출 목록. 코드 블록·앞뒤 글은 걷어 낸다. 인자 내용은 호출하는 쪽이 Zod로 검증한다 */
export function parseToolCalls(text: string): ToolCalls {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LlmOutputError('응답이 JSON 객체가 아닙니다');
  }
  const o = raw as Partial<ToolCalls>;
  const ok =
    start >= 0 &&
    Array.isArray(o.calls) &&
    o.calls.every((c) => c && typeof c.name === 'string' && c.input !== null && typeof c.input === 'object');
  if (!ok) throw new LlmOutputError('calls는 {name, input} 객체의 배열이어야 합니다');
  return { thought: typeof o.thought === 'string' ? o.thought : '', calls: o.calls! };
}

const addUsage = (a: CliResult['usage'] = {}, b: CliResult['usage'] = {}): CliResult['usage'] => ({
  input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
  output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
});

let seq = 0;
const toolId = () => `toolu_cli_${Date.now().toString(36)}_${++seq}`;

function toBlocks(
  kind: 'tools' | 'json' | 'text',
  r: CliResult,
  toolNames: Map<string, string>,
): Anthropic.ContentBlock[] {
  const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
  if (kind === 'text') return [text(r.result ?? '')];
  if (kind === 'json') {
    if (r.structured_output === undefined) throw new LlmOutputError('Claude Code가 구조화 출력을 돌려주지 않았습니다');
    return [text(JSON.stringify(r.structured_output))];
  }
  const out = parseToolCalls(r.result ?? '');
  const blocks: Anthropic.ContentBlock[] = out.thought.trim() ? [text(out.thought.trim())] : [];
  for (const c of out.calls) {
    const id = toolId();
    toolNames.set(id, c.name);
    blocks.push({
      type: 'tool_use',
      id,
      name: c.name,
      input: c.input,
      caller: { type: 'direct' },
    } as Anthropic.ToolUseBlock);
  }
  return blocks;
}

function message(model: string, content: Anthropic.ContentBlock[], r: CliResult): LlmResponse {
  const u = r.usage ?? {};
  return {
    id: `msg_cli_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason:
      r.stop_reason === 'refusal' ? 'refusal' : content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
  } as LlmResponse;
}

const systemText = (s: LlmRequest['system']) => (typeof s === 'string' ? s : (s ?? []).map((b) => b.text).join('\n\n'));

type UserContent = Anthropic.MessageParam['content'];

/** user 메시지 내용 → CLI에 보낼 블록. tool_result는 어떤 호출의 결과인지 글로 붙인다 */
export function toCliContent(content: UserContent, toolNames: Map<string, string>): Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of content) {
    if (b.type === 'tool_result') {
      const name = toolNames.get(b.tool_use_id) ?? '도구';
      const head = `[${name} 결과${b.is_error ? ' · 오류' : ''}]`;
      if (typeof b.content === 'string' || !b.content)
        out.push({ type: 'text', text: `${head} ${b.content ?? ''}`.trim() });
      else {
        out.push({ type: 'text', text: head });
        out.push(...(b.content as Anthropic.ContentBlockParam[]));
      }
    } else if (b.type === 'text' || b.type === 'image') {
      out.push({
        type: b.type,
        ...(b.type === 'text' ? { text: b.text } : { source: b.source }),
      } as Anthropic.ContentBlockParam);
    }
  }
  return out;
}

/** 이어 붙일 세션이 없을 때: 지난 대화 전체를 user 메시지 하나로 옮긴다 */
function transcript(messages: LlmRequest['messages']): Anthropic.ContentBlockParam[] {
  const names = new Map<string, string>();
  const out: Anthropic.ContentBlockParam[] = [{ type: 'text', text: '[지금까지의 대화]' }];
  messages.forEach((m, i) => {
    const lastTurn = i === messages.length - 1;
    if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] =
        typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const parts = blocks.map((b) => {
        if (b.type === 'tool_use') {
          names.set(b.id, b.name);
          return `${b.name}(${JSON.stringify(b.input)})`;
        }
        return b.type === 'text' ? b.text : '';
      });
      out.push({ type: 'text', text: `[Agent] ${parts.filter(Boolean).join('\n')}` });
    } else {
      out.push({ type: 'text', text: lastTurn ? '[지금]' : '[사용자]' });
      out.push(...toCliContent(m.content, names));
    }
  });
  return out;
}

export function cliArgs(o: { model: string; system: string; schema?: unknown; effort?: string }): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    o.model,
    // 내장 도구(셸·파일 편집 등)·MCP·사용자/프로젝트 설정을 모두 끈다. 할 수 있는 일은 정해진 형식으로 답하는 것뿐
    '--tools',
    '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--system-prompt',
    o.system,
    ...(o.schema ? ['--json-schema', JSON.stringify(o.schema)] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

export type ClaudeCodeStatus = {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  /** claude.ai(플랜 로그인) · console(API 키) 등 */
  authMethod?: string;
  /** pro · max 등 */
  subscriptionType?: string;
  /** 점검한 모델들에 필요한 최소 버전보다 낮으면 그 버전 */
  requiredVersion?: string;
};


/** 실행 중 "version … or newer is required"로 알게 된 최소 버전 (이 프로세스 동안만. 업데이트하면 다음 점검에서 풀린다) */
const learned = new Map<string, string>();
export function learnMinVersion(model: string, version: string) {
  const known = learned.get(model);
  if (!known || compareVersions(version, known) > 0) learned.set(model, version);
}

/** 모델들을 부르는 데 필요한 Claude Code 최소 버전 (표와 실행 중 알게 된 값 중 높은 것) */
export function requiredClaudeCodeVersion(models: readonly string[]): string | undefined {
  const all = models.flatMap((m) => [CLAUDE_CODE_MIN_VERSION[m], learned.get(m)]).filter((v): v is string => !!v);
  return all.sort(compareVersions).at(-1);
}

const run = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(process.env.QCARD_CLAUDE_BIN ?? 'claude', args, { timeout: 15_000 }, (e, out) =>
      e ? reject(e) : resolve(out),
    ),
  );

/**
 * 설치·로그인·버전 상태. models를 주면 그 모델들에 필요한 버전보다 낮은지 본다.
 * 계정 식별 정보(이메일·조직)는 돌려주지 않는다
 */
export async function claudeCodeStatus(models: readonly string[] = []): Promise<ClaudeCodeStatus> {
  const version = await run(['--version']).catch(() => undefined);
  if (!version) return { installed: false, loggedIn: false };
  const auth = await run(['auth', 'status'])
    .then((out) => JSON.parse(out) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string })
    .catch(() => ({}) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string });
  const v = version.trim().split(' ')[0]!;
  const required = versionShortfall(v, models);
  return {
    installed: true,
    version: v,
    loggedIn: auth.loggedIn === true,
    authMethod: auth.authMethod,
    subscriptionType: auth.subscriptionType,
    ...(required ? { requiredVersion: required } : {}),
  };
}

/** 설치된 버전이 모델들에 필요한 버전보다 낮으면 필요한 버전. 버전을 모르면 판단하지 않는다 */
export function versionShortfall(version: string | undefined, models: readonly string[]): string | undefined {
  const required = requiredClaudeCodeVersion(models);
  return version && required && compareVersions(version, required) < 0 ? required : undefined;
}

/** claude-sonnet-5-5 → Sonnet 5.5 */
export const modelLabel = (model: string) =>
  model
    .replace(/^claude-/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-(\d+)$/, ' $1')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Run·생성 시작 전 점검. models는 그 작업이 부르는 모델(`MODELS_FOR`). 쓸 수 없으면 해결 방법을 담아 던진다 */
export async function assertClaudeCodeReady(models: readonly string[] = []): Promise<ClaudeCodeStatus> {
  const s = await claudeCodeStatus(models);
  const problem = claudeCodeProblem(s, models);
  if (problem) throw problem;
  return s;
}

/** 이미 읽은 상태로 점검한다. 쓸 수 없으면 해결 방법을 담은 오류, 쓸 수 있으면 undefined */
export function claudeCodeProblem(s: ClaudeCodeStatus, models: readonly string[]): ClaudeCodeSetupError | undefined {
  if (!s.installed) {
    return new ClaudeCodeSetupError(
      'not_installed',
      'Claude Code(claude)가 설치되어 있지 않습니다. https://claude.com/claude-code 에서 설치한 뒤 터미널에서 `claude`로 로그인하세요',
    );
  }
  const required = versionShortfall(s.version, models);
  if (required) {
    return new ClaudeCodeSetupError(
      'outdated',
      `Claude Code ${s.version}은(는) ${models.map(modelLabel).join('·')}를 지원하지 않습니다. ${required} 이상이 필요합니다 — 터미널에서 \`claude update\`를 실행하세요`,
      required,
    );
  }
  if (!s.loggedIn) {
    return new ClaudeCodeSetupError(
      'not_logged_in',
      'Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`를 실행해 로그인하세요',
    );
  }
  return undefined;
}

let workDir: string | undefined;

/** 실제 `claude` 프로세스. 저장소 밖의 빈 폴더에서 실행하고, API 키 환경변수는 넘기지 않는다(플랜으로 과금) */
export const spawnClaude: CliSpawn = (args) => {
  workDir ??= mkdtempSync(join(tmpdir(), 'qcard-claude-'));
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn(process.env.QCARD_CLAUDE_BIN ?? 'claude', args, {
    cwd: workDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // 유휴 세션이 스크립트 종료를 막지 않게 한다. 턴을 기다리는 동안에는 응답 타이머가 이벤트 루프를 붙잡는다.
  // 부모가 끝나면 stdin이 닫혀 claude도 끝난다
  child.unref();
  for (const s of [child.stdin, child.stdout, child.stderr]) (s as unknown as { unref?: () => void }).unref?.();
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
  const listeners: ((m: { type: string } & Record<string, unknown>) => void)[] = [];
  // QCARD_CLAUDE_DEBUG=<파일>: 주고받은 원본 줄을 남긴다 (스크린샷 base64가 들어가므로 커밋하지 않는 곳에)
  const debug = process.env.QCARD_CLAUDE_DEBUG;
  const trace = (dir: '>' | '<', line: string) => debug && appendFileSync(debug, `${dir} ${line}\n`);
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    trace('<', line);
    let m: { type: string } & Record<string, unknown>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    for (const cb of listeners) cb(m);
  });
  return {
    send: (m) => {
      const line = JSON.stringify(m);
      trace('>', line);
      child.stdin.write(line + '\n');
    },
    onMessage: (cb) => listeners.push(cb),
    onExit: (cb) => {
      child.on('error', (e: NodeJS.ErrnoException) =>
        cb(
          e.code === 'ENOENT'
            ? new ClaudeCodeSetupError('not_installed', 'Claude Code(claude)가 설치되어 있지 않습니다')
            : e,
        ),
      );
      child.on('exit', (code) =>
        cb(code ? new LlmOutputError(`Claude Code 종료 (코드 ${code}) ${stderr.trim()}`) : undefined),
      );
    },
    close: () => {
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    },
  };
};
