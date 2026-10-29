import type { QcardApi } from '@qcard/data';
import type { DeviceDriver, DeviceInfo } from '@qcard/device';
import type {
  CaseResult,
  ClaudeCodeState,
  ConsoleClientMessage,
  ConsoleCycleOption,
  ConsoleHome,
  ConsoleServerMessage,
  Run,
} from '@qcard/shared';
import { isRunStale } from '@qcard/shared';
import type { FirebaseStorage } from 'firebase/storage';
import type { UploadQueue } from '../queue';
import { consoleDevice, CycleRunError, prepareCycleRun, type CycleRunDeps, type RunAccount } from '../run';
import type { ConsoleHub } from './hub';
import type { ConsoleBackend } from './server';

/*
 * 상주 호스트(serve)의 로컬 콘솔: Run이 없을 때는 홈(연결된 디바이스·이 디바이스가 대상인 사이클·일시정지된 Run),
 * [Run 시작]을 누르면 그 Run의 실행 화면을 보여 준다. 한 번에 Run 하나 (1인 1대).
 */

export type ConsoleServiceDeps = {
  api: QcardApi;
  storage: FirebaseStorage;
  queue: UploadQueue;
  executor: string;
  account: RunAccount;
  claudeCode: () => ClaudeCodeState;
  log: (line: string) => void;
  /** 빌드 파일이 없는 사이클(시드)에서 실행할 앱 */
  fallbackPackage?: string;
  allowNetworkToggle?: boolean;
  /** 웹 대시보드 주소 (콘솔의 [대시보드에서 보기]) */
  dashboardUrl?: string;
  /** 테스트에서 LLM·Agent 환경을 바꾼다 */
  llm?: CycleRunDeps['llm'];
  env?: CycleRunDeps['env'];
  awakeDir?: string;
  /** 테스트 계정 배정·반납 (F-PF-04) */
  accounts?: CycleRunDeps['accounts'];
  /** 칸 자동 선점 (F-CY-06) */
  cells?: CycleRunDeps['cells'];
};

export class ConsoleService implements ConsoleBackend {
  private listeners = new Set<(m: ConsoleServerMessage) => void>();
  private home: ConsoleHome;
  private device: { driver: DeviceDriver; info: DeviceInfo } | undefined;
  private run: { hub: ConsoleHub; off: () => void; done: Promise<void>; runId: string } | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(private readonly deps: ConsoleServiceDeps) {
    this.home = { executor: deps.executor, cycles: [], loading: false, claudeCode: deps.claudeCode() };
  }

  // ------------------------------------------------------------ ConsoleBackend

  subscribe(send: (m: ConsoleServerMessage) => void) {
    this.listeners.add(send);
    if (this.deps.dashboardUrl) send({ type: 'info', dashboardUrl: this.deps.dashboardUrl });
    if (this.run) send({ type: 'state', state: this.run.hub.snapshot() });
    else send({ type: 'home', home: this.home });
    return () => void this.listeners.delete(send);
  }

  handle(m: ConsoleClientMessage) {
    if (m.type === 'control') this.run?.hub.control(m.action);
    else if (m.type === 'refresh') void this.refresh();
    else void this.start(m);
  }

  shot(path: string) {
    return this.run?.hub.shot(path);
  }

  // ------------------------------------------------------------ 상태

  private broadcast(m: ConsoleServerMessage) {
    for (const fn of this.listeners) fn(m);
  }

  private setHome(patch: Partial<ConsoleHome>) {
    this.home = { ...this.home, ...patch };
    if (!this.run) this.broadcast({ type: 'home', home: this.home });
  }

  /** 지금 Run 중인가 */
  get running() {
    return this.run !== undefined;
  }

  /** 홈에 한 번 알릴 일 */
  notify(notice: string | undefined) {
    this.setHome({ notice });
  }

  /** 다른 일을 하는 중 (QA 문서 생성 등) — 홈에 알린다 */
  setBusy(busy: string | undefined) {
    this.setHome({ busy });
  }

  /** Claude Code 상태를 다시 읽었다 (연결 신호마다) — 로그인·한도가 바뀌었으면 홈에 알린다 */
  claudeCodeChanged() {
    const claudeCode = this.deps.claudeCode();
    if (JSON.stringify(claudeCode) !== JSON.stringify(this.home.claudeCode)) this.setHome({ claudeCode });
  }

  /** 연결된 디바이스가 바뀌었다 (없으면 undefined) */
  setDevice(device: { driver: DeviceDriver; info: DeviceInfo } | undefined) {
    const same = device?.info.serial === this.device?.info.serial;
    this.device = device;
    if (same) return;
    this.setHome({
      device: device ? consoleDevice(device.info, 'idle') : undefined,
      screen: device?.info.size,
      cycles: [],
    });
    void this.refresh();
  }

  /** 이 디바이스가 대상인 사이클과 남은 케이스·일시정지된 Run을 다시 읽는다 */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async load() {
    const dev = this.device;
    this.setHome({ loading: true, claudeCode: this.deps.claudeCode() });
    if (!dev) return this.setHome({ loading: false, cycles: [], deviceProblem: undefined });
    try {
      const problem = await this.screenProblem(dev.driver);
      this.setHome({ cycles: await this.cyclesFor(dev.info), deviceProblem: problem, loading: false });
    } catch (e) {
      this.deps.log(`사이클 목록을 읽지 못했습니다: ${(e as Error).message}`);
      this.setHome({ loading: false });
    }
  }

  private async screenProblem(driver: DeviceDriver) {
    const screen = await driver.screenState().catch(() => undefined);
    return screen && (!screen.awake || screen.locked)
      ? `화면이 ${screen.awake ? '잠겨' : '꺼져'} 있습니다. 잠금을 풀고 화면을 켜 두세요`
      : undefined;
  }

  /** 화면 꺼짐·잠김만 다시 본다 (주기적으로, 사이클 목록은 그대로) */
  async checkDevice() {
    const dev = this.device;
    if (!dev || this.run) return;
    const problem = await this.screenProblem(dev.driver);
    if (problem !== this.home.deviceProblem) this.setHome({ deviceProblem: problem });
  }

  /** 남은 케이스에 필요한 계정 종류 중 지금 배정할 수 있는 계정이 없는 것 (F-PF-08). 계정을 읽지 못하면 알리지 않는다 */
  private async accountShortage(projectId: string, cases: { accountKind?: string }[]) {
    const need = new Map<string, number>();
    for (const c of cases) if (c.accountKind) need.set(c.accountKind, (need.get(c.accountKind) ?? 0) + 1);
    if (!need.size) return [];
    const views = await this.deps.api.listAccounts(projectId).catch(() => undefined);
    if (!views) return [];
    return [...need]
      .filter(([kind]) => !views.some((v) => v.account.kind === kind && v.state === 'free'))
      .map(([kind, n]) => ({ kind, cases: n }));
  }

  private async cyclesFor(info: DeviceInfo): Promise<ConsoleCycleOption[]> {
    const { api, executor, account } = this.deps;
    // 내 Run: 예전 Run(executorUid 없음)은 이름으로 본다
    const mine = (r: Run) => (r.executorUid ? r.executorUid === account.uid : r.executor === executor);
    const out: ConsoleCycleOption[] = [];
    for (const { project } of await api.listMyProjects()) {
      for (const s of await api.listCycles(project.id)) {
        if (s.cycle.origin === 'local_run' || s.cycle.period.end) continue; // 완료된 사이클은 실행하지 않는다 (F-CY-09)
        const target = s.cycle.targets.find((t) => t.model === info.model && t.osMajor === info.osMajor);
        if (!target) continue;
        const d = await api.getCycle({ projectId: project.id, cycleId: s.cycle.id });
        const done = new Set(
          d.results.filter((r) => r.deviceId === target.id && r.verdict !== 'nt').map((r) => r.tcId),
        );
        // 이 디바이스로 돌리던 내 Run이 호스트 신호 없이 "실행 중"으로 남아 있으면(호스트가 죽음) 일시정지로 정리한다 (F-DV-04)
        const runs = d.runs.map((r) => {
          if (!mine(r) || r.deviceId !== target.id || r.id === this.run?.runId) return r;
          if (!isRunStale(r, Date.now())) return r;
          void this.deps.queue.enqueue({
            type: 'update',
            path: `projects/${project.id}/cycles/${s.cycle.id}/runs/${r.id}`,
            data: { status: 'paused', pauseReason: 'host_lost' },
          });
          return { ...r, status: 'paused' as const, pauseReason: 'host_lost' as const };
        });
        const accountShortage = await this.accountShortage(
          project.id,
          d.cases.filter((c) => c.mode === 'auto' && !done.has(c.tcId)),
        );
        const paused = runs
          .filter((r) => r.status === 'paused' && mine(r) && r.deviceId === target.id)
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .at(-1);
        out.push({
          projectId: project.id,
          projectName: project.name,
          cycleId: s.cycle.id,
          cycleName: s.cycle.name,
          build: { version: s.build.version, buildNumber: s.build.buildNumber },
          docVersion: s.docVersion,
          deviceId: target.id,
          cases: d.cases
            .filter((c) => c.mode === 'auto')
            .map((c) => ({ tcId: c.tcId, title: c.title, done: done.has(c.tcId) })),
          ...(accountShortage.length ? { accountShortage } : {}),
          ...(paused
            ? {
                pausedRun: {
                  id: paused.id,
                  ...(paused.pauseReason ? { reason: paused.pauseReason } : {}),
                  ...resumable(
                    paused,
                    d.results,
                    target.id,
                    d.cases.filter((c) => c.mode === 'auto' && !done.has(c.tcId)).length,
                  ),
                },
              }
            : {}),
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ Run

  private fail(message: string) {
    this.deps.log(message);
    this.broadcast({ type: 'error', message });
    return { error: message };
  }

  /**
   * 웹에서 요청한 Run 시작 (작업 kind `run_cycle`). 로컬 콘솔의 [실행]과 같은 경로이고, 시작하면 콘솔이 실행 화면으로 바뀐다.
   * 시작하지 못하면 이유를 돌려준다 (작업 실패로 웹에 보인다)
   */
  startRun(req: Omit<Extract<ConsoleClientMessage, { type: 'start' }>, 'type'>) {
    return this.start({ type: 'start', ...req });
  }

  private async start(
    m: Extract<ConsoleClientMessage, { type: 'start' }>,
  ): Promise<{ runId: string } | { error: string }> {
    const dev = this.device;
    if (this.run) return this.fail('이미 Run이 진행 중입니다');
    if (!dev) return this.fail('연결된 디바이스가 없습니다');
    const screen = await dev.driver.screenState().catch(() => undefined);
    if (screen && (!screen.awake || screen.locked)) {
      return this.fail(`디바이스 화면이 ${screen.awake ? '잠겨' : '꺼져'} 있습니다. 잠금을 풀고 다시 시작하세요`);
    }
    let prepared: Awaited<ReturnType<typeof prepareCycleRun>>;
    try {
      prepared = await prepareCycleRun(
        {
          api: this.deps.api,
          storage: this.deps.storage,
          queue: this.deps.queue,
          device: dev.driver,
          info: dev.info,
          executor: this.deps.executor,
          account: this.deps.account,
          claudeCode: this.deps.claudeCode(),
          log: this.deps.log,
          llm: this.deps.llm,
          env: this.deps.env,
          awakeDir: this.deps.awakeDir,
          accounts: this.deps.accounts,
          cells: this.deps.cells,
        },
        {
          projectId: m.projectId,
          cycleId: m.cycleId,
          tcIds: m.tcIds,
          resumeRunId: m.resumeRunId,
          fallbackPackage: this.deps.fallbackPackage,
          allowNetworkToggle: this.deps.allowNetworkToggle,
        },
      );
    } catch (e) {
      if (e instanceof CycleRunError) return this.fail(e.message);
      return this.fail(`Run을 시작하지 못했습니다: ${(e as Error).message}`);
    }
    const { hub } = prepared;
    const off = hub.subscribe((state) => this.broadcast({ type: 'state', state }));
    const done = prepared
      .start()
      .then((out) => {
        this.home = {
          ...this.home,
          lastRun: {
            cycleName: out.cycleName,
            status: out.status,
            ...(out.status === 'paused' ? { message: out.message } : {}),
            judged: out.results.length,
          },
        };
        this.deps.log(
          `Run ${out.runId} ${out.status} · ${out.results.length}케이스 판정 · 환산 $${out.costUsd.toFixed(2)}`,
        );
      })
      .catch((e: Error) => {
        this.home = {
          ...this.home,
          lastRun: { cycleName: prepared.cycle.name, status: 'aborted', message: e.message, judged: 0 },
        };
        this.deps.log(`Run이 오류로 끝났습니다: ${e.message}`);
      })
      .finally(() => {
        off();
        this.run = undefined;
        this.broadcast({ type: 'home', home: this.home });
        void this.refresh();
      });
    this.run = { hub, off, done, runId: prepared.runId };
    return { runId: prepared.runId };
  }

  /** 진행 중인 Run이 끝날 때까지 (테스트·종료용) */
  async idle() {
    await this.run?.done;
  }
}

/** 일시정지된 Run을 이어서 실행하면 돌 케이스 수 (runCycle의 skipDone과 같은 규칙) */
function resumable(run: Run, results: CaseResult[], deviceId: string, remaining: number) {
  // 큐를 남기지 않은 예전 Run: 결과가 없는 자동 케이스 전체
  if (!run.tcIds) return { left: remaining };
  const here = new Set(
    results.filter((r) => r.deviceId === deviceId && r.runId === run.id && r.verdict !== 'nt').map((r) => r.tcId),
  );
  return { total: run.tcIds.length, left: run.tcIds.filter((id) => !here.has(id)).length };
}
