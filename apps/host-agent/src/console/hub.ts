import { RunAbortedError, type ControlSignal, type RiskAnswer, type RiskRequest, type RunControl } from '@qcard/agent';
import type { CaseResult, ConsoleControl, ExecStep, LiveConsole, TestCase, ThoughtEntry } from '@qcard/shared';

/*
 * 로컬 콘솔 허브: 사이클 실행의 상태를 모아 화면에 밀어 주고(LiveConsole), 화면의 제어를 Agent에 전한다.
 *   - 일시정지·Take over: 다음 턴 사이에서 Agent가 멈춘다. 누른 사이 Agent가 고른 액션은 실행하지 않는다
 *   - 건너뛰기: 지금 단계를 끝난 것으로 넘긴다 · 중단: 지금 케이스는 판정하지 않고 Run을 끝낸다
 *   - 수동 스텝: 실행자가 [완료]를 누를 때까지 기다린다 (10분 지나면 Blocked)
 *   - 위험 액션: [승인](승인 필요만) 또는 [직접 실행] → [Agent에 반환]. 10분 안에 답이 없으면 Blocked.
 *     직접 실행하는 동안은 시간을 재지 않는다
 */

/** 수동 스텝 대기 한도 (임시 기본값) */
export const MANUAL_TIMEOUT_MS = 10 * 60 * 1000;

type Init = Omit<LiveConsole, 'queue' | 'current' | 'phase' | 'run' | 'usage'> & { caseTokenLimit: number };

export class ConsoleHub implements RunControl {
  private state: LiveConsole;
  private listeners = new Set<(s: LiveConsole) => void>();
  /** 턴 사이에 Agent에 전할 신호 */
  private pending: 'skip' | 'abort' | undefined;
  private tookOver = false;
  private stage: 'prep' | 'steps' | 'verify' = 'prep';
  /** 최근 스크린샷 (스텝 썸네일). 저장 경로 → PNG */
  private shots = new Map<string, Uint8Array>();
  private wake: (() => void) | undefined;
  private manualDone: ((answer: 'done' | 'timeout') => void) | undefined;
  private riskDone: ((answer: RiskAnswer) => void) | undefined;
  private riskClock: (() => void) | undefined;

  constructor(
    init: Init,
    private readonly opts: { now?: () => number; manualTimeoutMs?: number } = {},
  ) {
    const { caseTokenLimit, ...rest } = init;
    this.state = {
      ...rest,
      queue: [],
      phase: 'running',
      run: { status: 'running' },
      usage: { tokens: 0, costUsd: 0, caseTokens: 0, caseTokenLimit },
    };
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  snapshot(): LiveConsole {
    return this.state;
  }

  subscribe(fn: (s: LiveConsole) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<LiveConsole>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private setCurrent(patch: Partial<NonNullable<LiveConsole['current']>>) {
    if (this.state.current) this.set({ current: { ...this.state.current, ...patch } });
  }

  // ------------------------------------------------------------ 실행 쪽 (runCycle·Agent가 부른다)

  /** 실행할 케이스 목록 (runCycle이 고른 순서) */
  setQueue(cases: TestCase[]) {
    this.set({ queue: cases.map((c) => ({ tcId: c.tcId, title: c.title, mode: c.mode, status: 'pending' })) });
  }

  caseStarted(tc: TestCase) {
    this.pending = this.pending === 'abort' ? 'abort' : undefined;
    this.tookOver = false;
    this.stage = 'prep';
    this.set({
      phase: 'running',
      verdict: undefined,
      reason: undefined,
      manual: undefined,
      approval: undefined,
      queue: this.state.queue.map((q) => (q.tcId === tc.tcId ? { ...q, status: 'running' } : q)),
      current: { tcId: tc.tcId, case: tc, steps: [], thoughts: [], startedAt: this.now(), verified: 0 },
      usage: { ...this.state.usage, caseTokens: 0 },
    });
  }

  thought = (t: ThoughtEntry) => {
    const cur = this.state.current;
    if (!cur) return;
    // 사고 로그는 곧 수행할 스텝에 묶는다 (관찰·판단 → 액션). 마지막 스텝 뒤의 로그는 검증으로 보인다
    const entry = { ...t, at: this.now() - cur.startedAt, stepIndex: cur.steps.length + 1 };
    this.setCurrent({
      thoughts: [...cur.thoughts, entry],
      verified: cur.verified + (t.kind === 'verify' ? 1 : 0),
    });
  };

  step = (s: ExecStep) => {
    const cur = this.state.current;
    if (!cur) return;
    // 준비 플로우의 스텝은 케이스 단계가 아니다
    const { caseStepIndex, ...rest } = s;
    const step = this.stage === 'steps' ? { ...rest, caseStepIndex } : rest;
    // 번호는 케이스 전체로 이어 매기고, 시점은 케이스 시작 기준으로 바꾼다 (준비 플로우마다 0부터 시작한다)
    const videoTs = this.now() - cur.startedAt;
    // Storage에 올라가는 스크린샷은 콘솔 서버가 메모리에서 바로 준다
    const screenshot =
      step.screenshot.kind === 'storage' && this.shots.has(step.screenshot.path)
        ? {
            kind: 'url' as const,
            url: `/console-api/shot?p=${encodeURIComponent(step.screenshot.path)}`,
            w: step.screenshot.w,
            h: step.screenshot.h,
          }
        : step.screenshot;
    this.setCurrent({ steps: [...cur.steps, { ...step, screenshot, index: cur.steps.length + 1, videoTs }] });
  };

  /** Run 동안 폰의 "충전 중 화면 켜짐 유지"를 켜 두었는가 (콘솔에 보인다) */
  setStayAwake(on: boolean) {
    if (Boolean(this.state.stayAwake) !== on) this.set({ stayAwake: on || undefined });
  }

  /** Agent가 모델 응답을 기다리기 시작했다 / 받았다 (오래 걸리면 콘솔에 보인다) */
  llmStarted(limitMs: number) {
    this.set({ llmWait: { since: this.now(), limitMs } });
  }

  /** Claude Code가 API 오류로 다시 시도하는 중 (응답이 늦어지는 이유) */
  llmRetry(r: { attempt: number; maxRetries: number; reason: string }) {
    const wait = this.state.llmWait;
    if (wait)
      this.set({ llmWait: { ...wait, retry: { attempt: r.attempt, maxRetries: r.maxRetries, reason: r.reason } } });
  }

  llmEnded() {
    if (this.state.llmWait) this.set({ llmWait: undefined });
  }

  /** 방금 찍은 스크린샷을 갖고 있는다 (최근 150장) */
  keepShot(path: string, png: Uint8Array) {
    this.shots.set(path, png);
    if (this.shots.size > 150) this.shots.delete(this.shots.keys().next().value!);
  }

  shot(path: string): Uint8Array | undefined {
    return this.shots.get(path);
  }

  /** 케이스 안의 단계: 준비 → 단계 수행 → 검증 */
  phase(stage: 'prep' | 'steps' | 'verify') {
    this.stage = stage;
    if (stage === 'verify' && this.state.phase === 'running') this.set({ phase: 'verifying' });
  }

  usage(u: { tokens: number; costUsd: number; caseTokens: number }) {
    this.set({ usage: { ...this.state.usage, ...u } });
  }

  caseFinished(tc: TestCase, r: CaseResult) {
    this.set({
      phase: 'done',
      verdict: r.verdict,
      reason: r.blockedReason ?? r.actualSummary,
      manual: undefined,
      queue: this.state.queue.map((q) => (q.tcId === tc.tcId ? { ...q, status: 'done', verdict: r.verdict } : q)),
    });
  }

  /** 다른 Run이 잡았거나 끝낸 칸: 이 Run의 큐에서 뺀다 */
  caseSkipped(tc: TestCase) {
    this.set({ queue: this.state.queue.filter((q) => q.tcId !== tc.tcId) });
  }

  runEnded(status: LiveConsole['run']['status'], message?: string) {
    this.set({
      run: { status, ...(message ? { message } : {}) },
      ...(status === 'aborted' ? { phase: 'aborted' as const } : {}),
      device: { ...this.state.device, status: 'idle' },
    });
  }

  /** 수동 스텝: 실행자가 [완료]를 누르거나 한도가 지날 때까지 기다린다. 중단하면 던진다 */
  onManual = (instruction: string): Promise<'done' | 'timeout'> => {
    const ms = this.opts.manualTimeoutMs ?? MANUAL_TIMEOUT_MS;
    this.set({ phase: 'manual', manual: { instruction, deadline: this.now() + ms } });
    return new Promise<'done' | 'timeout'>((resolve, reject) => {
      const timer = setTimeout(() => finish('timeout'), ms);
      const finish = (answer: 'done' | 'timeout') => {
        clearTimeout(timer);
        this.manualDone = undefined;
        this.set({ phase: 'running', manual: undefined });
        if (this.pending === 'abort') reject(new RunAbortedError('실행자가 Run을 중단했습니다'));
        else resolve(answer);
      };
      this.manualDone = finish;
    });
  };

  /** 위험 액션: 실행자의 [승인]·[직접 실행 → Agent에 반환]이나 한도가 지날 때까지 기다린다. 중단하면 던진다 */
  onRisk = (req: RiskRequest): Promise<RiskAnswer> => {
    const ms = this.opts.manualTimeoutMs ?? MANUAL_TIMEOUT_MS;
    const { kind, level, reason, source, action, target } = req;
    this.set({
      phase: 'approval',
      approval: { kind, level, reason, source, action, ...(target ? { target } : {}), deadline: this.now() + ms },
    });
    return new Promise<RiskAnswer>((resolve, reject) => {
      const timer = setTimeout(() => finish({ decision: 'timeout' }), ms);
      const finish = (answer: RiskAnswer) => {
        clearTimeout(timer);
        this.riskDone = undefined;
        this.riskClock = undefined;
        this.set({ phase: 'running', approval: undefined });
        if (this.pending === 'abort') reject(new RunAbortedError('실행자가 Run을 중단했습니다'));
        else resolve(answer);
      };
      this.riskDone = finish;
      this.riskClock = () => clearTimeout(timer);
    });
  };

  // ------------------------------------------------------------ RunControl (Agent 루프)

  interrupted(): boolean {
    return this.pending !== undefined || this.state.phase === 'paused' || this.state.phase === 'takeover';
  }

  async checkpoint(): Promise<ControlSignal> {
    while (this.state.phase === 'paused' || this.state.phase === 'takeover') {
      if (this.pending === 'abort') break;
      await new Promise<void>((r) => (this.wake = r));
    }
    const signal = this.pending;
    this.pending = undefined;
    if (signal === 'abort') return 'abort';
    if (signal === 'skip') return 'skip';
    if (this.tookOver) {
      this.tookOver = false;
      return 'took_over';
    }
    return 'continue';
  }

  private release() {
    const w = this.wake;
    this.wake = undefined;
    w?.();
  }

  // ------------------------------------------------------------ 화면의 제어

  control(action: ConsoleControl) {
    const { phase } = this.state;
    switch (action) {
      case 'pause':
        if (phase === 'running') this.set({ phase: 'paused' });
        return;
      case 'resume':
        if (phase === 'paused') {
          this.set({ phase: 'running' });
          this.release();
        }
        return;
      case 'approve':
        if (phase === 'approval' && this.state.approval?.level === 'approval')
          this.riskDone?.({ decision: 'approved', by: this.state.executor });
        return;
      case 'takeOver':
        // 위험 액션을 실행자가 직접 한다: 다 하고 [Agent에 반환]할 때까지 기다린다 (시간 제한 없음)
        if (phase === 'approval') {
          this.riskClock?.();
          this.set({ phase: 'takeover' });
          return;
        }
        if (phase === 'running' || phase === 'paused') {
          this.tookOver = true;
          this.set({ phase: 'takeover' });
        }
        return;
      case 'returnToAgent':
        if (phase === 'takeover' && this.riskDone) {
          this.riskDone({ decision: 'took_over', by: this.state.executor });
          return;
        }
        if (phase === 'takeover') {
          this.set({ phase: 'running' });
          this.release();
        }
        return;
      case 'skip':
        if (phase === 'running' || phase === 'paused') {
          this.pending = 'skip';
          if (phase === 'paused') this.set({ phase: 'running' });
          this.release();
        }
        return;
      case 'completeManual':
        if (phase === 'manual') this.manualDone?.('done');
        return;
      case 'abort':
        if (this.state.run.status !== 'running') return;
        this.pending = 'abort';
        this.manualDone?.('timeout');
        this.riskDone?.({ decision: 'timeout' });
        this.release();
        return;
    }
  }
}
