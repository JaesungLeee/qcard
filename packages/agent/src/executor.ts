import type Anthropic from '@anthropic-ai/sdk';
import {
  center,
  childLabels,
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
import { EXECUTOR_TOOL_INPUTS, type CaseStep, type ExecStep } from '@qcard/shared';
import {
  clockOf,
  imageBlock,
  observationBlocks,
  observe,
  screenshotBlocker,
  thought,
  type AgentEnv,
  type Observation,
} from './env';

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
- 비밀값은 {{secret.이름}} 플레이스홀더 그대로 입력한다.`;

export type ExecOutcome = {
  status: 'done' | 'blocked' | 'fail';
  /** blocked·fail 사유 (F-EX-05) */
  reason?: string;
  steps: ExecStep[];
  /** 끝낸 케이스 단계 수 */
  stepsDone: number;
  /** 디바이스 액션 실패 후 다시 시도한 횟수 (자가 복구) */
  recoveries: number;
  /** 마지막 액션 뒤의 화면 = 검증 시점 화면 */
  last: Observation;
  /** 마지막 단계를 수행하며 본 화면들 (토스트처럼 잠깐 뜨는 요소의 근거). 없으면 [last] */
  evidence: Observation[];
  /** 다음 관찰 번호 (스크린샷 이름이 겹치지 않게) */
  nextIndex: number;
};

export type RunStepsInput = {
  caseId: string;
  steps: CaseStep[];
  /** 케이스 제목·사전조건·데이터 */
  context: string;
  /** 최대 LLM 턴 (기본: 단계 수 × 3 + 10) */
  maxTurns?: number;
  /** 첫 관찰 번호. 준비 플로우와 본 단계가 이어서 매겨 스크린샷이 겹치지 않게 한다 */
  firstIndex?: number;
  /** 같은 화면 + 같은 액션 반복 한도 (기본 3) */
  repeatLimit?: number;
};

type ToolResult = Anthropic.ToolResultBlockParam;
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
  const maxTurns = input.maxTurns ?? steps.length * 3 + 10;
  const repeatLimit = input.repeatLimit ?? 3;
  const info = await env.device.info();
  const timeline: ExecStep[] = [];
  const repeats = new Map<string, number>();
  let recoveries = 0;
  let nudges = 0;
  let pointer = 0;
  let obsIndex = input.firstIndex ?? 0;
  /** 단계 번호 → 그 단계에서 액션 뒤에 본 화면 */
  const seenByStep = new Map<number, Observation[]>();
  const look = async () => {
    const o = await observe(env, caseId, obsIndex++);
    seenByStep.set(pointer, [...(seenByStep.get(pointer) ?? []), o]);
    return o;
  };
  let last = await observe(env, caseId, obsIndex++);
  thought(env, start, 'observe', `화면 관찰 · 요소 ${last.tree.length}개 · ${last.foreground ?? '?'}`);

  const outcome = (status: ExecOutcome['status'], reason?: string): ExecOutcome => {
    if (reason) thought(env, start, 'system', `${status === 'fail' ? 'Fail' : 'Blocked'}: ${reason}`);
    const evidence = seenByStep.get(steps.length - 1) ?? [last];
    return { status, reason, steps: timeline, stepsDone: pointer, recoveries, last, evidence, nextIndex: obsIndex };
  };
  // videoTs: Run 영상 시점 (ms)
  const record = (s: Omit<ExecStep, 'index' | 'videoTs' | 'caseStepIndex'>, at: number) =>
    timeline.push({ ...s, index: timeline.length, videoTs: at - start, caseStepIndex: pointer });
  const progress = () =>
    pointer < steps.length ? `진행: 단계 ${pointer} 수행 중 — "${steps[pointer]!.text}"` : '진행: 모든 단계 끝';

  /** 수동 스텝을 만나면 실행자를 기다린다. 메모는 다음 사용자 메시지에 붙인다 */
  const notes: string[] = [];
  async function handleManual(): Promise<string | undefined> {
    while (pointer < steps.length && steps[pointer]!.manual) {
      const step = steps[pointer]!;
      thought(env, start, 'system', `수동 스텝 대기: ${step.text}`);
      const at = clock.now();
      const answer = env.onManual ? await env.onManual(step.text) : 'timeout';
      if (answer === 'timeout') return '수동 스텝 타임아웃';
      record({ action: 'manual', intent: step.text, screenshot: last.screenshot, durationMs: clock.now() - at }, at);
      notes.push(`단계 ${pointer}(수동)는 실행자가 직접 수행했다.`);
      last = await look();
      pointer++;
    }
    return undefined;
  }

  const manualFail = await handleManual();
  if (manualFail) return outcome('blocked', manualFail);
  if (pointer >= steps.length) return outcome('done');

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
        return outcome(call.input.kind === 'crash' ? 'fail' : 'blocked', reason);
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
      acted = true;

      // 같은 화면에서 같은 액션 반복 감지 (F-EX-12)
      const sig = `${last.treeText}\n${JSON.stringify({ n: call.name, i: { ...call.input, intent: undefined } })}`;
      const seen = (repeats.get(sig) ?? 0) + 1;
      repeats.set(sig, seen);
      if (seen >= repeatLimit) return outcome('blocked', `실행 한도 초과: 같은 화면에서 같은 액션 ${seen}회 반복`);

      const at = clock.now();
      const before = last.screenshot;
      try {
        const step = await act(env, call, last, info.size);
        record({ ...step, screenshot: before, durationMs: clock.now() - at }, at);
        thought(env, start, 'act', `${call.name} · ${step.intent}`);
        await clock.sleep(env.settleMs ?? 500);
        last = await look();
        results.push(ok(use.id, '수행했습니다.'));
      } catch (e) {
        if (e instanceof EnvActionUnavailableError || e instanceof UnsupportedInputError) {
          return outcome('blocked', `환경 조작 불가: ${e.message}`);
        }
        if (!(e instanceof DeviceError || e instanceof ActionInputError)) throw e;
        recoveries++;
        thought(env, start, 'recover', `액션 실패: ${e.message}`);
        last = await look();
        results.push(err(use.id, `액션 실패: ${e.message}`));
      }
    }

    if (pointer >= steps.length) return outcome('done');
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
