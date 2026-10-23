import type { QcardApi } from '@qcard/data';
import type { DeviceDriver, DeviceInfo } from '@qcard/device';
import type {
  ClaudeCodeState,
  ConsoleClientMessage,
  ConsoleCycleOption,
  ConsoleHome,
  ConsoleServerMessage,
} from '@qcard/shared';
import type { FirebaseStorage } from 'firebase/storage';
import type { UploadQueue } from '../queue';
import { consoleDevice, CycleRunError, prepareCycleRun, type CycleRunDeps } from '../run';
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
  claudeCode: () => ClaudeCodeState;
  log: (line: string) => void;
  /** 빌드 파일이 없는 사이클(시드)에서 실행할 앱 */
  fallbackPackage: string;
  allowNetworkToggle?: boolean;
  /** 테스트에서 LLM·Agent 환경을 바꾼다 */
  llm?: CycleRunDeps['llm'];
  env?: CycleRunDeps['env'];
  awakeDir?: string;
};

export class ConsoleService implements ConsoleBackend {
  private listeners = new Set<(m: ConsoleServerMessage) => void>();
  private home: ConsoleHome;
  private device: { driver: DeviceDriver; info: DeviceInfo } | undefined;
  private run: { hub: ConsoleHub; off: () => void; done: Promise<void> } | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(private readonly deps: ConsoleServiceDeps) {
    this.home = { executor: deps.executor, cycles: [], loading: false, claudeCode: deps.claudeCode() };
  }

  // ------------------------------------------------------------ ConsoleBackend

  subscribe(send: (m: ConsoleServerMessage) => void) {
    this.listeners.add(send);
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

  private async cyclesFor(info: DeviceInfo): Promise<ConsoleCycleOption[]> {
    const { api, executor } = this.deps;
    const out: ConsoleCycleOption[] = [];
    for (const { project } of await api.listMyProjects()) {
      for (const s of await api.listCycles(project.id)) {
        if (s.cycle.origin === 'local_run') continue;
        const target = s.cycle.targets.find((t) => t.model === info.model && t.osMajor === info.osMajor);
        if (!target) continue;
        const d = await api.getCycle({ projectId: project.id, cycleId: s.cycle.id });
        const done = new Set(
          d.results.filter((r) => r.deviceId === target.id && r.verdict !== 'nt').map((r) => r.tcId),
        );
        const paused = d.runs
          .filter((r) => r.status === 'paused' && r.executor === executor && r.deviceId === target.id)
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
          ...(paused
            ? { pausedRun: { id: paused.id, ...(paused.pauseReason ? { reason: paused.pauseReason } : {}) } }
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
  }

  private async start(m: Extract<ConsoleClientMessage, { type: 'start' }>) {
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
          claudeCode: this.deps.claudeCode(),
          log: this.deps.log,
          llm: this.deps.llm,
          env: this.deps.env,
          awakeDir: this.deps.awakeDir,
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
    this.run = { hub, off, done };
  }

  /** 진행 중인 Run이 끝날 때까지 (테스트·종료용) */
  async idle() {
    await this.run?.done;
  }
}
