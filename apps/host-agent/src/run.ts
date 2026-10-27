import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEnv } from '@qcard/agent';
import type { QcardApi } from '@qcard/data';
import type { DeviceDriver, DeviceInfo } from '@qcard/device';
import { createLlm, SecretVault, TURN_TIMEOUT_MS, UsageMeter, withSecretGuard, type LlmClient } from '@qcard/llm';
import type { ClaudeCodeState } from '@qcard/shared';
import type { FirebaseStorage } from 'firebase/storage';
import { holdAwake } from './awake';
import { BuildInstallError, ensureBuild } from './build';
import { ConsoleHub } from './console/hub';
import type { AccountLeaser } from './accounts';
import type { UploadQueue } from './queue';
import { runCycle, type RunCycleOutcome } from './runCycle';
import { runSink } from './sink';

/*
 * 사이클 Run 하나: 디바이스가 사이클 대상인지 확인 → 사이클 빌드 설치 → 케이스 실행·업로드.
 * 진행 상태는 로컬 콘솔 허브(ConsoleHub)에 모은다. run-cycle(명령)과 serve(콘솔에서 시작)가 함께 쓴다.
 */

/** 시작할 수 없다 (대상 디바이스가 아님, 빌드를 설치할 수 없음) */
export class CycleRunError extends Error {
  override name = 'CycleRunError';
}

export type CycleRunDeps = {
  api: QcardApi;
  storage: FirebaseStorage;
  queue: UploadQueue;
  device: DeviceDriver;
  info: DeviceInfo;
  /** 실행자 표시 이름 */
  executor: string;
  /** 실행한 사용자·이 PC의 호스트 연결 (Run 문서에 남겨 보안 규칙이 소유를 확인한다) */
  account: RunAccount;
  claudeCode: ClaudeCodeState;
  log: (line: string) => void;
  /** 기본: 이 PC의 Claude Code (사용량 미터로 감싼다) */
  llm?: (meter: UsageMeter) => LlmClient;
  /** "충전 중 화면 켜짐 유지" 표시 파일 폴더 (테스트) */
  awakeDir?: string;
  /** Agent 환경 덮어쓰기 (테스트: 시계·비전) */
  env?: Partial<Pick<AgentEnv, 'clock' | 'vision' | 'settleMs'>>;
  /** 테스트 계정 배정·반납 (F-PF-04). 없으면 계정이 필요한 케이스는 Blocked */
  accounts?: AccountLeaser;
};

export type RunAccount = { uid: string; hostId: string };

export type CycleRunRequest = {
  projectId: string;
  cycleId: string;
  /** 없으면 남은 자동 케이스 전체 */
  tcIds?: string[];
  /** 일시정지된 Run을 이어서 (결과가 있는 칸은 건너뛴다) */
  resumeRunId?: string;
  /** 빌드 파일이 없는 사이클(개발 시드)에서 실행할 앱. 없으면 그런 사이클은 시작하지 않는다 */
  fallbackPackage?: string;
  allowNetworkToggle?: boolean;
};

export type CycleRunOutcome = RunCycleOutcome & { runId: string; cycleName: string; costUsd: number };

/**
 * Run을 준비한다. 문제가 있으면 CycleRunError를 던진다.
 * 돌려준 hub를 콘솔에 먼저 붙인 뒤 start()로 실행한다
 */
export async function prepareCycleRun(deps: CycleRunDeps, req: CycleRunRequest) {
  const { api, info, log } = deps;
  // 지난 Run에서 멈춘 업로드가 있으면 다시 보내 본다 (같은 오류면 이번 Run도 멈추고 알린다)
  deps.queue.retry();
  const { cycle, build, runs } = await api.getCycle({ projectId: req.projectId, cycleId: req.cycleId });
  // 이어서 실행하면 그 Run의 큐를 그대로 쓴다 (남은 전체로 넓어지지 않게)
  const resumed = req.resumeRunId ? runs.find((r) => r.id === req.resumeRunId) : undefined;
  const tcIds = req.tcIds?.length ? req.tcIds : resumed?.tcIds?.length ? resumed.tcIds : undefined;
  // 완료된 사이클은 새 Run도, 일시정지된 Run 이어서 실행도 받지 않는다 (F-CY-09)
  if (cycle.period.end) {
    throw new CycleRunError(`완료된 사이클입니다 (${cycle.name}). 웹에서 다시 열어야 실행할 수 있습니다.`);
  }
  const target = cycle.targets.find((t) => t.model === info.model && t.osMajor === info.osMajor);
  if (!target) {
    throw new CycleRunError(
      `이 디바이스(${info.model} · Android ${info.osMajor})는 사이클 대상이 아닙니다. 대상: ${cycle.targets.map((t) => t.label).join(', ')}`,
    );
  }
  // 빌드 파일이 있으면 그 앱을, 없으면(개발 시드) 지정한 앱을 실행한다
  const chosen = build.storagePath ? build.packageName : req.fallbackPackage;
  if (!chosen) {
    throw new CycleRunError(
      `빌드 ${build.version} (${build.buildNumber})에 APK 파일이 없어 실행할 앱을 알 수 없습니다. 웹에서 빌드를 올린 사이클로 실행하세요.`,
    );
  }
  const appPackage: string = chosen;
  try {
    const r = await ensureBuild({
      storage: deps.storage,
      build,
      device: deps.device,
      appPackage,
      cacheDir: join(homedir(), '.qcard', 'builds'),
      log,
    });
    if (r.status === 'no_file')
      log(`빌드 ${build.version} (${build.buildNumber}): 파일이 없는 빌드라 설치된 앱으로 진행합니다`);
  } catch (e) {
    if (e instanceof BuildInstallError) throw new CycleRunError(e.message);
    throw e;
  }

  const runId = req.resumeRunId ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const meter = new UsageMeter({ maxCallsPerCase: 40, maxTokensPerCase: 600_000 });
  const hub = new ConsoleHub({
    projectId: req.projectId,
    cycleId: req.cycleId,
    cycleName: cycle.name,
    build: { version: build.version, buildNumber: build.buildNumber },
    runId,
    executor: deps.executor,
    device: consoleDevice(info, 'running'),
    screen: info.size,
    claudeCode: deps.claudeCode,
    caseTokenLimit: meter.limits.maxTokensPerCase ?? 600_000,
  });
  log(`${cycle.name} · ${target.label} · ${deps.executor} · Run ${runId}`);

  const base = runSink(deps.queue, {
    projectId: req.projectId,
    cycleId: req.cycleId,
    deviceId: target.id,
    runId,
    executor: deps.executor,
    executorUid: deps.account.uid,
    hostId: deps.account.hostId,
    screen: info.size,
  });
  // 방금 찍은 스크린샷은 콘솔이 메모리에서 바로 보여 준다 (스텝 썸네일)
  const sink = {
    ...base,
    saveScreenshot: async (png: Uint8Array, ctx: Parameters<typeof base.saveScreenshot>[1]) => {
      const shot = await base.saveScreenshot(png, ctx);
      if (shot.kind === 'storage') hub.keepShot(shot.path, png);
      return shot;
    },
  };

  async function waitFor<T>(level: 'approval' | 'human', wait: () => Promise<T>): Promise<T> {
    await sink.waiting(level).catch(() => {});
    try {
      return await wait();
    } finally {
      await sink.waiting(undefined).catch(() => {});
    }
  }

  async function start(): Promise<CycleRunOutcome> {
    // 이 Run에 배정된 테스트 계정 비밀값 (메모리에만, 반납·Run 종료 때 비운다). LLM 요청에 섞이면 보내지 않는다 (F-EX-09)
    const vault = new SecretVault();
    const inner = deps.llm
      ? withSecretGuard(deps.llm(meter), vault)
      : createLlm({
          mode: 'live',
          cassetteDir: '',
          meter,
          vault,
          onRetry: (r) => {
            log(`  Claude Code 재시도 ${r.attempt}/${r.maxRetries} — ${r.reason}`);
            hub.llmRetry(r);
          },
        });
    // 모델 응답을 기다리는 동안을 콘솔에 알린다 (오래 걸리면 실행자가 알 수 있게)
    const llm: LlmClient = {
      create: async (r, m) => {
        hub.llmStarted(TURN_TIMEOUT_MS);
        try {
          return await inner.create(r, m);
        } finally {
          hub.llmEnded();
        }
      },
    };
    // Run 동안 화면이 꺼지며 잠기지 않게 한다 (끝나면 되돌림)
    const { release, changed } = await holdAwake(deps.device, info.serial, { dir: deps.awakeDir, log }).catch(
      (e: Error) => {
        log(`화면 켜짐 유지를 켜지 못했습니다: ${e.message}`);
        return { release: async () => {}, changed: false };
      },
    );
    hub.setStayAwake(changed);
    const out = await runCycle({
      api,
      sink,
      drainTimeoutMs: 60_000,
      env: {
        ...deps.env,
        device: deps.device,
        llm,
        vault,
        appPackage,
        allowNetworkToggle: req.allowNetworkToggle,
        onThought: (t) => {
          if (t.kind !== 'observe') log(`  ${(t.at / 1000).toFixed(1).padStart(5)}s [${t.kind}] ${t.text}`);
          hub.thought(t);
          const cur = hub.snapshot().current;
          hub.usage({
            tokens: meter.run.tokens,
            costUsd: meter.run.costUsd,
            caseTokens: cur ? meter.forCase(cur.tcId).tokens : 0,
          });
        },
        onStep: hub.step,
        control: hub,
        // 실행자를 기다리는 동안 웹에 "승인 대기"·"실행자 대기"를 보인다 (승인은 로컬 콘솔에서만, F-EX-10)
        onManual: (instruction) => waitFor('human', () => hub.onManual(instruction)),
        onRisk: (req) => waitFor(req.level, () => hub.onRisk(req)),
      },
      projectId: req.projectId,
      cycleId: req.cycleId,
      deviceId: target!.id,
      runId,
      tcIds,
      // 고른 칸은 결과가 있어도 다시 돌린다. 고르지 않았으면(남은 전체) 결과가 있는 칸은 건너뛴다
      skipDone: Boolean(req.resumeRunId) || !tcIds,
      meter,
      onCase: (tc, r) => {
        log(`■ ${tc.tcId} ${tc.title}: ${r.verdict}${r.blockedReason ? ` — ${r.blockedReason}` : ''}`);
        hub.caseFinished(tc, r);
      },
      onQueue: (cases) => hub.setQueue(cases),
      onCaseStart: (tc) => hub.caseStarted(tc),
      onPhase: (p) => hub.phase(p),
      accounts: deps.accounts,
      log,
    }).finally(async () => {
      await release();
      hub.setStayAwake(false);
    });
    if (out.pendingUploads) {
      log(`업로드 ${out.pendingUploads}건이 아직 남았습니다 — 로컬 큐에 보관했고 다음 실행 때 이어서 보냅니다`);
    }
    hub.runEnded(out.status, out.status === 'paused' ? out.message : undefined);
    return { ...out, runId, cycleName: cycle.name, costUsd: meter.run.costUsd };
  }

  return { hub, runId, cycle, build, target, start };
}

export function consoleDevice(info: DeviceInfo, status: 'idle' | 'running') {
  return {
    serial: info.serial,
    model: info.model,
    osBuild: String(info.osMajor),
    resolution: `${info.size.w}×${info.size.h}`,
    connection: info.connection === 'wifi' ? ('Wi-Fi' as const) : ('USB' as const),
    status,
  };
}
