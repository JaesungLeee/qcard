import type Anthropic from '@anthropic-ai/sdk';
import {
  center,
  childLabels,
  DeviceDisconnectedError,
  DeviceError,
  EnvActionUnavailableError,
  findElement,
  UnsupportedInputError,
  type Point,
} from '@qcard/device';
import {
  assertUsable,
  cachedSystem,
  EXECUTOR_TOOLS,
  LimitExceededError,
  LlmOutputError,
  LlmRefusalError,
  MODELS,
  parseToolUse,
  toolUses,
} from '@qcard/llm';
import {
  DEFAULT_RUN_LIMITS,
  EXECUTOR_TOOL_INPUTS,
  maxTurnsFor,
  RISK_KIND_LABEL,
  type CaseStep,
  type ExecStep,
  type ExecutorToolInput,
} from '@qcard/shared';
import {
  clockOf,
  imageBlock,
  observationBlocks,
  observe,
  RunAbortedError,
  screenshotBlocker,
  thought,
  type AgentEnv,
  type Observation,
} from './env';
import {
  caseHasAuth,
  guardRisk,
  identityScreen,
  pickRisk,
  preApproved,
  riskLevel,
  targetOf,
  type RiskFinding,
} from './risk';

/*
 * Executor: 관찰 → LLM 판단(도구 호출) → 디바이스 액션을 반복해 케이스 단계를 수행한다 (F-EX-01·06·08·11·12).
 * 대화는 덧붙이기만 한다 — 도구·시스템 프롬프트·앞선 턴이 그대로여야 프롬프트 캐시와 thinking이 이어진다.
 */

export const EXECUTOR_SYSTEM = `너는 Android 앱 QA Executor다. QA 케이스의 단계를 순서대로 디바이스에서 수행한다.

- 매 턴 화면 관찰(접근성 트리, 가능하면 스크린샷)을 받는다. 요소는 트리의 번호(e12)나 resource-id로 가리킨다. 트리에 없는 요소만 tap_point를 쓴다.
- 스크린샷은 기본으로 오지 않는다. 트리로 알 수 없을 때만 view_screen으로 본다(글자 없는 아이콘, 이미지·배치, 트리가 비거나 화면과 안 맞아 보일 때).
- 한 턴에 디바이스 액션은 하나만 부른다. 결과 화면을 본 뒤 다음 액션을 정한다.
- 단계 하나를 끝내면 step_done(case_step_index)을 부른다. "화면을 확인한다"처럼 확인만 하는 단계는 액션 없이 step_done을 부른다.
- 기대 결과 판정은 하지 않는다. 기대와 다르게 보여도 단계를 수행할 수 있으면 진행한다.
- 스플래시·로딩처럼 화면이 바뀌는 중이면 wait로 기다린 뒤 진행한다. 확인만 하는 단계도 화면이 자리 잡은 뒤 step_done을 부른다.
- 사전조건이 아직 갖춰지지 않았으면 단계 전에 UI로 갖춘다(예: 입력돼 있어야 할 값 입력).
- 기대 결과는 이 케이스가 무엇을 확인하는지 알려 주는 참고다. 단계가 "~상황을 만든다"처럼 막연하면 그 결과를 확인할 수 있는 상황과 조작을 만든다(예: 유지되는지 보려면 먼저 값을 입력해 두고, 실패 처리를 보려면 실패 조건을 만든 뒤 해당 버튼을 누른다). 결과가 좋게 보이도록 단계에 없는 우회를 하지 않는다.
- 예상치 못한 팝업·권한 요청·키보드가 단계를 막으면 닫고 진행한다.
- 앱이 꺼지거나 크래시 대화상자가 보이면 give_up(kind=crash). 진행할 방법이 없으면 give_up(kind=stuck).
- 비밀값은 {{secret.이름}} 플레이스홀더 그대로 입력한다.
- tap·tap_point·input_text를 부를 때마다 결과를 따져 risk를 채운다: 실제 사람에게 닿는가, 돈이 움직이는가, 되돌릴 수 없는가, 대상 앱 밖인가, 계정·보안이 바뀌는가, 현실에서 일이 일어나는가, 본인인증·인증번호·실제 개인정보가 필요한가. 하나라도 그렇거나 결과를 모르겠으면 risk에 종류와 이유를 쓰고, 아니면 null. 위험 액션은 실행자가 승인해야 실행되거나 실행자가 직접 한다.
- 본인인증·인증번호·소셜 로그인 화면에서는 아무것도 입력하지 않는다(risk=identity로 실행자에게 넘긴다).`;

type GiveUpKind = ExecutorToolInput<'give_up'>['kind'];

export type ExecOutcome = {
  status: 'done' | 'blocked' | 'fail';
  /** blocked·fail 사유 (F-EX-05) */
  reason?: string;
  /** Agent가 give_up으로 멈췄으면 그 종류 */
  gaveUp?: GiveUpKind;
  steps: ExecStep[];
  /** 끝낸 케이스 단계 수 */
  stepsDone: number;
  /** 디바이스 액션 실패 후 다시 시도한 횟수 (자가 복구) */
  recoveries: number;
  /** 실행자가 Take over·스텝 건너뛰기로 개입했는가 (F-RP-03 ③) */
  intervened: boolean;
  /** 마지막 액션 뒤의 화면 = 검증 시점 화면 */
  last: Observation;
  /** 마지막 단계를 수행하며 본 화면들 (토스트처럼 잠깐 뜨는 요소의 근거). 없으면 [last].
   *  끝 단계들이 기다리기·확인뿐이면 마지막으로 조작한 단계부터 (조작 뒤 뜬 토스트가 대기 단계에서 사라진다) */
  evidence: Observation[];
  /** 다음 관찰 번호 (스크린샷 이름이 겹치지 않게) */
  nextIndex: number;
};

export type RunStepsInput = {
  caseId: string;
  steps: CaseStep[];
  /** 케이스 제목·사전조건·데이터 */
  context: string;
  /** 최대 LLM 턴 (기본: 단계 수 × env.limits.turnsPerStep + extraTurns) */
  maxTurns?: number;
  /** 첫 관찰 번호. 준비 플로우와 본 단계가 이어서 매겨 스크린샷이 겹치지 않게 한다 */
  firstIndex?: number;
  /** 같은 화면 + 같은 액션 반복 한도 (기본 env.limits.repeatLimit) */
  repeatLimit?: number;
};

type ToolResult = Anthropic.ToolResultBlockParam;
type StepRisk = NonNullable<ExecStep['risk']>;
const stepRisk = (f: RiskFinding, decision: StepRisk['decision'], by?: string): StepRisk => ({
  kind: f.kind,
  level: riskLevel(f.kind),
  reason: f.reason,
  source: f.source,
  planned: decision === 'pre_approved',
  decision,
  ...(by ? { approvedBy: by } : {}),
});
const ok = (id: string, content: string): ToolResult => ({ type: 'tool_result', tool_use_id: id, content });
const err = (id: string, content: string): ToolResult => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  is_error: true,
});

export async function runSteps(env: AgentEnv, input: RunStepsInput): Promise<ExecOutcome> {
  const clock = clockOf(env);
  const start = clock.now();
  const { caseId, steps } = input;
  const limits = { ...DEFAULT_RUN_LIMITS, ...env.limits };
  const maxTurns = input.maxTurns ?? maxTurnsFor(limits, steps.length);
  const repeatLimit = input.repeatLimit ?? limits.repeatLimit;
  const info = await env.device.info();
  const timeline: ExecStep[] = [];
  const repeats = new Map<string, number>();
  let recoveries = 0;
  let nudges = 0;
  let pointer = 0;
  let obsIndex = input.firstIndex ?? 0;
  /** 단계 번호 → 그 단계에서 액션 뒤에 본 화면 */
  const seenByStep = new Map<number, Observation[]>();
  /** 기다리기 말고 디바이스를 조작한 단계 번호 */
  const operated = new Set<number>();
  const look = async () => {
    const o = await observe(env, caseId, obsIndex++);
    seenByStep.set(pointer, [...(seenByStep.get(pointer) ?? []), o]);
    return o;
  };
  let last = await observe(env, caseId, obsIndex++);
  thought(env, start, 'observe', `화면 관찰 · 요소 ${last.tree.length}개 · ${last.foreground ?? '?'}`);
  /** 인증 단계가 있는 케이스 — 인앱 웹뷰를 인증 화면으로 본다 (F-EX-10) */
  const withAuth = caseHasAuth(steps);

  const outcome = (status: ExecOutcome['status'], reason?: string, gaveUp?: GiveUpKind): ExecOutcome => {
    if (reason) thought(env, start, 'system', `${status === 'fail' ? 'Fail' : 'Blocked'}: ${reason}`);
    let from = steps.length - 1;
    while (from > 0 && !operated.has(from)) from--;
    if (!operated.has(from)) from = steps.length - 1;
    const seen = Array.from({ length: steps.length - from }, (_, i) => seenByStep.get(from + i) ?? []).flat();
    const evidence = seen.length ? seen : [last];
    return {
      status,
      reason,
      ...(gaveUp ? { gaveUp } : {}),
      steps: timeline,
      stepsDone: pointer,
      recoveries,
      intervened,
      last,
      evidence,
      nextIndex: obsIndex,
    };
  };
  // videoTs: Run 영상 시점 (ms)
  const record = (s: Omit<ExecStep, 'index' | 'videoTs' | 'caseStepIndex'>, at: number) => {
    const step: ExecStep = { ...s, index: timeline.length, videoTs: at - start, caseStepIndex: pointer };
    timeline.push(step);
    env.onStep?.(step);
  };
  const progress = () =>
    pointer < steps.length ? `진행: 단계 ${pointer} 수행 중 — "${steps[pointer]!.text}"` : '진행: 모든 단계 끝';

  /** 수동 스텝을 만나면 실행자를 기다린다. 메모는 다음 사용자 메시지에 붙인다 */
  const notes: string[] = [];
  async function handleManual(): Promise<string | undefined> {
    while (pointer < steps.length && steps[pointer]!.manual) {
      const step = steps[pointer]!;
      thought(env, start, 'system', `수동 스텝 대기: ${step.text}`);
      const at = clock.now();
      const before = last.screenshot;
      const answer = env.onManual ? await env.onManual(step.text) : 'timeout';
      if (answer === 'timeout') return step.risk === 'human' ? '사람 전용 단계 미수행' : '수동 스텝 타임아웃';
      last = await look();
      // 사람 전용 단계(본인인증 등): 인증 화면이 남아 있으면 LLM에 보내지 않고 다시 기다린다
      while (step.risk === 'human' && identityScreen(last, withAuth)) {
        const again = env.onManual ? await env.onManual(`인증 화면이 아직 보입니다 — ${step.text}`) : 'timeout';
        if (again === 'timeout') return '사람 전용 단계 미수행';
        last = await look();
      }
      record(
        {
          action: 'manual',
          intent: step.text,
          screenshot: before,
          durationMs: clock.now() - at,
          ...(step.risk === 'human'
            ? {
                risk: stepRisk({ kind: 'identity', reason: '사람 전용 단계', source: 'agent' }, 'took_over'),
              }
            : {}),
        },
        at,
      );
      notes.push(`단계 ${pointer}(수동)는 실행자가 직접 수행했다.`);
      pointer++;
    }
    return undefined;
  }

  /**
   * 실행자 제어 (F-DB-05). 턴 사이에 부른다: 일시정지·Take over면 풀릴 때까지 기다리고, Take over 뒤에는 화면을
   * 다시 관찰한다. 건너뛰기는 지금 단계를 끝난 것으로 넘긴다. 끝내야 하면 결과를 돌려준다
   */
  let intervened = false;
  async function control(): Promise<ExecOutcome | undefined> {
    if (!env.control) return undefined;
    const at = clock.now();
    const signal = await env.control.checkpoint();
    if (signal === 'continue') return undefined;
    if (signal === 'abort') throw new RunAbortedError('실행자가 Run을 중단했습니다');
    intervened = true;
    if (signal === 'took_over') {
      record(
        { action: 'takeover', intent: '실행자가 직접 조작', screenshot: last.screenshot, durationMs: clock.now() - at },
        at,
      );
      thought(env, start, 'system', 'Take over: 실행자가 조작한 뒤 Agent에 반환');
      notes.push('실행자가 Take over로 디바이스를 직접 조작한 뒤 돌려줬다. 지금 화면에서 이어 간다.');
    } else {
      const skipped = steps[pointer]!;
      record(
        {
          action: 'skip',
          intent: `단계 ${pointer} 건너뜀: ${skipped.text}`,
          screenshot: last.screenshot,
          durationMs: 0,
        },
        at,
      );
      thought(env, start, 'system', `실행자가 단계 ${pointer}를 건너뜀`);
      notes.push(`실행자가 단계 ${pointer}("${skipped.text}")를 건너뛰었다. 끝난 것으로 보고 다음 단계로 간다.`);
      pointer++;
      const manualFail = await handleManual();
      if (manualFail) return outcome('blocked', manualFail);
      if (pointer >= steps.length) return outcome('done');
    }
    last = await look();
    return undefined;
  }

  /**
   * 위험 액션을 실행자에게 묻는다. 승인 필요: [승인]이면 Agent가 실행, [직접 실행]이면 실행자가 하고 돌려준다.
   * 사람 전용: 실행자만 한다 — 돌려받은 화면에 인증이 남아 있으면 LLM에 보내지 않고 다시 기다린다
   */
  async function askRisk(
    f: RiskFinding,
    call: Parameters<typeof targetOf>[0],
  ): Promise<{ blocked: string } | { tookOver: true } | { by?: string }> {
    const level = riskLevel(f.kind);
    const el = targetOf(call, last.tree);
    const label = el ? (el.text ?? el.desc ?? el.resourceId ?? el.ref) : undefined;
    const action =
      call.name === 'input_text'
        ? `입력 · ${label ?? call.input.element_ref}`
        : call.name === 'tap_point'
          ? `탭 · (${call.input.x}, ${call.input.y})`
          : `탭 · ${label ?? call.input.element_ref}`;
    const target = el ? { label: label ?? el.ref, bounds: el.bounds } : undefined;
    thought(
      env,
      start,
      'system',
      `위험 액션(${RISK_KIND_LABEL[f.kind]}) ${action}: ${f.reason} — ${level === 'human' ? '실행자가 직접 해야 합니다' : '실행자 승인 대기'}`,
    );
    let reason = f.reason;
    for (;;) {
      const at = clock.now();
      const answer = env.onRisk
        ? await env.onRisk({ ...f, reason, level, action, ...(target ? { target } : {}) })
        : { decision: 'timeout' as const };
      if (answer.decision === 'timeout')
        return { blocked: `${level === 'human' ? '사람 전용 단계 미수행' : '위험 액션 미승인'}: ${f.reason}` };
      if (answer.decision === 'approved' && level === 'approval') {
        thought(env, start, 'system', `실행자 승인${answer.by ? ` (${answer.by})` : ''}: ${action}`);
        return { by: answer.by };
      }
      intervened = true;
      operated.add(pointer);
      record(
        {
          action: 'takeover',
          intent: `실행자가 직접 수행: ${f.reason}`,
          ...(target ? { target } : {}),
          screenshot: last.screenshot,
          durationMs: clock.now() - at,
          risk: stepRisk(f, 'took_over', answer.by),
        },
        at,
      );
      last = await look();
      if (level === 'human' && identityScreen(last, withAuth)) {
        reason = `인증 화면이 아직 보입니다 — ${f.reason}`;
        continue;
      }
      thought(env, start, 'system', `실행자가 직접 처리: ${action}`);
      notes.push(`실행자가 위험 액션(${action}: ${f.reason})을 직접 처리하고 돌려줬다. 지금 화면에서 이어 간다.`);
      return { tookOver: true };
    }
  }

  const manualFail = await handleManual();
  if (manualFail) return outcome('blocked', manualFail);
  if (pointer >= steps.length) return outcome('done');
  const first = await control();
  if (first) return first;

  const stepList = steps.map((s, i) => `${i}. ${s.manual ? '(수동) ' : ''}${s.text}`).join('\n');
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${input.context}\n\n단계:\n${stepList}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
        },
        ...observationBlocks(env, last, `[관찰 ${last.index}] ${progress()}`),
      ],
    },
  ];
  notes.length = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    let res: Anthropic.Message;
    try {
      res = await env.llm.create(
        {
          model: MODELS.executor,
          max_tokens: 4096,
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: cachedSystem(EXECUTOR_SYSTEM),
          tools: EXECUTOR_TOOLS,
          messages,
        },
        { role: 'executor', caseId },
      );
      assertUsable(res);
    } catch (e) {
      if (e instanceof LimitExceededError) return outcome('blocked', `실행 한도 초과: ${e.message}`);
      if (e instanceof LlmRefusalError || e instanceof LlmOutputError) return outcome('blocked', e.message);
      throw e;
    }
    messages.push({ role: 'assistant', content: res.content });
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) thought(env, start, 'decide', b.text.trim());

    const uses = toolUses(res);
    if (uses.length === 0) {
      if (++nudges > 2) return outcome('blocked', 'Agent가 도구를 부르지 않음');
      messages.push({ role: 'user', content: '도구를 불러 다음 단계를 진행하세요.' });
      continue;
    }

    const results: ToolResult[] = [];
    let acted = false;
    for (const use of uses) {
      if (pointer >= steps.length) {
        results.push(err(use.id, '모든 단계를 끝내 실행하지 않았습니다.'));
        continue;
      }
      let call;
      try {
        call = parseToolUse(use, EXECUTOR_TOOL_INPUTS);
      } catch (e) {
        results.push(err(use.id, (e as Error).message));
        continue;
      }
      if (call.name === 'give_up') {
        const reason = `${call.input.kind}: ${call.input.reason}`;
        return outcome(call.input.kind === 'crash' ? 'fail' : 'blocked', reason, call.input.kind);
      }
      if (call.name === 'view_screen') {
        const blocked = screenshotBlocker(env, last);
        thought(
          env,
          start,
          'observe',
          blocked ? `스크린샷 요청 거절: ${blocked}` : `스크린샷 확인: ${call.input.reason}`,
        );
        results.push(
          blocked
            ? err(use.id, blocked)
            : {
                type: 'tool_result',
                tool_use_id: use.id,
                content: [{ type: 'text', text: `[관찰 ${last.index}] 스크린샷` }, imageBlock(last)],
              },
        );
        continue;
      }
      if (call.name === 'step_done') {
        if (call.input.case_step_index !== pointer) {
          results.push(err(use.id, `지금은 단계 ${pointer} 차례입니다`));
          continue;
        }
        thought(env, start, 'decide', `단계 ${pointer} 완료: ${call.input.summary}`);
        pointer++;
        const manualFail = await handleManual();
        if (manualFail) return outcome('blocked', manualFail);
        results.push(ok(use.id, pointer >= steps.length ? '모든 단계를 끝냈습니다.' : `다음은 단계 ${pointer}입니다.`));
        continue;
      }
      if (acted) {
        results.push(err(use.id, '한 턴에 액션은 하나만 합니다. 결과 화면을 보고 다시 정하세요.'));
        continue;
      }
      // 실행자가 개입을 눌렀으면 Agent가 고른 액션은 실행하지 않는다 (사람이 조작하는 중에 누르지 않게)
      if (env.control?.interrupted()) {
        results.push(err(use.id, '실행자 개입으로 이 액션은 수행하지 않았습니다. 화면을 다시 보고 정하세요.'));
        continue;
      }
      acted = true;

      // 같은 화면에서 같은 액션 반복 감지 (F-EX-12)
      const sig = `${last.treeText}\n${JSON.stringify({ n: call.name, i: { ...call.input, intent: undefined } })}`;
      const seen = (repeats.get(sig) ?? 0) + 1;
      repeats.set(sig, seen);
      if (seen >= repeatLimit) return outcome('blocked', `실행 한도 초과: 같은 화면에서 같은 액션 ${seen}회 반복`);

      // 위험 액션 (F-EX-10): Agent 표시 + 코드 안전장치. 사전 승인이 아니면 실행자에게 묻는다
      let risk: StepRisk | undefined;
      if (call.name === 'tap' || call.name === 'tap_point' || call.name === 'input_text') {
        const marked = call.input.risk ? { ...call.input.risk, source: 'agent' as const } : undefined;
        const found = pickRisk(marked, guardRisk(call, last, { appPackage: env.appPackage, withAuth }));
        if (found && preApproved(found, steps[pointer])) {
          risk = stepRisk(found, 'pre_approved');
          thought(env, start, 'system', `위험 액션(${RISK_KIND_LABEL[found.kind]}) — 케이스에 계획돼 사전 승인`);
        } else if (found) {
          const asked = await askRisk(found, call);
          if ('blocked' in asked) return outcome('blocked', asked.blocked);
          if ('tookOver' in asked) {
            results.push(ok(use.id, '실행자가 이 액션을 직접 처리했습니다. 지금 화면을 보고 이어 가세요.'));
            continue;
          }
          risk = stepRisk(found, 'approved', asked.by);
        }
      }

      const at = clock.now();
      const before = last.screenshot;
      try {
        const step = await act(env, call, last, info.size);
        record({ ...step, ...(risk ? { risk } : {}), screenshot: before, durationMs: clock.now() - at }, at);
        if (call.name !== 'wait') operated.add(pointer);
        thought(env, start, 'act', `${call.name} · ${step.intent}`);
        await clock.sleep(env.settleMs ?? 500);
        last = await look();
        results.push(ok(use.id, '수행했습니다.'));
      } catch (e) {
        if (e instanceof EnvActionUnavailableError || e instanceof UnsupportedInputError) {
          return outcome('blocked', `환경 조작 불가: ${e.message}`);
        }
        // 연결이 끊기면 다시 해도 소용없다 — Run을 일시정지하게 올린다
        if (e instanceof DeviceDisconnectedError) throw e;
        if (!(e instanceof DeviceError || e instanceof ActionInputError)) throw e;
        recoveries++;
        thought(env, start, 'recover', `액션 실패: ${e.message}`);
        last = await look();
        results.push(err(use.id, `액션 실패: ${e.message}`));
      }
    }

    if (pointer >= steps.length) return outcome('done');
    const controlled = await control();
    if (controlled) return controlled;
    messages.push({
      role: 'user',
      content: [
        ...results,
        ...(notes.length ? [{ type: 'text' as const, text: notes.join('\n') }] : []),
        ...observationBlocks(env, last, `[관찰 ${last.index}] ${progress()}`),
      ],
    });
    notes.length = 0;
    thought(env, start, 'observe', `화면 관찰 · 요소 ${last.tree.length}개 · ${last.foreground ?? '?'}`);
  }
  return outcome('blocked', `실행 한도 초과: 최대 ${maxTurns}턴`);
}

/** 화면 가운데를 지나는 스와이프 선 (손가락이 움직이는 방향) */
function swipeLine(dir: 'up' | 'down' | 'left' | 'right', { w, h }: { w: number; h: number }): [Point, Point] {
  const a = (fx: number, fy: number): Point => [Math.round(w * fx), Math.round(h * fy)];
  if (dir === 'left') return [a(0.8, 0.5), a(0.2, 0.5)];
  if (dir === 'right') return [a(0.2, 0.5), a(0.8, 0.5)];
  if (dir === 'up') return [a(0.5, 0.75), a(0.5, 0.25)];
  return [a(0.5, 0.25), a(0.5, 0.75)];
}

/** 요소 참조가 트리에 없는 등 Agent 입력이 틀렸다 — 되돌려 주고 다시 정하게 한다 */
class ActionInputError extends Error {
  override name = 'ActionInputError';
}

type Call = ReturnType<typeof parseToolUse<typeof EXECUTOR_TOOL_INPUTS>>;

async function act(
  env: AgentEnv,
  call: Call,
  o: Observation,
  size: { w: number; h: number },
): Promise<Omit<ExecStep, 'index' | 'videoTs' | 'caseStepIndex' | 'screenshot' | 'durationMs'>> {
  const d = env.device;
  const resolve = (ref: string) => {
    const el = findElement(o.tree, ref);
    if (!el) throw new ActionInputError(`트리에 없는 요소: ${ref}`);
    return el;
  };
  const labels = childLabels(o.tree);
  // 키보드에 가려진 곳을 누르면 키보드 키가 눌린다 (실기기에서 저장 버튼 대신 스페이스가 눌림)
  const tapAt = async (x: number, y: number) => {
    const k = o.keyboard;
    if (k.shown && k.top !== undefined && y >= k.top) {
      throw new ActionInputError(`키보드가 (${x}, ${y})를 가립니다. press_key back으로 키보드를 먼저 닫으세요`);
    }
    await d.tap(x, y);
  };
  const target = (el: ReturnType<typeof resolve>) => ({
    label: el.text ?? el.desc ?? labels.get(el.ref) ?? el.resourceId ?? el.ref,
    elementId: el.resourceId,
    bounds: el.bounds,
  });
  switch (call.name) {
    case 'tap': {
      const el = resolve(call.input.element_ref);
      await tapAt(...center(el.bounds));
      return { action: 'tap', target: target(el), intent: call.input.intent };
    }
    case 'tap_point': {
      const { x, y } = call.input;
      await tapAt(x, y);
      return {
        action: 'tap',
        target: { label: `(${x}, ${y})`, bounds: { x: x - 30, y: y - 30, w: 60, h: 60 } },
        intent: call.input.intent,
      };
    }
    case 'input_text': {
      const el = resolve(call.input.element_ref);
      const value = env.vault ? env.vault.resolve(call.input.text) : call.input.text;
      await tapAt(...center(el.bounds));
      await d.inputText(value);
      // 타임라인에는 플레이스홀더 그대로 남긴다 (F-EX-09)
      return { action: 'input', target: target(el), input: call.input.text, intent: call.input.intent };
    }
    case 'swipe': {
      const [from, to] = swipeLine(call.input.direction, size);
      await d.swipe(from, to);
      return {
        action: 'swipe',
        swipe: { from: [from[0], from[1]], to: [to[0], to[1]] },
        intent: call.input.intent,
      };
    }
    case 'press_key': {
      await d.pressKey(call.input.key);
      return {
        action: call.input.key === 'home' ? 'home' : call.input.key === 'back' ? 'back' : 'input',
        intent: call.input.intent,
      };
    }
    case 'reopen_app':
      // 실행 중인 앱이면 종료하지 않고 앞으로 가져온다 (런처 아이콘을 누른 것과 같다)
      await d.launchApp(env.appPackage);
      return { action: 'reopen', intent: call.input.intent };
    case 'set_network': {
      if (!env.allowNetworkToggle) throw new ActionInputError('이 실행에서는 네트워크 조작이 허용되지 않습니다');
      const { wifi, data } = call.input;
      await d.setNetwork('wifi', wifi);
      await d.setNetwork('data', data);
      return {
        action: 'env',
        input: `Wi-Fi ${wifi ? '켬' : '끔'} · 데이터 ${data ? '켬' : '끔'}`,
        intent: call.input.intent,
      };
    }
    case 'restart_app':
      await d.stopApp(env.appPackage);
      await d.launchApp(env.appPackage);
      return { action: 'restart', intent: call.input.intent };
    case 'wait':
      await clockOf(env).sleep(call.input.seconds * 1000);
      return { action: 'wait', intent: call.input.intent };
    default:
      throw new ActionInputError(`액션이 아닌 도구: ${call.name}`);
  }
}
