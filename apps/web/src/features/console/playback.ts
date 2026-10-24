/**
 * 로컬 콘솔 재생 상태 기계 (순수 모듈).
 *
 * 실제 제품에서는 호스트 에이전트가 Agent 실행 상태를 밀어 주지만, 지금은 fixture 스텝(`durationMs`)을
 * 시계로 재생한다. 시계는 컴포넌트가 `tick(dt)`으로 넣어 주므로 여기에는 실제 시간이 없다.
 *
 * 흐름: running → (pauseAt 스텝 도달) manual → [완료] verifying → done(Pass)
 *                                      └ 10분 무응답 → done(Blocked, 수동 스텝 타임아웃) (F-EX-11)
 */
import type { ConsolePhase, ConsoleControl, ThoughtEntry, Verdict } from '@qcard/shared';

/** 수동 스텝·위험 액션 대기 타임아웃 (F-EX-12 임시 기본값) */
export const MANUAL_TIMEOUT_MS = 10 * 60 * 1000;
/** [완료] 후 검증 포인트를 확인하는 데 걸리는 시간 (연출) */
export const VERIFY_MS = 2400;

export type Phase = ConsolePhase;

export type ScriptStep = { index: number; durationMs: number };
export type Script = {
  steps: ScriptStep[];
  /** 수동 스텝의 index (1부터). 이 스텝에서 멈춘다. */
  pauseAt: number;
  /** 수동 스텝에서 실제로 멈추는 시각. 그 스텝의 사고 로그가 다 나온 뒤다. */
  haltAt: number;
};

export type ControlEvent = ThoughtEntry & { stepIndex: number };

export type PlaybackState = {
  phase: Phase;
  /** 케이스 시계 (ms). 스텝 재생 위치 */
  t: number;
  /** 수동 스텝 대기 경과 (ms) */
  waitMs: number;
  /** 검증 경과 (ms) */
  verifyMs: number;
  /** 건너뛴 스텝과 건너뛴 시각 */
  skipped: { index: number; at: number }[];
  /** Take over 전 상태 */
  resumeTo?: 'running' | 'paused';
  verdict?: Verdict;
  /** Blocked 등 판정 사유 */
  reason?: string;
  /** false면 시계가 멈춘 스냅샷 상태 (`?at=`). 제어 버튼을 누르면 다시 흐른다. */
  live: boolean;
  /** 실행자 제어 기록 (사고 로그에 system으로 끼워 넣는다) */
  events: ControlEvent[];
};

export type PlaybackAction =
  | { type: 'tick'; dt: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'abort' }
  | { type: 'takeOver' }
  | { type: 'returnToAgent' }
  | { type: 'completeManual' }
  /** 위험 액션 승인 — 재생(데모)에는 승인 대기가 없다 */
  | { type: 'approve' }
  | { type: 'jump'; at: JumpTarget };

/** `?at=<스텝 index>` · `end`(수동 스텝 대기) · `done`(케이스 완료) */
export type JumpTarget = number | 'end' | 'done';

export function parseAt(raw: string | null): JumpTarget | undefined {
  if (raw === null) return undefined;
  if (raw === 'end' || raw === 'done') return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

export function makeScript(
  steps: ScriptStep[],
  pauseAt: number,
  thoughts: readonly { at: number; stepIndex: number }[],
): Script {
  const start = stepStart({ steps, pauseAt, haltAt: 0 }, pauseAt);
  const last = Math.max(start, ...thoughts.filter((x) => x.stepIndex === pauseAt).map((x) => x.at));
  return { steps, pauseAt, haltAt: last };
}

/** 스텝 시작 시각 = 앞 스텝 durationMs 합 */
export function stepStart(script: Script, index: number): number {
  let at = 0;
  for (const s of script.steps) {
    if (s.index >= index) break;
    at += s.durationMs;
  }
  return at;
}

/** 시각 t에 수행 중인 스텝 index */
export function stepAt(script: Script, t: number): number {
  let cur = script.steps[0]?.index ?? 1;
  for (const s of script.steps) {
    if (stepStart(script, s.index) <= t) cur = s.index;
  }
  return Math.min(cur, script.pauseAt);
}

export function initialState(): PlaybackState {
  return { phase: 'running', t: 0, waitMs: 0, verifyMs: 0, skipped: [], live: true, events: [] };
}

/** 스냅샷 지점으로 바로 간다. 시계는 멈춘다. */
export function jumpState(script: Script, at: JumpTarget): PlaybackState {
  const base = { ...initialState(), live: false };
  if (at === 'done') return { ...base, phase: 'done', t: script.haltAt, verifyMs: VERIFY_MS, verdict: 'pass' };
  if (at === 'end' || at >= script.pauseAt) return { ...base, phase: 'manual', t: script.haltAt };
  const step = script.steps.find((s) => s.index === at);
  const start = stepStart(script, at);
  // 그 스텝의 관찰·판단·액션 로그가 다 보이는 지점 (액션 직전 화면 + 오버레이)
  return { ...base, t: start + Math.min(600, Math.max(0, (step?.durationMs ?? 1) - 1)) };
}

const ev = (s: PlaybackState, script: Script, text: string): ControlEvent[] => [
  ...s.events,
  { at: s.t, stepIndex: stepAt(script, s.t), kind: 'system', text },
];

export function reduce(script: Script, s: PlaybackState, a: PlaybackAction): PlaybackState {
  switch (a.type) {
    case 'tick': {
      if (!s.live || a.dt <= 0) return s;
      if (s.phase === 'running') {
        const t = s.t + a.dt;
        if (t >= script.haltAt) return { ...s, t: script.haltAt, phase: 'manual', waitMs: 0 };
        return { ...s, t };
      }
      if (s.phase === 'manual') {
        const waitMs = s.waitMs + a.dt;
        if (waitMs >= MANUAL_TIMEOUT_MS)
          return {
            ...s,
            waitMs: MANUAL_TIMEOUT_MS,
            phase: 'done',
            verdict: 'blocked',
            reason: '수동 스텝 타임아웃 (10분)',
            events: ev(s, script, '수동 스텝 응답 없음 — 10분 타임아웃으로 Blocked, 다음 케이스로 진행'),
          };
        return { ...s, waitMs };
      }
      if (s.phase === 'verifying') {
        const verifyMs = s.verifyMs + a.dt;
        if (verifyMs >= VERIFY_MS) return { ...s, verifyMs: VERIFY_MS, phase: 'done', verdict: 'pass' };
        return { ...s, verifyMs };
      }
      return s;
    }
    case 'pause':
      if (s.phase !== 'running') return s;
      return { ...s, phase: 'paused', live: true, events: ev(s, script, '실행자가 일시정지') };
    case 'resume':
      if (s.phase !== 'paused') return s;
      return { ...s, phase: 'running', live: true, events: ev(s, script, '실행 재개') };
    case 'skip': {
      if (s.phase !== 'running' && s.phase !== 'paused') return s;
      const cur = stepAt(script, s.t);
      if (cur >= script.pauseAt) return s;
      const next = stepStart(script, cur + 1);
      return {
        ...s,
        live: true,
        t: Math.min(next, script.haltAt),
        skipped: [...s.skipped, { index: cur, at: s.t }],
        events: ev(s, script, `스텝 ${cur} 건너뜀 (실행자)`),
      };
    }
    case 'abort':
      if (s.phase === 'done' || s.phase === 'aborted') return s;
      return {
        ...s,
        phase: 'aborted',
        live: true,
        events: ev(s, script, 'Run 중단 (실행자) — 현재 케이스는 판정하지 않음'),
      };
    case 'takeOver':
      if (s.phase !== 'running' && s.phase !== 'paused') return s;
      return {
        ...s,
        phase: 'takeover',
        resumeTo: s.phase,
        live: true,
        events: ev(s, script, 'Take over — 실행자가 디바이스를 직접 조작 중. Agent는 대기'),
      };
    case 'returnToAgent':
      if (s.phase !== 'takeover') return s;
      return {
        ...s,
        phase: 'running',
        resumeTo: undefined,
        live: true,
        events: ev(s, script, 'Agent에 반환 — 현재 화면을 다시 관찰하고 이어서 진행'),
      };
    case 'approve':
      return s;
    case 'completeManual':
      if (s.phase !== 'manual') return s;
      return {
        ...s,
        phase: 'verifying',
        verifyMs: 0,
        live: true,
        events: ev(s, script, '실행자가 수동 스텝 [완료] — 검증 포인트 확인'),
      };
    case 'jump':
      return jumpState(script, a.at);
  }
}

/** 지금 보여줄 사고 로그 (fixture 로그 + 제어 기록). 건너뛴 스텝의 남은 로그는 뺀다. */
export function visibleThoughts<T extends ThoughtEntry & { stepIndex: number }>(
  thoughts: readonly T[],
  s: PlaybackState,
): (T | ControlEvent)[] {
  const shown = thoughts.filter((x) => x.at <= s.t && !s.skipped.some((k) => k.index === x.stepIndex && x.at > k.at));
  return [...shown, ...s.events].sort((a, b) => a.at - b.at);
}

/** 검증 단계에서 보여줄 포인트 수 (verifyMs에 비례) */
export function verifiedCount(s: PlaybackState, total: number): number {
  if (s.phase === 'done' && s.verdict === 'pass') return total;
  if (s.phase !== 'verifying' || total === 0) return 0;
  return Math.min(total, Math.floor((s.verifyMs / VERIFY_MS) * (total + 1)));
}

/** 케이스 경과 시간 (ms) */
export const elapsedMs = (s: PlaybackState) => s.t + s.waitMs + s.verifyMs;

/**
 * 이 케이스에서 쓴 토큰 (추정). fixture에 케이스 중간 토큰 수가 없어서,
 * LLM 호출 1회(관찰→판단)를 3,100 토큰, 검증 포인트 1개를 1,800 토큰으로 잡는다.
 */
export function caseTokens(decideCount: number, verified: number): number {
  return decideCount * 3100 + verified * 1800;
}

/** 실행자 제어 → 재생 액션 (재생 화면과 실시간 화면이 같은 제어 버튼을 쓴다) */
export const controlAction = (a: ConsoleControl): PlaybackAction => ({ type: a });
