import { describe, expect, it } from 'vitest';
import {
  MANUAL_TIMEOUT_MS,
  VERIFY_MS,
  initialState,
  jumpState,
  makeScript,
  parseAt,
  reduce,
  stepAt,
  stepStart,
  verifiedCount,
  visibleThoughts,
  type PlaybackAction,
  type PlaybackState,
} from './playback';

// 스텝 1(1000) · 2(2000) · 3(수동, 0) — 수동 스텝 로그는 3000·3400에 나온다
const thoughts = [
  { at: 0, stepIndex: 1, kind: 'observe' as const, text: 'a' },
  { at: 500, stepIndex: 1, kind: 'act' as const, text: 'b' },
  { at: 1000, stepIndex: 2, kind: 'observe' as const, text: 'c' },
  { at: 1800, stepIndex: 2, kind: 'act' as const, text: 'd' },
  { at: 3000, stepIndex: 3, kind: 'observe' as const, text: 'e' },
  { at: 3400, stepIndex: 3, kind: 'system' as const, text: 'f' },
];
const script = makeScript(
  [
    { index: 1, durationMs: 1000 },
    { index: 2, durationMs: 2000 },
    { index: 3, durationMs: 0 },
  ],
  3,
  thoughts,
);
const run = (s: PlaybackState, ...actions: PlaybackAction[]) => actions.reduce((x, a) => reduce(script, x, a), s);
const tick = (dt: number): PlaybackAction => ({ type: 'tick', dt });

describe('script', () => {
  it('스텝 시작 시각과 현재 스텝을 계산한다', () => {
    expect(stepStart(script, 1)).toBe(0);
    expect(stepStart(script, 3)).toBe(3000);
    expect(script.haltAt).toBe(3400);
    expect(stepAt(script, 0)).toBe(1);
    expect(stepAt(script, 999)).toBe(1);
    expect(stepAt(script, 1000)).toBe(2);
    expect(stepAt(script, 3200)).toBe(3);
  });

  it('?at= 값을 읽는다', () => {
    expect(parseAt(null)).toBeUndefined();
    expect(parseAt('3')).toBe(3);
    expect(parseAt('end')).toBe('end');
    expect(parseAt('done')).toBe('done');
    expect(parseAt('0')).toBeUndefined();
    expect(parseAt('x')).toBeUndefined();
  });
});

describe('reduce', () => {
  it('tick으로 스텝을 진행하고 로그를 차례로 드러낸다', () => {
    const s = run(initialState(), tick(600));
    expect(s.phase).toBe('running');
    expect(stepAt(script, s.t)).toBe(1);
    expect(visibleThoughts(thoughts, s).map((x) => x.text)).toEqual(['a', 'b']);
    const s2 = run(s, tick(600));
    expect(stepAt(script, s2.t)).toBe(2);
    expect(visibleThoughts(thoughts, s2).map((x) => x.text)).toEqual(['a', 'b', 'c']);
  });

  it('일시정지 중에는 시계가 멈추고, 재개하면 다시 흐른다', () => {
    const paused = run(initialState(), tick(500), { type: 'pause' }, tick(5000));
    expect(paused.phase).toBe('paused');
    expect(paused.t).toBe(500);
    const resumed = run(paused, { type: 'resume' }, tick(100));
    expect(resumed.phase).toBe('running');
    expect(resumed.t).toBe(600);
    expect(resumed.events.map((e) => e.text)).toEqual(['실행자가 일시정지', '실행 재개']);
  });

  it('수동 스텝에 닿으면 그 스텝 로그를 다 보인 뒤 멈춘다', () => {
    const s = run(initialState(), tick(3200));
    expect(s.phase).toBe('running');
    expect(stepAt(script, s.t)).toBe(3);
    const halted = run(s, tick(1000));
    expect(halted.phase).toBe('manual');
    expect(halted.t).toBe(3400);
    expect(visibleThoughts(thoughts, halted).at(-1)?.text).toBe('f');
    // 대기 중에는 스텝 시계가 아니라 대기 시계가 흐른다
    const waited = run(halted, tick(60_000));
    expect(waited.t).toBe(3400);
    expect(waited.waitMs).toBe(60_000);
  });

  it('[완료] 후 검증을 거쳐 Pass로 끝난다', () => {
    const manual = run(initialState(), tick(10_000));
    const v = run(manual, { type: 'completeManual' });
    expect(v.phase).toBe('verifying');
    expect(verifiedCount(v, 2)).toBe(0);
    const mid = run(v, tick(VERIFY_MS / 2));
    expect(verifiedCount(mid, 2)).toBe(1);
    const done = run(mid, tick(VERIFY_MS));
    expect(done.phase).toBe('done');
    expect(done.verdict).toBe('pass');
    expect(verifiedCount(done, 2)).toBe(2);
  });

  it('수동 스텝에 10분간 응답이 없으면 Blocked', () => {
    const s = run(initialState(), tick(10_000), tick(MANUAL_TIMEOUT_MS));
    expect(s.phase).toBe('done');
    expect(s.verdict).toBe('blocked');
    expect(s.reason).toContain('타임아웃');
  });

  it('스텝 건너뛰기는 다음 스텝으로 가고 남은 로그를 숨긴다', () => {
    const s = run(initialState(), tick(200), { type: 'skip' });
    expect(s.t).toBe(1000);
    expect(s.skipped).toEqual([{ index: 1, at: 200 }]);
    expect(visibleThoughts(thoughts, s).map((x) => x.text)).toEqual(['a', '스텝 1 건너뜀 (실행자)', 'c']);
    // 수동 스텝 자체는 건너뛸 수 없다
    const manual = run(initialState(), tick(10_000), { type: 'skip' });
    expect(manual.phase).toBe('manual');
  });

  it('Take over 중에는 시계가 멈추고 Agent에 반환하면 이어서 진행한다', () => {
    const t = run(initialState(), tick(300), { type: 'takeOver' }, tick(1000));
    expect(t.phase).toBe('takeover');
    expect(t.t).toBe(300);
    const back = run(t, { type: 'returnToAgent' }, tick(100));
    expect(back.phase).toBe('running');
    expect(back.t).toBe(400);
  });

  it('중단하면 더는 진행하지 않는다', () => {
    const s = run(initialState(), tick(300), { type: 'abort' }, tick(5000), { type: 'resume' });
    expect(s.phase).toBe('aborted');
    expect(s.t).toBe(300);
  });
});

describe('jump (?at=)', () => {
  it('스텝으로 바로 가고 시계를 멈춘다', () => {
    const s = jumpState(script, 2);
    expect(s.live).toBe(false);
    expect(s.phase).toBe('running');
    expect(stepAt(script, s.t)).toBe(2);
    expect(run(s, tick(10_000))).toBe(s);
  });

  it('end는 수동 스텝 대기, done은 완료 상태', () => {
    expect(jumpState(script, 'end')).toMatchObject({ phase: 'manual', t: 3400, live: false });
    expect(jumpState(script, 99).phase).toBe('manual');
    expect(jumpState(script, 'done')).toMatchObject({ phase: 'done', verdict: 'pass' });
  });

  it('멈춘 상태에서 제어하면 시계가 다시 흐른다', () => {
    const s = run(jumpState(script, 'end'), { type: 'completeManual' }, tick(VERIFY_MS));
    expect(s.phase).toBe('done');
  });
});
