import { blockedCase, runCase, RunAbortedError, type AccountIssue, type AgentEnv } from '@qcard/agent';
import type { QcardApi } from '@qcard/data';
import { ClaudeCodeSetupError, PlanLimitError, type UsageMeter } from '@qcard/llm';
import { DeviceDisconnectedError } from '@qcard/device';
import { RUN_HEARTBEAT_MS, type CaseResult, type PauseReason, type TestCase } from '@qcard/shared';
import { RunAccounts, type AccountLeaser } from './accounts';
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
  /**
   * 일시정지된 Run을 이어서: tcIds(그 Run의 큐)가 있으면 이 Run에서 결과를 낸 칸만, 없으면 결과가 있는 칸을 모두 건너뛴다.
   * 다시 실행하려고 고른 칸(이전 결과 있음)이 이어서 실행할 때 빠지지 않게
   */
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
  /** 테스트 계정 배정·반납 (F-PF-04). 없으면 계정이 필요한 케이스는 Blocked. 비밀값은 env.vault에 둔다 */
  accounts?: AccountLeaser;
  log?: (line: string) => void;
};

export type RunCycleOutcome = (
  { status: 'done' | 'aborted' } | { status: 'paused'; reason: PauseReason; message: string }
) & {
  results: CaseResult[];
  /** 아직 보내지 못한 업로드 (로컬 큐에 남아 다음 실행이 보낸다) */ pendingUploads: number;
};

/** 계정 종류·준비 상태가 같은 케이스끼리 묶고, 묶음 안에서는 문서 순서 (F-EX-11). 같은 계정을 이어 쓰게 한다 */
export function runOrder(cases: TestCase[]): TestCase[] {
  const key = (c: TestCase) => `${c.accountKind ?? ''}|${c.prepFlowIds.join('+')}`;
  const groups = [...new Set(cases.map(key))];
  return [...cases].sort((a, b) => groups.indexOf(key(a)) - groups.indexOf(key(b)));
}

export async function runCycle(input: RunCycleInput): Promise<RunCycleOutcome> {
  const { api, sink, projectId, cycleId, deviceId } = input;
  const [detail, prepFlows] = await Promise.all([api.getCycle({ projectId, cycleId }), api.listPrepFlows(projectId)]);
  if (!detail.cycle.targets.some((t) => t.id === deviceId)) {
    throw new Error(`이 사이클의 대상 디바이스가 아닙니다: ${deviceId}`);
  }
  const done = new Set(
    detail.results
      .filter((r) => r.deviceId === deviceId && r.verdict !== 'nt' && (!input.tcIds || r.runId === input.runId))
      .map((r) => r.tcId),
  );
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
  const accounts = new RunAccounts({
    leaser: input.accounts,
    vault: input.env.vault,
    projectId,
    cycleId,
    runId: input.runId,
    log: input.log,
  });
  await sink.start(cases.map((c) => c.tcId));
  // 호스트가 살아 있다는 신호 (F-DV-04): 끊기면 웹은 "호스트 연결 끊김"으로 보이고, 다시 켠 호스트가 일시정지로 정리한다
  const beat = setInterval(() => void sink.heartbeat().catch(() => {}), RUN_HEARTBEAT_MS);
  beat.unref?.();
  try {
    for (const testCase of cases) {
      const before = await deviceProblem();
      if (before) return paused(before.reason, before.message);
      await sink.progress(testCase.tcId);
      input.onCaseStart?.(testCase);
      const env = { ...input.env, saveScreenshot: sink.saveScreenshot };
      // 테스트 계정 (F-PF-04): 받지 못하면 실행하지 않고 Blocked("계정 없음")
      const acc = await accounts.forCase(testCase);
      if ('blocked' in acc) {
        const result = await blockedCase(env, { testCase, deviceId, runId: input.runId }, acc.blocked);
        await sink.result(result);
        results.push(result);
        input.onCase?.(testCase, result);
        continue;
      }
      try {
        const issues: [AccountIssue, string][] = [];
        const result = await runCase(env, {
          testCase,
          prepFlows,
          deviceId,
          runId: input.runId,
          meter: input.meter,
          onPhase: input.onPhase,
          account: acc.account,
          resetApp: acc.resetApp,
          onAccountIssue: (issue, detail) => issues.push([issue, detail]),
        });
        if (result.verdict === 'blocked') {
          const during = await deviceProblem();
          if (during) return paused(during.reason, `${testCase.tcId} 실행 중 ${during.message}`);
        }
        // 디바이스 문제가 아닐 때만 계정 탓으로 본다 (잠긴 화면에서 로그인 실패로 표시하지 않게)
        for (const [issue, detail] of issues) await accounts.issue(issue, detail);
        accounts.caseEnded();
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
  } finally {
    clearInterval(beat);
    await accounts.finish();
  }
}
