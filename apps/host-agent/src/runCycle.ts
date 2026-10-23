import { runCase, RunAbortedError, type AgentEnv } from '@qcard/agent';
import type { QcardApi } from '@qcard/data';
import { ClaudeCodeSetupError, PlanLimitError, type UsageMeter } from '@qcard/llm';
import { DeviceDisconnectedError } from '@qcard/device';
import type { CaseResult, PauseReason, TestCase } from '@qcard/shared';
import type { RunSink } from './sink';

/*
 * 사이클의 자동 케이스를 한 디바이스에서 차례로 실행하고 결과를 올린다 (PRD §4 ⑤⑥).
 * 플랜 한도·Claude Code 로그인 문제면 Run을 일시정지하고 멈춘다 (F-EX-17). 다시 부르면 남은 칸부터 이어 간다.
 * 디바이스 화면이 꺼졌거나 잠겨 있거나 연결이 끊겨도 일시정지한다: 케이스마다 시작 전에 확인하고, Blocked로 끝난 케이스는
 * 도중에 잠긴 것인지 다시 확인해 그 결과는 버린다 (잠금 화면에서 헤매며 사용량만 쓰고 Blocked가 쌓이지 않게).
 */

const DISCONNECTED = '디바이스 연결이 끊겼습니다. USB를 다시 연결한 뒤 이어서 실행하세요';

export type RunCycleInput = {
  api: QcardApi;
  sink: RunSink;
  /** saveScreenshot은 sink가 채운다 */
  env: Omit<AgentEnv, 'saveScreenshot'>;
  projectId: string;
  cycleId: string;
  deviceId: string;
  runId: string;
  /** 지정하면 이 케이스만 */
  tcIds?: string[];
  /** 이미 결과가 있는 칸은 건너뛴다 (일시정지 후 재개) */
  skipDone?: boolean;
  /** 사용량·실행 한도 (F-EX-12). 케이스별로 집계되고, env.llm도 같은 미터로 감싸야 한도가 걸린다 */
  meter?: UsageMeter;
  onCase?: (tc: TestCase, result: CaseResult) => void;
  /** 실행할 케이스가 정해졌을 때 (로컬 콘솔 큐) */
  onQueue?: (cases: TestCase[]) => void;
  onCaseStart?: (tc: TestCase) => void;
  onPhase?: (phase: 'prep' | 'steps' | 'verify') => void;
  /** 끝날 때 남은 업로드를 기다릴 시간 (기본 무한). 지나면 큐에 남겨 두고 돌아온다 */
  drainTimeoutMs?: number;
};

export type RunCycleOutcome = (
  { status: 'done' | 'aborted' } | { status: 'paused'; reason: PauseReason; message: string }
) & {
  results: CaseResult[];
  /** 아직 보내지 못한 업로드 (로컬 큐에 남아 다음 실행이 보낸다) */ pendingUploads: number;
};

/** 준비 상태가 같은 케이스끼리 묶고, 묶음 안에서는 문서 순서 (F-EX-11) */
export function runOrder(cases: TestCase[]): TestCase[] {
  const groups = [...new Set(cases.map((c) => c.prepFlowIds.join('+')))];
  return [...cases].sort((a, b) => groups.indexOf(a.prepFlowIds.join('+')) - groups.indexOf(b.prepFlowIds.join('+')));
}

export async function runCycle(input: RunCycleInput): Promise<RunCycleOutcome> {
  const { api, sink, projectId, cycleId, deviceId } = input;
  const [detail, prepFlows] = await Promise.all([api.getCycle({ projectId, cycleId }), api.listPrepFlows(projectId)]);
  if (!detail.cycle.targets.some((t) => t.id === deviceId)) {
    throw new Error(`이 사이클의 대상 디바이스가 아닙니다: ${deviceId}`);
  }
  const done = new Set(detail.results.filter((r) => r.deviceId === deviceId && r.verdict !== 'nt').map((r) => r.tcId));
  const cases = runOrder(
    detail.cases.filter(
      (c) =>
        c.mode === 'auto' && (!input.tcIds || input.tcIds.includes(c.tcId)) && !(input.skipDone && done.has(c.tcId)),
    ),
  );

  input.onQueue?.(cases);
  const results: CaseResult[] = [];
  const paused = async (reason: PauseReason, message: string): Promise<RunCycleOutcome> => {
    await sink.pause(reason);
    const pendingUploads = await sink.drain(input.drainTimeoutMs);
    return { status: 'paused', reason, message, results, pendingUploads };
  };
  /** 디바이스를 쓸 수 없는 상태 (잠김·꺼짐·연결 끊김) */
  const deviceProblem = async (): Promise<{ reason: PauseReason; message: string } | undefined> => {
    try {
      const s = await input.env.device.screenState();
      if (s.awake && !s.locked) return undefined;
      return {
        reason: 'device_locked',
        message: `디바이스 화면이 ${s.awake ? '잠겨' : '꺼져'} 있습니다. 잠금을 풀고 화면을 켜 둔 채 다시 실행하세요 (개발자 옵션 "충전 중 화면 켜짐 유지"를 켜 두면 편합니다)`,
      };
    } catch (e) {
      if (e instanceof DeviceDisconnectedError) return { reason: 'device_disconnected', message: DISCONNECTED };
      throw e;
    }
  };
  await sink.start();
  for (const testCase of cases) {
    const before = await deviceProblem();
    if (before) return paused(before.reason, before.message);
    await sink.progress(testCase.tcId);
    input.onCaseStart?.(testCase);
    try {
      const result = await runCase(
        { ...input.env, saveScreenshot: sink.saveScreenshot },
        { testCase, prepFlows, deviceId, runId: input.runId, meter: input.meter, onPhase: input.onPhase },
      );
      if (result.verdict === 'blocked') {
        const during = await deviceProblem();
        if (during) return paused(during.reason, `${testCase.tcId} 실행 중 ${during.message}`);
      }
      await sink.result(result);
      results.push(result);
      input.onCase?.(testCase, result);
    } catch (e) {
      // 실행자가 중단: 진행 중 케이스는 판정하지 않고 Run을 끝낸다 (남은 칸은 N/T로 남는다)
      if (e instanceof RunAbortedError) {
        await sink.finish('aborted');
        return { status: 'aborted', results, pendingUploads: await sink.drain(input.drainTimeoutMs) };
      }
      const reason: PauseReason | undefined =
        e instanceof PlanLimitError
          ? 'plan_limit'
          : e instanceof ClaudeCodeSetupError
            ? e.reason === 'outdated'
              ? 'claude_outdated'
              : 'not_logged_in'
            : undefined;
      // 실행 중 연결이 끊김: 진행 중 케이스 결과는 쓰지 않는다 (이어서 실행하면 그 케이스부터)
      if (e instanceof DeviceDisconnectedError) {
        return paused('device_disconnected', `${testCase.tcId} 실행 중 ${DISCONNECTED}`);
      }
      if (!reason) throw e;
      return paused(reason, (e as Error).message);
    }
  }
  await sink.finish();
  const pendingUploads = await sink.drain(input.drainTimeoutMs);
  return { status: 'done', results, pendingUploads };
}
