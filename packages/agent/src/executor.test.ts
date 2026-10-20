import { FakeDevice } from '@qcard/device';
import { onboardingScenario } from '@qcard/fixtures';
import { SecretVault, UsageMeter, withSecretGuard, withUsage } from '@qcard/llm';
import { describe, expect, it } from 'vitest';
import { fakeClock, type AgentEnv } from './env';
import { runSteps } from './executor';
import { scriptedLlm, text, toolUse } from './testing';

function setup(start: string, replies: Parameters<typeof scriptedLlm>[0], extra: Partial<AgentEnv> = {}) {
  const device = new FakeDevice({ ...onboardingScenario(), start });
  const llm = scriptedLlm(replies);
  const env: AgentEnv = {
    device,
    llm: llm.client,
    appPackage: 'com.example.harukong',
    clock: fakeClock(),
    vision: false,
    saveScreenshot: async () => ({ kind: 'mock', screen: device.current }),
    ...extra,
  };
  return { device, llm, env };
}

const steps = (...t: string[]) => t.map((text) => ({ text, manual: false }));

describe('Executor 루프', () => {
  it('도구 호출대로 디바이스를 조작하고 스텝 타임라인을 남긴다', async () => {
    const { device, llm, env } = setup('profile', [
      [
        text('닉네임부터 입력한다'),
        toolUse('input_text', { element_ref: 'profile_nickname', text: '콩콩이', intent: '닉네임 입력' }),
      ],
      [
        toolUse('step_done', { case_step_index: 0, summary: '입력함' }),
        toolUse('tap', { element_ref: 'e4', intent: '저장' }),
      ],
      [toolUse('step_done', { case_step_index: 1, summary: '저장함' })],
    ]);
    const thoughts: string[] = [];
    const r = await runSteps(
      { ...env, onThought: (t) => thoughts.push(`${t.kind}:${t.text}`) },
      { caseId: 'TC-1', steps: steps('닉네임 `콩콩이` 입력', '[저장]'), context: '케이스: 테스트' },
    );
    expect(r.status).toBe('done');
    expect(device.current).toBe('room-create');
    expect(r.steps.map((s) => [s.action, s.target?.elementId, s.caseStepIndex, s.screenshot])).toEqual([
      ['input', 'profile_nickname', 0, { kind: 'mock', screen: 'profile' }],
      ['tap', 'profile_save', 1, { kind: 'mock', screen: 'profile' }],
    ]);
    expect(r.steps[0]!.input).toBe('콩콩이');
    // 영상 시점은 ms (fakeClock: 액션 뒤 500ms 안정화 대기)
    expect(r.steps.map((s) => s.videoTs)).toEqual([0, 500]);
    expect(r.last.screenshot).toEqual({ kind: 'mock', screen: 'room-create' });
    expect(thoughts).toContain('decide:닉네임부터 입력한다');
    // 첫 요청: 케이스 맥락 + 단계 목록 + 관찰
    const first = JSON.stringify(llm.requests[0]!.messages[0]);
    expect(first).toContain('0. 닉네임 `콩콩이` 입력');
    expect(first).toContain('id=profile_save');
  });

  it('대화는 덧붙이기만 한다 (앞 턴이 그대로 남아 캐시 접두어가 유지된다)', async () => {
    const { llm, env } = setup('invite', [
      [toolUse('tap', { element_ref: 'invite_copy', intent: '복사' })],
      [toolUse('step_done', { case_step_index: 0, summary: '복사함' })],
    ]);
    await runSteps(env, { caseId: 'TC-1', steps: steps('[초대 링크 복사]'), context: '' });
    const [a, b] = llm.requests;
    expect(b!.messages.slice(0, a!.messages.length)).toEqual(a!.messages);
    expect(JSON.stringify(b!.system)).toBe(JSON.stringify(a!.system));
    expect(b!.tools).toEqual(a!.tools);
  });

  it('없는 요소·안 되는 탭은 에러로 돌려주고 다시 정하게 한다 (자가 복구)', async () => {
    const { llm, env } = setup('profile', [
      [toolUse('tap', { element_ref: 'e99', intent: '?' })],
      [toolUse('tap', { element_ref: 'profile_save', intent: '저장(닉네임 없음)' })],
      [toolUse('step_done', { case_step_index: 0, summary: '포기 안 함' })],
    ]);
    const r = await runSteps(env, { caseId: 'TC-1', steps: steps('화면 확인'), context: '' });
    expect(r.status).toBe('done');
    expect(r.recoveries).toBe(2);
    const second = llm.requests[1]!.messages.at(-1)!.content as {
      type: string;
      is_error?: boolean;
      content?: string;
    }[];
    expect(second[0]).toMatchObject({
      type: 'tool_result',
      is_error: true,
      content: '액션 실패: 트리에 없는 요소: e99',
    });
  });

  it('한 턴에 액션 두 개면 두 번째는 실행하지 않는다', async () => {
    const { device, env } = setup('invite', [
      [
        toolUse('tap', { element_ref: 'invite_copy', intent: '복사' }),
        toolUse('tap', { element_ref: 'invite_close', intent: '닫기' }),
      ],
      [toolUse('step_done', { case_step_index: 0, summary: '' })],
    ]);
    await runSteps(env, { caseId: 'TC-1', steps: steps('복사'), context: '' });
    expect(device.log.filter((l) => l.startsWith('tap'))).toHaveLength(1);
  });

  it('같은 화면 + 같은 액션 3회면 Blocked (F-EX-12)', async () => {
    const tapTitle = () => [toolUse('tap', { element_ref: 'profile_title', intent: '제목 탭' })];
    const { env } = setup('profile', [tapTitle(), tapTitle(), tapTitle()]);
    const r = await runSteps(env, { caseId: 'TC-1', steps: steps('x'), context: '' });
    expect(r).toMatchObject({ status: 'blocked', reason: expect.stringContaining('3회 반복') });
  });

  it('최대 턴을 넘으면 Blocked', async () => {
    const { env } = setup('profile', [
      [toolUse('wait', { seconds: 1, intent: '대기' })],
      [toolUse('wait', { seconds: 2, intent: '대기' })],
    ]);
    const r = await runSteps(env, { caseId: 'TC-1', steps: steps('x'), context: '', maxTurns: 2 });
    expect(r).toMatchObject({ status: 'blocked', reason: '실행 한도 초과: 최대 2턴' });
  });

  it('LLM 호출 한도에 닿으면 Blocked', async () => {
    const { env } = setup('profile', [
      [toolUse('wait', { seconds: 1, intent: '' })],
      [toolUse('wait', { seconds: 2, intent: '' })],
    ]);
    const r = await runSteps(
      { ...env, llm: withUsage(env.llm, new UsageMeter({ maxCallsPerCase: 1 })) },
      { caseId: 'TC-1', steps: steps('x'), context: '' },
    );
    expect(r.reason).toMatch(/^실행 한도 초과: 케이스 LLM 호출 한도/);
  });

  it('크래시는 Fail, 진행 불가는 Blocked', async () => {
    const crash = setup('profile', [[toolUse('give_up', { kind: 'crash', reason: '앱이 꺼짐' })]]);
    expect(await runSteps(crash.env, { caseId: 'TC-1', steps: steps('x'), context: '' })).toMatchObject({
      status: 'fail',
      reason: 'crash: 앱이 꺼짐',
    });
    const stuck = setup('profile', [[toolUse('give_up', { kind: 'stuck', reason: '버튼 없음' })]]);
    expect((await runSteps(stuck.env, { caseId: 'TC-1', steps: steps('x'), context: '' })).status).toBe('blocked');
  });

  it('도구를 안 부르면 두 번까지 재촉하고 그다음 Blocked', async () => {
    const { env } = setup('profile', [[text('음')], [text('음')], [text('음')]]);
    const r = await runSteps(env, { caseId: 'TC-1', steps: steps('x'), context: '' });
    expect(r).toMatchObject({ status: 'blocked', reason: 'Agent가 도구를 부르지 않음' });
  });

  it('수동 스텝은 실행자를 기다리고, 응답이 없으면 Blocked (F-EX-11)', async () => {
    const manual = [
      { text: '실제 기기에서 공유 대상을 고른다', manual: true },
      { text: '화면 확인', manual: false },
    ];
    const asked: string[] = [];
    const done = setup('invite', [[toolUse('step_done', { case_step_index: 1, summary: '' })]], {
      onManual: async (s) => {
        asked.push(s);
        return 'done';
      },
    });
    const r = await runSteps(done.env, { caseId: 'TC-1', steps: manual, context: '' });
    expect(r.status).toBe('done');
    expect(asked).toEqual(['실제 기기에서 공유 대상을 고른다']);
    expect(r.steps[0]).toMatchObject({ action: 'manual', caseStepIndex: 0 });
    expect(JSON.stringify(done.llm.requests[0]!.messages[0])).toContain('단계 0(수동)는 실행자가 직접 수행했다');

    const timeout = setup('invite', []);
    expect(await runSteps(timeout.env, { caseId: 'TC-1', steps: manual, context: '' })).toMatchObject({
      status: 'blocked',
      reason: '수동 스텝 타임아웃',
    });
  });

  it('기본은 트리만 보내고, view_screen을 부르면 그때 스크린샷을 보낸다 (F-EX-02)', async () => {
    const { llm, env } = setup(
      'profile',
      [
        [toolUse('view_screen', { reason: '아이콘 확인' })],
        [toolUse('step_done', { case_step_index: 0, summary: '' })],
      ],
      { vision: true },
    );
    const r = await runSteps(env, { caseId: 'TC-1', steps: steps('확인'), context: '' });
    expect(r.status).toBe('done');
    expect(JSON.stringify(llm.requests[0]!.messages)).not.toContain('"type":"image"');
    const reply = llm.requests[1]!.messages.at(-1)!.content as { type: string; content?: { type: string }[] }[];
    expect(reply[0]).toMatchObject({ type: 'tool_result' });
    expect(reply[0]!.content!.map((b) => b.type)).toEqual(['text', 'image']);
    expect(r.steps).toEqual([]); // 디바이스 액션이 아니다
  });

  it('대상 앱 밖이거나 비전이 꺼져 있으면 view_screen은 거절한다 (개인 기기 보호)', async () => {
    for (const [start, vision, msg] of [
      ['launcher', true, '대상 앱 밖 화면이라'],
      ['profile', false, '스크린샷을 쓰지 않습니다'],
    ] as const) {
      const { llm, env } = setup(
        start,
        [[toolUse('view_screen', { reason: '?' })], [toolUse('step_done', { case_step_index: 0, summary: '' })]],
        { vision },
      );
      await runSteps(env, { caseId: 'TC-1', steps: steps('확인'), context: '' });
      const sent = JSON.stringify(llm.requests[1]!.messages);
      expect(sent).not.toContain('"type":"image"');
      expect(sent).toContain(msg);
    }
  });

  it('매 턴 스크린샷 모드에서도 앱 밖 화면은 이미지를 빼고 이유를 적는다', async () => {
    const out = setup('launcher', [[toolUse('step_done', { case_step_index: 0, summary: '' })]], {
      vision: true,
      screenshotEveryTurn: true,
    });
    await runSteps(out.env, { caseId: 'TC-1', steps: steps('확인'), context: '' });
    const first = JSON.stringify(out.llm.requests[0]!.messages[0]);
    expect(first).not.toContain('"type":"image"');
    expect(first).toContain('대상 앱 밖 화면이라 스크린샷을 보내지 않습니다');
    const inApp = setup('profile', [[toolUse('step_done', { case_step_index: 0, summary: '' })]], {
      vision: true,
      screenshotEveryTurn: true,
    });
    await runSteps(inApp.env, { caseId: 'TC-1', steps: steps('확인'), context: '' });
    expect(JSON.stringify(inApp.llm.requests[0]!.messages[0])).toContain('"type":"image"');
  });

  it('키보드가 가린 버튼은 누르지 않고 키보드를 먼저 닫게 한다', async () => {
    const device = new FakeDevice({ ...onboardingScenario(), start: 'profile', keyboardOnFocus: { top: 1300 } });
    const llm = scriptedLlm([
      [toolUse('input_text', { element_ref: 'profile_nickname', text: '콩콩이', intent: '입력' })],
      [toolUse('tap', { element_ref: 'profile_save', intent: '저장' })],
      [toolUse('press_key', { key: 'back', intent: '키보드 닫기' })],
      [toolUse('tap', { element_ref: 'profile_save', intent: '저장' })],
      [toolUse('step_done', { case_step_index: 0, summary: '' })],
    ]);
    const r = await runSteps(
      { device, llm: llm.client, appPackage: 'com.example.harukong', clock: fakeClock(), vision: false },
      { caseId: 'TC-1', steps: steps('닉네임 입력 후 저장'), context: '' },
    );
    expect(r.status).toBe('done');
    expect(device.current).toBe('room-create');
    expect(r.recoveries).toBe(1);
    const afterInput = JSON.stringify(llm.requests[1]!.messages.at(-1));
    expect(afterInput).toContain('키보드: 표시 중 — y=1300 아래 요소는 가려져 있다');
    expect(JSON.stringify(llm.requests[2]!.messages.at(-1))).toContain('키보드가 (540, 2240)를 가립니다');
  });

  it('비밀값은 디바이스에만 실제 값, LLM·타임라인에는 플레이스홀더 (F-EX-09)', async () => {
    const vault = new SecretVault();
    vault.set('nick', '비밀닉네임');
    const { device, llm, env } = setup('profile', [
      [toolUse('input_text', { element_ref: 'profile_nickname', text: '{{secret.nick}}', intent: '입력' })],
      [toolUse('step_done', { case_step_index: 0, summary: '' })],
    ]);
    // 입력 뒤 트리에 실제 값이 보이지만, LLM에 갈 관찰 텍스트는 가려진다
    const r = await runSteps(
      { ...env, vault, llm: withSecretGuard(env.llm, vault) },
      { caseId: 'TC-1', steps: steps('입력'), context: '' },
    );
    expect(device.state.values.profile_nickname).toBe('비밀닉네임');
    expect(r.steps[0]!.input).toBe('{{secret.nick}}');
    expect(JSON.stringify(llm.requests)).not.toContain('비밀닉네임');
  });
});
