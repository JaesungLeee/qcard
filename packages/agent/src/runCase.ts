import { DeviceDisconnectedError, type NetworkKind } from '@qcard/device';
import { ClaudeCodeSetupError, PlanLimitError, type UsageMeter } from '@qcard/llm';
import type { CaseResult, PrepFlow, TestCase } from '@qcard/shared';
import { clockOf, RunAbortedError, thought, type AgentEnv } from './env';
import { runSteps } from './executor';
import { judge } from './judge';
import { settle, verifyPoints } from './verify';

/*
 * 케이스 하나 실행: 준비(F-PF-02·03) → 단계 수행 → 검증 포인트 판정 → 집계 → CaseResult.
 */

export type RunCaseInput = {
  testCase: TestCase;
  prepFlows: PrepFlow[];
  deviceId: string;
  runId?: string;
  /** 사용량을 케이스 단위로 기록 (tokens·costUsd) */
  meter?: UsageMeter;
  /** 단계가 바뀔 때 (단계별 시간·비용 측정용) */
  onPhase?: (phase: 'prep' | 'steps' | 'verify') => void;
};

/**
 * 준비: 클린 상태면 앱 데이터 초기화, 아니면 앱 재시작. 그다음 UI 준비 플로우를 Agent가 수행.
 * 실패하면 사유를, 성공하면 다음 관찰 번호를 돌려준다.
 */
export async function prepare(
  env: AgentEnv,
  tc: TestCase,
  flows: PrepFlow[],
): Promise<{ failed: string } | { nextIndex: number }> {
  const start = clockOf(env).now();
  const used = tc.prepFlowIds.map((id) => flows.find((f) => f.id === id));
  const missing = tc.prepFlowIds.find((_, i) => !used[i]);
  if (missing) return { failed: `준비 플로우 없음: ${missing}` };
  const d = env.device;
  if (tc.cleanState || used.some((f) => f!.kind === 'env')) {
    thought(env, start, 'system', '준비: 앱 데이터 초기화 후 실행');
    await d.clearAppData(env.appPackage);
  } else {
    thought(env, start, 'system', '준비: 앱 재시작');
    await d.stopApp(env.appPackage);
  }
  await d.launchApp(env.appPackage);

  let nextIndex = 0;
  for (const f of used) {
    if (!f || f.kind === 'env') continue;
    thought(env, start, 'system', `준비 플로우: ${f.name}`);
    const r = await runSteps(env, {
      caseId: tc.tcId,
      steps: f.steps.map((text) => ({ text, manual: false })),
      context: `준비 플로우 "${f.name}"를 수행한다. 끝나면 이 상태여야 한다: ${f.check}`,
      firstIndex: nextIndex,
    });
    if (r.status !== 'done') return { failed: `준비 플로우 실패: ${f.name} (${r.reason ?? r.status})` };
    nextIndex = r.nextIndex;
  }
  return { nextIndex };
}

/**
 * 케이스 실행. Agent가 끈 네트워크는 성공·실패와 상관없이 끝날 때 다시 켠다 (F-EX-16 원복).
 * 복구에 실패하면 던진다 — 다음 케이스를 네트워크 없이 돌리지 않게.
 */
export async function runCase(env: AgentEnv, input: RunCaseInput): Promise<CaseResult> {
  const off = new Set<NetworkKind>();
  const target = env.device;
  const device = new Proxy(target, {
    get(t, prop) {
      if (prop === 'setNetwork') {
        return async (kind: NetworkKind, enabled: boolean) => {
          await t.setNetwork(kind, enabled);
          if (enabled) off.delete(kind);
          else off.add(kind);
        };
      }
      const v = Reflect.get(t, prop, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  try {
    return await runCaseInner({ ...env, device }, input);
  } finally {
    for (const kind of off) {
      thought(env, clockOf(env).now(), 'system', `환경 원복: ${kind === 'wifi' ? 'Wi-Fi' : '모바일 데이터'} 켬`);
      await target.setNetwork(kind, true);
    }
  }
}

async function runCaseInner(env: AgentEnv, input: RunCaseInput): Promise<CaseResult> {
  const { testCase: tc, meter } = input;
  const clock = clockOf(env);
  const startedAt = new Date(clock.now()).toISOString();
  const info = await env.device.info();
  const result = (r: Partial<CaseResult> & Pick<CaseResult, 'verdict'>): CaseResult => {
    const usage = meter?.forCase(tc.tcId);
    return {
      tcId: tc.tcId,
      deviceId: input.deviceId,
      autoConfirmed: false,
      unmetConditions: [],
      attempts: 1,
      executor: 'agent',
      executedAt: startedAt,
      osBuild: `Android ${info.osMajor}`,
      runId: input.runId,
      steps: [],
      points: [],
      history: [],
      decidedBy: { kind: 'agent' },
      ...(usage ? { tokens: usage.tokens, costUsd: usage.costUsd } : {}),
      ...r,
    };
  };

  try {
    input.onPhase?.('prep');
    const prep = await prepare(env, tc, input.prepFlows);
    if ('failed' in prep) return result({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: prep.failed });

    input.onPhase?.('steps');
    const exec = await runSteps(env, {
      caseId: tc.tcId,
      steps: tc.steps,
      firstIndex: prep.nextIndex,
      context: [
        `케이스: ${tc.title}`,
        tc.preconditions.length ? `사전조건: ${tc.preconditions.join(' / ')}` : '',
        tc.data ? `데이터: ${tc.data}` : '',
        tc.verificationPoints.length
          ? `기대 결과(무엇을 확인하는 케이스인지 참고. 판정은 따로 한다):\n${tc.verificationPoints.map((p) => `- ${p.expected}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (exec.status !== 'done') {
      const j = judge(exec, []);
      return result({
        verdict: j.verdict,
        agentVerdict: j.agentVerdict,
        unmetConditions: j.unmet,
        blockedReason: exec.status === 'blocked' ? exec.reason : undefined,
        actualSummary: exec.status === 'fail' ? exec.reason : undefined,
        steps: exec.steps,
      });
    }

    input.onPhase?.('verify');
    const evidence = await settle(env, { caseId: tc.tcId, evidence: exec.evidence, nextIndex: exec.nextIndex });
    const points = await verifyPoints(env, { caseId: tc.tcId, points: tc.verificationPoints, evidence });
    const start = clock.now();
    for (const p of points) thought(env, start, 'verify', `${p.pointId} ${p.result} · ${p.reason}`);
    const j = judge(exec, points);
    const misses = points.filter((p) => p.result !== 'match');
    return result({
      verdict: j.verdict,
      agentVerdict: j.agentVerdict,
      autoConfirmed: j.autoConfirmed,
      unmetConditions: j.unmet,
      actualSummary: misses.length ? misses.map((p) => `${p.expected} → ${p.observed}`).join(' / ') : undefined,
      steps: exec.steps,
      points,
    });
  } catch (e) {
    // 플랜 한도·Claude Code 로그인은 케이스 결함이 아니다. 판정하지 않고 Run을 일시정지하게 던진다 (F-EX-17)
    if (
      e instanceof PlanLimitError ||
      e instanceof ClaudeCodeSetupError ||
      e instanceof RunAbortedError ||
      e instanceof DeviceDisconnectedError
    )
      throw e;
    // 서버 무응답·디바이스 연결 끊김 등 환경 오류 (F-EX-05)
    return result({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: `환경 오류: ${(e as Error).message}` });
  }
}
