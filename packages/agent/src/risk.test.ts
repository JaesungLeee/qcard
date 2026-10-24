import { FakeDevice, type UiElement } from '@qcard/device';
import { onboardingScenario } from '@qcard/fixtures';
import { describe, expect, it } from 'vitest';
import { fakeClock, type AgentEnv, type Observation, type RiskAnswer, type RiskRequest } from './env';
import { runSteps } from './executor';
import { caseHasAuth, guardRisk, identityScreen, preApproved } from './risk';
import { scriptedLlm, toolUse } from './testing';

function setup(start: string, replies: Parameters<typeof scriptedLlm>[0], answer?: (r: RiskRequest) => RiskAnswer) {
  const device = new FakeDevice({ ...onboardingScenario(), start });
  const llm = scriptedLlm(replies);
  const asked: RiskRequest[] = [];
  const env: AgentEnv = {
    device,
    llm: llm.client,
    appPackage: 'com.example.harukong',
    clock: fakeClock(),
    vision: false,
    saveScreenshot: async () => ({ kind: 'mock', screen: device.current }),
    ...(answer
      ? {
          onRisk: async (r) => {
            asked.push(r);
            return answer(r);
          },
        }
      : {}),
  };
  return { device, llm, env, asked };
}

const step = (text: string, risk?: 'approval' | 'human') => ({
  text,
  manual: risk === 'human',
  ...(risk ? { risk } : {}),
});
const tapCopy = toolUse('tap', { element_ref: 'share_copy', intent: '공유 시트에서 복사', risk: null });
const done = (i: number) => toolUse('step_done', { case_step_index: i, summary: '' });

describe('위험 액션 (F-EX-10)', () => {
  it('Agent가 표시하지 않아도 앱 밖(공유 시트) 탭은 코드가 멈추고, 승인하면 그 액션을 실행한다', async () => {
    const { device, env, asked } = setup('share-sheet', [[tapCopy], [done(0)]], () => ({
      decision: 'approved',
      by: '이재성',
    }));
    const r = await runSteps(env, { caseId: 'TC-1', steps: [step('공유 시트에서 [복사]')], context: '' });
    expect(r.status).toBe('done');
    expect(asked).toEqual([
      expect.objectContaining({ kind: 'outside_app', level: 'approval', source: 'guard', action: '탭 · 복사' }),
    ]);
    expect(device.current).toBe('mate-toast');
    expect(r.steps[0]).toMatchObject({
      action: 'tap',
      risk: { kind: 'outside_app', level: 'approval', decision: 'approved', approvedBy: '이재성', planned: false },
    });
  });

  it('실행자가 없거나 응답하지 않으면 그 케이스는 Blocked', async () => {
    const none = setup('share-sheet', [[tapCopy]]);
    expect(await runSteps(none.env, { caseId: 'TC-1', steps: [step('[복사]')], context: '' })).toMatchObject({
      status: 'blocked',
      reason: expect.stringMatching(/^위험 액션 미승인: /),
    });
    expect(none.device.current).toBe('share-sheet');

    const late = setup('share-sheet', [[tapCopy]], () => ({ decision: 'timeout' }));
    expect((await runSteps(late.env, { caseId: 'TC-1', steps: [step('[복사]')], context: '' })).status).toBe('blocked');
  });

  it('[직접 실행]이면 Agent는 누르지 않고, 실행자가 한 뒤의 화면에서 이어 간다', async () => {
    const { device, llm, env } = setup('share-sheet', [[tapCopy], [done(0)]], () => {
      void device.tap(660, 1820); // 실행자가 폰에서 [복사]를 누른다
      return { decision: 'took_over', by: '이재성' };
    });
    const r = await runSteps(env, { caseId: 'TC-1', steps: [step('[복사]')], context: '' });
    expect(r).toMatchObject({ status: 'done', intervened: true });
    expect(r.steps.map((s) => [s.action, s.risk?.decision])).toEqual([['takeover', 'took_over']]);
    expect(device.log.filter((l) => l.startsWith('tap'))).toHaveLength(1);
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toContain('직접 처리하고 돌려줬다');
  });

  it('케이스에 계획된 단계는 사전 승인으로 넘기지만, 사람·돈에 닿는 액션은 계획돼 있어도 묻는다', async () => {
    const planned = toolUse('tap', {
      element_ref: 'mate_copy',
      intent: '초대 링크 복사',
      risk: { kind: 'irreversible', reason: '시험용' },
    });
    const a = setup('mate-invite', [[planned], [done(0)]], () => ({ decision: 'timeout' }));
    const r = await runSteps(a.env, { caseId: 'TC-1', steps: [step('[복사]', 'approval')], context: '' });
    expect(r.status).toBe('done');
    expect(a.asked).toEqual([]);
    expect(r.steps[0]!.risk).toMatchObject({ decision: 'pre_approved', planned: true, source: 'agent' });

    const send = toolUse('tap', {
      element_ref: 'mate_copy',
      intent: '초대 발송',
      risk: { kind: 'people', reason: '친구에게 초대가 간다' },
    });
    const b = setup('mate-invite', [[send]], () => ({ decision: 'timeout' }));
    await runSteps(b.env, { caseId: 'TC-1', steps: [step('초대를 보낸다', 'approval')], context: '' });
    expect(b.asked.map((x) => x.kind)).toEqual(['people']);
  });

  it('사람 전용(본인인증 등)은 승인으로 Agent가 실행하지 않는다 — 실행자가 직접 해야 넘어간다', async () => {
    const auth = toolUse('tap', {
      element_ref: 'mate_copy',
      intent: '인증 시작',
      risk: { kind: 'identity', reason: '휴대폰 본인인증' },
    });
    const { device, env, asked } = setup('mate-invite', [[auth], [done(0)]], () => ({ decision: 'approved' }));
    const r = await runSteps(env, { caseId: 'TC-1', steps: [step('본인인증을 한다')], context: '' });
    expect(asked[0]).toMatchObject({ level: 'human', kind: 'identity' });
    expect(device.log.filter((l) => l.startsWith('tap'))).toEqual([]);
    expect(r.steps[0]).toMatchObject({ action: 'takeover', risk: { level: 'human', decision: 'took_over' } });

    const late = setup('mate-invite', [[auth]], () => ({ decision: 'timeout' }));
    expect(await runSteps(late.env, { caseId: 'TC-1', steps: [step('본인인증을 한다')], context: '' })).toMatchObject({
      status: 'blocked',
      reason: '사람 전용 단계 미수행: 휴대폰 본인인증',
    });
  });
});

// ---------------------------------------------------------------- 코드 안전장치

const el = (p: Partial<UiElement> & { ref: string }): UiElement => ({
  cls: 'android.widget.Button',
  pkg: 'app',
  bounds: { x: 0, y: 0, w: 100, h: 100 },
  clickable: true,
  enabled: true,
  focused: false,
  scrollable: false,
  password: false,
  depth: 1,
  ...p,
});
const obs = (tree: UiElement[], foreground = 'app'): Observation => ({
  index: 0,
  tree,
  treeText: '',
  png: new Uint8Array(),
  foreground,
  keyboard: { shown: false },
  screenshot: { kind: 'url', url: 'x' },
});
const tap = (ref: string) => ({ name: 'tap' as const, input: { element_ref: ref } });
const ctx = { appPackage: 'app', withAuth: false };

describe('코드 안전장치', () => {
  it('버튼 글자로 결제·발송·삭제를 잡고, 평범한 버튼은 그냥 둔다', () => {
    const kinds = ['결제하기', '메시지 보내기', '회원 탈퇴', 'Delete', '저장', '다음', '공유'].map(
      (text) => guardRisk(tap('e1'), obs([el({ ref: 'e1', text })]), ctx)?.kind,
    );
    expect(kinds).toEqual(['money', 'people', 'irreversible', 'irreversible', undefined, undefined, undefined]);
  });

  it('민감한 권한(연락처·위치 등)의 허용만 멈추고, 알림 권한·거부는 그냥 둔다', () => {
    const dialog = (msg: string, button: string) =>
      obs(
        [el({ ref: 'e0', text: msg, clickable: false }), el({ ref: 'e1', text: button })],
        'com.google.android.permissioncontroller',
      );
    expect(guardRisk(tap('e1'), dialog('연락처에 액세스하도록 허용하시겠습니까?', '허용'), ctx)?.kind).toBe(
      'outside_app',
    );
    expect(guardRisk(tap('e1'), dialog('연락처에 액세스하도록 허용하시겠습니까?', '허용 안함'), ctx)).toBeUndefined();
    expect(guardRisk(tap('e1'), dialog('알림을 보내도록 허용하시겠습니까?', '허용'), ctx)).toBeUndefined();
  });

  it('비밀번호 칸에는 테스트 계정 비밀값만 넣고, 다른 값이면 사람 전용', () => {
    const o = obs([el({ ref: 'e1', cls: 'android.widget.EditText', password: true })]);
    const input = (text: string) => ({ name: 'input_text' as const, input: { element_ref: 'e1', text } });
    expect(guardRisk(input('{{secret.qa_password}}'), o, ctx)).toBeUndefined();
    expect(guardRisk(input('hunter2'), o, ctx)?.kind).toBe('identity');
  });

  it('본인인증 화면은 사람 전용. 웹뷰는 케이스에 인증 단계가 있을 때만 인증 화면으로 본다', () => {
    expect(
      guardRisk(tap('e1'), obs([el({ ref: 'e0', text: '휴대폰 본인인증' }), el({ ref: 'e1', text: '다음' })]), ctx)
        ?.kind,
    ).toBe('identity');
    const web = obs([el({ ref: 'e0', cls: 'android.webkit.WebView', clickable: false })]);
    expect(identityScreen(web, false)).toBe(false);
    expect(identityScreen(web, true)).toBe(true);
    expect(caseHasAuth([{ text: 'PASS 앱으로 본인인증을 진행한다', manual: true }])).toBe(true);
    expect(caseHasAuth([{ text: '닉네임을 입력한다', manual: false }])).toBe(false);
  });

  it('사전 승인은 승인 필요 등급의 계획된 단계만 (사람·돈·본인인증 제외)', () => {
    const f = (kind: 'irreversible' | 'people' | 'identity') => ({ kind, reason: '', source: 'agent' as const });
    const planned = { text: '', manual: false, risk: 'approval' as const };
    expect(preApproved(f('irreversible'), planned)).toBe(true);
    expect(preApproved(f('irreversible'), { text: '', manual: false })).toBe(false);
    expect(preApproved(f('people'), planned)).toBe(false);
    expect(preApproved(f('identity'), planned)).toBe(false);
  });
});
