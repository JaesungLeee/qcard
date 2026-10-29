import { FakeDevice, type UiElement } from '@qcard/device';
import { onboardingScenario, PREP_FLOWS, qaDocV130 } from '@qcard/fixtures';
import { ClaudeCodeSetupError, PlanLimitError } from '@qcard/llm';
import type { PointResult, TestCase, VerificationPoint } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { fakeClock, observe, type AgentEnv } from './env';
import { judge } from './judge';
import { runCase } from './runCase';
import { json, scriptedLlm, toolUse } from './testing';
import { compareTree, settle, verifyPoints } from './verify';

const point = (compare: VerificationPoint['compare'], expected = '', method: 'tree' | 'vision' = 'tree') => ({
  id: 'P1',
  target: '대상',
  compare,
  expected,
  method,
});
const el = (over: Partial<UiElement> = {}): UiElement => ({
  ref: 'e1',
  resourceId: 'x',
  cls: 'android.widget.Button',
  bounds: { x: 0, y: 0, w: 126, h: 126 },
  clickable: true,
  enabled: true,
  focused: false,
  scrollable: false,
  password: false,
  depth: 0,
  ...over,
});

describe('트리 포인트 코드 비교', () => {
  it('표시·비표시·화면', () => {
    expect(compareTree(point('visible'), el(), 420).result).toBe('match');
    expect(compareTree(point('visible'), undefined, 420).result).toBe('mismatch');
    expect(compareTree(point('screen'), el(), 420).result).toBe('match');
    expect(compareTree(point('not_visible'), undefined, 420).result).toBe('match');
    expect(compareTree(point('not_visible'), el(), 420).result).toBe('mismatch');
  });

  it('앱 상태는 화면에 근거가 없으면 불일치가 아니라 판단불가', () => {
    expect(compareTree(point('state'), undefined, 420).result).toBe('unknown');
  });

  it('앱 상태는 요소가 있기만 해서는 일치가 아니다 — 기대 텍스트가 있으면 비교한다', () => {
    expect(compareTree(point('state', '온보딩이 완료로 기록된다'), el(), 420).result).toBe('unknown');
    const p = point('state', '스텝 표시가 "2/4"다');
    expect(compareTree(p, el({ text: '2/4' }), 420).result).toBe('match');
    expect(compareTree(p, el({ text: '1/4' }), 420).result).toBe('mismatch');
  });

  it('개수: 같은 id(없으면 같은 부모·클래스·크기)의 요소를 센다', () => {
    const dots = [0, 1, 2, 3, 4].map((i) =>
      el({ ref: `e${i + 2}`, resourceId: undefined, cls: 'android.view.View', parent: 'e1' }),
    );
    const tree = [el({ ref: 'e1', resourceId: undefined, cls: 'android.view.View' }), ...dots];
    expect(compareTree(point('count', '5'), dots[0], 420, tree)).toMatchObject({
      result: 'match',
      observed: expect.stringContaining('5개'),
    });
    expect(compareTree(point('count', '4개'), dots[0], 420, tree).result).toBe('mismatch');
    // 적게 셌으면 판단불가: 선택된 dot처럼 그림으로만 그린 요소는 트리에 없다 (실기기 SM-S711N 사용법 안내 dot 5개 중 4개만 트리에 있음)
    expect(compareTree(point('count', '5'), dots[0], 420, tree.slice(0, 5)).result).toBe('unknown');
    expect(compareTree(point('count', '1'), undefined, 420).result).toBe('unknown');
    const items = [el({ ref: 'e1' }), el({ ref: 'e2' }), el({ ref: 'e3', resourceId: 'other' })];
    expect(compareTree(point('count', '2'), items[0], 420, items).result).toBe('match');
    // 없음은 0개
    expect(compareTree(point('count', '0'), undefined, 420).result).toBe('match');
    expect(compareTree(point('count', '0'), el(), 420).result).toBe('mismatch');
    expect(compareTree(point('count', '몇 개'), el(), 420).result).toBe('unknown');
  });

  it('텍스트 존재: 따옴표·백틱 안의 텍스트를 비교한다', () => {
    const p = point('text_exists', '`함께할 메이트를 불러볼까요?`가 보인다');
    expect(compareTree(p, el({ text: '함께할 메이트를 불러볼까요?' }), 420).result).toBe('match');
    expect(compareTree(p, el({ text: '메이트 초대' }), 420).result).toBe('mismatch');
  });

  it('크기(dp): 짧은 변이 기대값 이상이면 일치 (126px @420dpi = 48dp)', () => {
    expect(compareTree(point('size_dp', '48dp 이상'), el(), 420).result).toBe('match');
    expect(compareTree(point('size_dp', '56dp 이상'), el(), 420)).toMatchObject({
      result: 'mismatch',
      observed: expect.stringContaining('48.0×48.0dp'),
    });
  });
});

describe('verifyPoints', () => {
  async function at(start: string) {
    const device = new FakeDevice({ ...onboardingScenario(), start });
    const env = { device, appPackage: 'com.example.harukong', vision: false } as Omit<AgentEnv, 'llm'>;
    return { device, env, obs: await observe({ ...env, llm: scriptedLlm([]).client }, 'TC', 0) };
  }

  it('트리 포인트는 한 번에 찾고, 비교는 코드가 한다', async () => {
    const { env, obs } = await at('today');
    const llm = scriptedLlm([
      json({
        points: [
          { point_id: 'P1', status: 'found', element_ref: 'bottom_nav', reason: '하단 탭' },
          { point_id: 'P2', status: 'absent', element_ref: null, reason: '없음' },
          { point_id: 'P3', status: 'found', element_ref: 'e99', reason: '착각' },
          { point_id: 'P5', status: 'unclear', element_ref: null, reason: '화면에 안 나타남' },
        ],
      }),
    ]);
    const points = [
      { ...point('visible'), id: 'P1' },
      { ...point('not_visible'), id: 'P2' },
      { ...point('visible'), id: 'P3' },
      { ...point('visible'), id: 'P4' },
      { ...point('visible'), id: 'P5' },
    ];
    const r = await verifyPoints({ ...env, llm: llm.client }, { caseId: 'TC', points, evidence: [obs] });
    expect(r.map((p) => [p.pointId, p.result, p.targetElement])).toEqual([
      ['P1', 'match', 'bottom_nav'],
      ['P2', 'match', undefined],
      ['P3', 'unknown', undefined],
      ['P4', 'unknown', undefined],
      ['P5', 'unknown', undefined],
    ]);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.output_config?.format).toMatchObject({ type: 'json_schema' });
  });

  it('비전 포인트는 Verifier 판정을 그대로 쓴다', async () => {
    const { env, obs } = await at('nickname');
    const llm = scriptedLlm([
      json({
        points: [{ point_id: 'P1', result: 'mismatch', observed: '잘림', reason: '말줄임', target_element: 'e3' }],
      }),
    ]);
    const [r] = await verifyPoints(
      { ...env, llm: llm.client },
      { caseId: 'TC', points: [point('visible', '안내 문구가 한 줄로 보인다', 'vision')], evidence: [obs] },
    );
    expect(r).toMatchObject({
      result: 'mismatch',
      observed: '잘림',
      targetElement: 'nickname_helper',
      method: 'vision',
    });
  });
});

describe('잠깐 뜨는 요소와 화면 안정화', () => {
  it('표시 포인트는 앞선 관찰(토스트가 뜬 화면)을 근거로 삼고, 비표시·화면은 마지막 관찰만 인정한다', async () => {
    const device = new FakeDevice({ ...onboardingScenario(), start: 'mate-toast' });
    const env = { device, appPackage: 'com.example.harukong', vision: false, clock: fakeClock() };
    const withToast = await observe({ ...env, llm: scriptedLlm([]).client }, 'TC', 3);
    const evidence = await settle(
      { ...env, llm: scriptedLlm([]).client },
      { caseId: 'TC', evidence: [withToast], nextIndex: 4 },
    );
    // 토스트는 다음 관찰에서 사라지고, 그다음 화면은 그대로라 안정된다
    expect(evidence.map((o) => [o.index, o.tree.some((e) => e.resourceId === 'toast')])).toEqual([
      [3, true],
      [4, false],
    ]);
    const llm = scriptedLlm([
      json({
        points: [
          { point_id: 'T', status: 'found', element_ref: 'o3.e6', reason: '토스트' },
          { point_id: 'N', status: 'found', element_ref: 'o3.e6', reason: '앞 화면' },
        ],
      }),
    ]);
    const r = await verifyPoints(
      { ...env, llm: llm.client },
      {
        caseId: 'TC',
        evidence,
        points: [
          { ...point('visible'), id: 'T' },
          { ...point('not_visible'), id: 'N' },
        ],
      },
    );
    expect(r.map((p) => [p.pointId, p.result])).toEqual([
      ['T', 'match'],
      ['N', 'unknown'],
    ]);
    expect(JSON.stringify(llm.requests[0]!.messages)).toContain('[관찰 4] (마지막)');
    expect(JSON.stringify(llm.requests[0]!.messages)).toContain('o3.e6 Toast');
  });

  it('비전 포인트도 "보인다"류면 앞선 화면 스크린샷을 함께 보낸다', async () => {
    const device = new FakeDevice({ ...onboardingScenario(), start: 'mate-toast' });
    const env = { device, appPackage: 'com.example.harukong', vision: true, clock: fakeClock() };
    const withToast = await observe({ ...env, llm: scriptedLlm([]).client }, 'TC', 3);
    const evidence = await settle(
      { ...env, llm: scriptedLlm([]).client },
      { caseId: 'TC', evidence: [withToast], nextIndex: 4 },
    );
    const llm = scriptedLlm([
      json({
        points: [{ point_id: 'T', result: 'match', observed: '토스트', reason: '앞선 화면', target_element: null }],
      }),
    ]);
    const [r] = await verifyPoints(
      { ...env, llm: llm.client },
      { caseId: 'TC', evidence, points: [{ ...point('visible', '복사 완료 토스트가 뜬다', 'vision'), id: 'T' }] },
    );
    expect(r!.result).toBe('match');
    const content = llm.requests[0]!.messages[0]!.content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(content.map((b) => b.text ?? '').join('\n')).toMatch(/\[앞선 화면 · 관찰 3\][\s\S]*\[검증 시점 화면\]/);

    // 화면 비교뿐이면 검증 시점 화면만
    const only = scriptedLlm([
      json({ points: [{ point_id: 'S', result: 'match', observed: '', reason: '', target_element: null }] }),
    ]);
    await verifyPoints(
      { ...env, llm: only.client },
      { caseId: 'TC', evidence, points: [{ ...point('screen', '메이트 초대 스텝', 'vision'), id: 'S' }] },
    );
    const c2 = only.requests[0]!.messages[0]!.content as { type: string }[];
    expect(c2.filter((b) => b.type === 'image')).toHaveLength(1);
  });
});

describe('판정 집계 (F-EX-04, F-RP-03)', () => {
  const p = (result: PointResult['result'], method: 'tree' | 'vision' = 'tree') => ({ result, method }) as PointResult;
  const done = { status: 'done' as const, recoveries: 0 };

  it('모두 일치 + 트리만 → Pass 자동 확정', () => {
    expect(judge(done, [p('match'), p('match')])).toEqual({
      verdict: 'pass',
      agentVerdict: 'pass',
      unmet: [],
      autoConfirmed: true,
    });
  });

  it('비전 포인트가 있으면 Pass여도 확인필요로 둔다', () => {
    expect(judge(done, [p('match'), p('match', 'vision')])).toMatchObject({
      verdict: 'check',
      agentVerdict: 'pass',
      unmet: ['tree_only'],
    });
  });

  it('Take over·건너뛰기가 있었으면 Pass여도 확인필요로 둔다', () => {
    expect(judge({ ...done, intervened: true }, [p('match')])).toMatchObject({
      verdict: 'check',
      agentVerdict: 'pass',
      unmet: ['no_takeover'],
    });
  });

  it('불일치 → Fail, 판단불가 → 확인필요, 복구 한도 초과 → 미충족', () => {
    expect(judge(done, [p('match'), p('mismatch'), p('unknown')]).verdict).toBe('fail');
    expect(judge(done, [p('match'), p('unknown')]).verdict).toBe('check');
    expect(judge({ status: 'done', recoveries: 5 }, [p('match')])).toMatchObject({
      verdict: 'check',
      unmet: ['within_retry'],
    });
    expect(judge({ status: 'blocked', recoveries: 0 }, []).verdict).toBe('blocked');
    expect(judge({ status: 'fail', recoveries: 0 }, []).verdict).toBe('fail');
  });
});

describe('runCase', () => {
  const tc = (id: string) => qaDocV130.cases.find((c) => c.tcId === id)!;

  function env(replies: Parameters<typeof scriptedLlm>[0], start = 'launcher', connection: 'usb' | 'wifi' = 'usb') {
    const device = new FakeDevice({ ...onboardingScenario(connection), start });
    const llm = scriptedLlm(replies);
    const e: AgentEnv = { device, llm: llm.client, appPackage: 'com.example.harukong', clock: fakeClock(), vision: false };
    return { device, llm, env: e };
  }

  it('클린 케이스: 데이터 초기화 → 실행 → 단계 → 검증 → Pass', async () => {
    const { device, env: e } = env([
      [toolUse('wait', { seconds: 1, intent: '스플래시 대기' })],
      [toolUse('step_done', { case_step_index: 0, summary: '닉네임 화면' })],
      json({
        points: [
          {
            point_id: 'TC-ONBOARDING-001-P1',
            status: 'found',
            element_ref: 'nickname_title',
            reason: '제목',
          },
          { point_id: 'TC-ONBOARDING-001-P2', status: 'absent', element_ref: null, reason: '없음' },
        ],
      }),
    ]);
    const r = await runCase(e, { testCase: tc('TC-ONBOARDING-001'), prepFlows: PREP_FLOWS, deviceId: 'galaxy-s24-15' });
    expect(device.log.slice(0, 2)).toEqual(['clear com.example.harukong', 'launch com.example.harukong']);
    expect(r).toMatchObject({
      verdict: 'pass',
      autoConfirmed: true,
      decidedBy: { kind: 'agent' },
      osBuild: 'Android 15 · AP3A.240905.015.A2 · 보안 패치 2024-10-01',
    });
    expect(r.points.map((p) => p.result)).toEqual(['match', 'match']);
  });

  it('준비 플로우가 실패하면 Blocked', async () => {
    const { env: e } = env([[toolUse('give_up', { kind: 'stuck', reason: '저장 버튼 없음' })]]);
    const r = await runCase(e, { testCase: tc('TC-ONBOARDING-003'), prepFlows: PREP_FLOWS, deviceId: 'd' });
    expect(r).toMatchObject({ verdict: 'blocked', blockedReason: expect.stringContaining('준비 플로우 실패') });
  });

  it('LLM·디바이스 예외는 환경 오류 Blocked로 남긴다', async () => {
    const { env: e } = env([]);
    const r = await runCase(e, { testCase: tc('TC-ONBOARDING-001'), prepFlows: PREP_FLOWS, deviceId: 'd' });
    expect(r).toMatchObject({ verdict: 'blocked', blockedReason: expect.stringContaining('환경 오류') });
  });

  it('플랜 한도·Claude Code 로그인 오류는 판정하지 않고 던진다 (Run 일시정지)', async () => {
    for (const error of [new PlanLimitError('한도'), new ClaudeCodeSetupError('not_logged_in', '로그인')]) {
      const { env: e } = env([]);
      e.llm = { create: () => Promise.reject(error) };
      await expect(
        runCase(e, { testCase: tc('TC-ONBOARDING-001'), prepFlows: PREP_FLOWS, deviceId: 'd' }),
      ).rejects.toBe(error);
    }
  });

  it('Agent가 끈 네트워크는 케이스가 막혀도 끝날 때 다시 켠다', async () => {
    const { device, env: e } = env([
      [toolUse('wait', { seconds: 1, intent: '스플래시' })],
      [toolUse('set_network', { wifi: false, data: false, intent: '끊기' })],
      [toolUse('give_up', { kind: 'stuck', reason: '진행 불가' })],
    ]);
    const r = await runCase(
      { ...e, allowNetworkToggle: true },
      { testCase: tc('TC-ONBOARDING-001'), prepFlows: PREP_FLOWS, deviceId: 'd' },
    );
    expect(r.verdict).toBe('blocked');
    expect(device.state.network).toEqual({ wifi: true, data: true });
    expect(device.log.slice(-2)).toEqual(['network wifi on', 'network data on']);
  });

  it('Wi-Fi ADB 디바이스에서 네트워크를 끄는 케이스는 Blocked, 네트워크는 건드리지 않는다 (F-EX-16)', async () => {
    const { device, env: e } = env(
      [
        [toolUse('wait', { seconds: 1, intent: '스플래시' })],
        [toolUse('set_network', { wifi: true, data: false, intent: '데이터 끊기' })],
      ],
      'launcher',
      'wifi',
    );
    const r = await runCase(
      { ...e, allowNetworkToggle: true },
      { testCase: tc('TC-ONBOARDING-001'), prepFlows: PREP_FLOWS, deviceId: 'd' },
    );
    expect(r).toMatchObject({
      verdict: 'blocked',
      agentVerdict: 'blocked',
      blockedReason: expect.stringMatching(/^환경 조작 불가: Wi-Fi ADB/),
    });
    expect(device.log.some((l) => l.startsWith('network'))).toBe(false);
  });

  it('없는 준비 플로우를 가리키면 Blocked', async () => {
    const { env: e } = env([]);
    const bad = { ...tc('TC-ONBOARDING-001'), prepFlowIds: ['pf-ghost'] } as TestCase;
    expect((await runCase(e, { testCase: bad, prepFlows: PREP_FLOWS, deviceId: 'd' })).blockedReason).toBe(
      '준비 플로우 없음: pf-ghost',
    );
  });
});
