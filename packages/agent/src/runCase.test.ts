import { FakeDevice, type FakeScenario, type UiElement } from '@qcard/device';
import { onboardingScenario, qaDocV130 } from '@qcard/fixtures';
import { SecretVault, withSecretGuard } from '@qcard/llm';
import type { PrepFlow, TestCase } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { fakeClock, type AgentEnv } from './env';
import { ACCOUNT_SECRET, osBuildOf, runCase, type AccountIssue, type RunCaseInput } from './runCase';
import { scriptedLlm, toolUse } from './testing';

/*
 * 테스트 계정: 로그인 준비 플로우가 플레이스홀더로 입력하고 실제 값은 디바이스에만 가는지,
 * 로그인 실패·원복 실패를 호스트에 알리는지. 로그인 화면은 가상 앱(모아북)의 합성 화면이다.
 */

const APP = 'com.example.moabook';
const el = (resourceId: string, extra: Partial<UiElement> & { y: number }): UiElement => ({
  ref: '',
  resourceId,
  cls: 'android.widget.TextView',
  pkg: APP,
  bounds: { x: 40, y: extra.y, w: 1000, h: 120 },
  clickable: false,
  enabled: true,
  focused: false,
  scrollable: false,
  password: false,
  depth: 1,
  ...extra,
});
const input = (id: string, y: number, password = false) =>
  el(id, { y, cls: 'android.widget.EditText', clickable: true, password, desc: id });

function loginScenario(): FakeScenario {
  const base = onboardingScenario();
  const ok = (s: { values: Record<string, string> }) => s.values.pw_input === 'pw-1';
  return {
    info: base.info,
    appPackage: APP,
    launch: 'login',
    home: 'launcher',
    screens: {
      launcher: { tree: [el('launcher', { y: 0, text: '홈', pkg: 'com.android.launcher3' })] },
      login: {
        tree: [input('id_input', 300), input('pw_input', 500, true), el('login_btn', { y: 700, text: '로그인', clickable: true })],
      },
      error: { tree: [el('error', { y: 300, text: '아이디 또는 비밀번호가 올바르지 않습니다' })] },
      library: {
        tree: [el('title', { y: 200, text: '내 서재' }), el('mute_btn', { y: 400, text: '알림 끄기', clickable: true })],
      },
      muted: { tree: [el('title', { y: 200, text: '알림 꺼짐' })] },
    },
    transitions: [
      { from: 'login', on: { kind: 'tap', target: 'login_btn' }, to: 'library', when: ok },
      { from: 'login', on: { kind: 'tap', target: 'login_btn' }, to: 'error', when: (s) => !ok(s) },
      { from: 'library', on: { kind: 'tap', target: 'mute_btn' }, to: 'muted' },
    ],
  };
}

const FLOWS: PrepFlow[] = [
  { id: 'pf-login', name: '로그인', kind: 'login', check: '내 서재가 보인다', steps: ['로그인 ID 입력', '비밀번호 입력', '[로그인]'] },
  { id: 'pf-unmute', name: '알림 다시 켜기', kind: 'restore', check: '알림이 켜져 있다', steps: ['[알림 켜기]'] },
];

const testCase = (extra: Partial<TestCase> = {}): TestCase => ({
  ...qaDocV130.cases[0]!,
  tcId: 'TC-SET-007',
  title: '알림 끄기',
  prepFlowIds: ['pf-login'],
  cleanState: true,
  accountKind: '구독자',
  steps: [{ text: '[알림 끄기]', manual: false }],
  verificationPoints: [],
  ...extra,
});

/** 로그인 준비 플로우 응답: ID·비밀번호 입력 후 [로그인] */
const loginReplies = [
  [
    toolUse('input_text', { element_ref: 'id_input', text: 'qa.sub01@moabook.test', intent: 'ID', risk: null }),
  ],
  [
    toolUse('step_done', { case_step_index: 0, summary: 'ID 입력' }),
    toolUse('input_text', { element_ref: 'pw_input', text: '{{secret.password}}', intent: '비밀번호', risk: null }),
  ],
  [
    toolUse('step_done', { case_step_index: 1, summary: '비밀번호 입력' }),
    toolUse('tap', { element_ref: 'login_btn', intent: '로그인', risk: null }),
  ],
];
/** 로그인 성공 뒤 케이스 단계: [알림 끄기] */
const caseReplies = [
  [toolUse('step_done', { case_step_index: 2, summary: '로그인' })],
  [toolUse('tap', { element_ref: 'mute_btn', intent: '알림 끄기', risk: null })],
  [toolUse('step_done', { case_step_index: 0, summary: '알림 끔' })],
];

function setup(replies: Parameters<typeof scriptedLlm>[0], password = 'pw-1') {
  const device = new FakeDevice({ ...loginScenario(), start: 'launcher' });
  const vault = new SecretVault();
  vault.set(ACCOUNT_SECRET.password, password);
  const llm = scriptedLlm(replies);
  const env: AgentEnv = {
    device,
    // 실제 값이 요청에 섞이면 여기서 막힌다
    llm: withSecretGuard(llm.client, vault),
    vault,
    appPackage: APP,
    clock: fakeClock(),
    vision: false,
    saveScreenshot: async () => ({ kind: 'mock', screen: device.current }),
  };
  const issues: [AccountIssue, string][] = [];
  const runWith = (tc: TestCase, extra: Partial<RunCaseInput> = {}) =>
    runCase(env, {
      testCase: tc,
      prepFlows: FLOWS,
      deviceId: 'pixel8',
      account: { kind: '구독자', loginId: 'qa.sub01@moabook.test', totp: false },
      onAccountIssue: (i, d) => issues.push([i, d]),
      ...extra,
    });
  const run = (tc: TestCase) => runWith(tc);
  return { device, llm, issues, run, runWith };
}

describe('테스트 계정으로 실행', () => {
  it('Agent는 플레이스홀더로 입력하고, 실제 비밀번호는 디바이스에만 간다', async () => {
    const { device, llm, issues, run } = setup([...loginReplies, ...caseReplies]);
    const r = await run(testCase());
    expect(device.state.values.pw_input).toBe('pw-1');
    expect(device.current).toBe('muted');
    expect(issues).toEqual([]);
    expect(r.blockedReason).toBeUndefined();
    const sent = JSON.stringify(llm.requests);
    expect(sent).not.toContain('pw-1');
    // 계정 안내: 로그인 ID는 그대로, 비밀번호는 플레이스홀더
    expect(sent).toContain('테스트 계정(구독자): 로그인 ID qa.sub01@moabook.test, 비밀번호 {{secret.password}}');
  });

  it('앱이 계정 정보를 거절하면 로그인 실패로 Blocked하고 호스트에 알린다', async () => {
    const { device, issues, llm, run } = setup(
      [...loginReplies, [toolUse('give_up', { kind: 'prep_failed', reason: '비밀번호 오류 메시지' })]],
      'wrong',
    );
    const r = await run(testCase());
    expect(device.current).toBe('error');
    expect(r.verdict).toBe('blocked');
    expect(r.blockedReason).toMatch(/^로그인 실패: 준비 플로우 실패: 로그인/);
    expect(issues.map(([i]) => i)).toEqual(['login_failed']);
    // 로그인 플로우에서만 인증 거부를 구분하라고 알린다
    expect(JSON.stringify(llm.requests)).toContain('give_up(kind=prep_failed)');
  });

  it('계정 탓이 아닌 이유로 로그인 플로우가 멈추면 계정에 표시하지 않는다', async () => {
    const { issues, run } = setup([[toolUse('give_up', { kind: 'stuck', reason: 'ID 입력란을 찾지 못함' })]]);
    const r = await run(testCase());
    expect(r.verdict).toBe('blocked');
    expect(r.blockedReason).toMatch(/^준비 플로우 실패: 로그인 \(stuck: ID 입력란을 찾지 못함\)/);
    expect(issues.map(([i]) => i)).toEqual(['login_flow_failed']);
  });

  it('다른 계정이 남아 있을 수 있으면 클린 상태가 아니어도 앱 데이터를 초기화한다', async () => {
    const kept = setup([...loginReplies, ...caseReplies]);
    await kept.run(testCase({ cleanState: false }));
    expect(kept.device.log).toContain(`stop ${APP}`);
    expect(kept.device.log).not.toContain(`clear ${APP}`);

    const reset = setup([...loginReplies, ...caseReplies]);
    await reset.runWith(testCase({ cleanState: false }), { resetApp: true });
    expect(reset.device.log).toContain(`clear ${APP}`);
  });

  it('원복 플로우는 케이스 뒤에 돌고, 실패하면 판정은 그대로 두고 원복 실패를 알린다', async () => {
    // scriptedLlm은 받은 응답 목록을 비우므로 실행마다 새로 만든다
    const replies = () => [...loginReplies, ...caseReplies];
    const plain = await setup(replies()).run(testCase());
    const { llm, issues, run } = setup([...replies(), [toolUse('give_up', { kind: 'stuck', reason: '켜기 버튼 없음' })]]);
    const r = await run(testCase({ restoreFlowId: 'pf-unmute' }));
    expect(issues).toEqual([['restore_failed', '알림 다시 켜기: stuck: 켜기 버튼 없음']]);
    expect(r.verdict).toBe(plain.verdict);
    expect(r.steps.length).toBe(plain.steps.length);
    const last = JSON.stringify(llm.requests.at(-1));
    expect(last).toContain('알림 다시 켜기');
    expect(last).toContain('케이스가 바꾼 계정 상태를 되돌린다');
  });
});

describe('osBuildOf', () => {
  it('OS 메이저·빌드 번호·보안 패치를 한 줄로, 읽지 못한 값은 뺀다', () => {
    expect(osBuildOf({ osMajor: 15, build: 'AP3A.240905.015.A2', securityPatch: '2024-10-01' })).toBe(
      'Android 15 · AP3A.240905.015.A2 · 보안 패치 2024-10-01',
    );
    expect(osBuildOf({ osMajor: 14, securityPatch: '2024-03-01' })).toBe('Android 14 · 보안 패치 2024-03-01');
    expect(osBuildOf({ osMajor: 16 })).toBe('Android 16');
  });
});
