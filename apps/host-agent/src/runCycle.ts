import { runCase, type AgentEnv } from '@qcard/agent';
import type { QcardApi } from '@qcard/data';
import { ClaudeCodeSetupError, PlanLimitError, type UsageMeter } from '@qcard/llm';
import type { CaseResult, PauseReason, TestCase } from '@qcard/shared';
import type { RunSink } from './sink';

/*
 * 사이클의 자동 케이스를 한 디바이스에서 차례로 실행하고 결과를 올린다 (PRD §4 ⑤⑥).
 * 플랜 한도·Claude Code 로그인 문제면 Run을 일시정지하고 멈춘다 (F-EX-17). 다시 부르면 남은 칸부터 이어 간다.
 */

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
  /** 끝날 때 남은 업로드를 기다릴 시간 (기본 무한). 지나면 큐에 남겨 두고 돌아온다 */
  drainTimeoutMs?: number;
};

export type RunCycleOutcome = ({ status: 'done' } | { status: 'paused'; reason: PauseReason; message: string }) & {
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

  const results: CaseResult[] = [];
  await sink.start();
  for (const testCase of cases) {
    await sink.progress(testCase.tcId);
    try {
      const result = await runCase(
        { ...input.env, saveScreenshot: sink.saveScreenshot },
        { testCase, prepFlows, deviceId, runId: input.runId, meter: input.meter },
      );
      await sink.result(result);
      results.push(result);
      input.onCase?.(testCase, result);
    } catch (e) {
      const reason: PauseReason | undefined =
        e instanceof PlanLimitError
          ? 'plan_limit'
          : e instanceof ClaudeCodeSetupError
            ? e.reason === 'outdated'
              ? 'claude_outdated'
              : 'not_logged_in'
            : undefined;
      if (!reason) throw e;
      await sink.pause(reason);
      const pendingUploads = await sink.drain(input.drainTimeoutMs);
      return { status: 'paused', reason, message: (e as Error).message, results, pendingUploads };
    }
  }
  await sink.finish();
  const pendingUploads = await sink.drain(input.drainTimeoutMs);
  return { status: 'done', results, pendingUploads };
}
