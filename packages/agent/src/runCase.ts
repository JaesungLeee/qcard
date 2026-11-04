import { DeviceDisconnectedError, type DeviceInfo, type NetworkKind } from '@qcard/device';
import { ClaudeCodeSetupError, PlanLimitError, type UsageMeter } from '@qcard/llm';
import type { CaseResult, PrepFlow, TestCase } from '@qcard/shared';
import { clockOf, RunAbortedError, thought, type AgentEnv } from './env';
import { runSteps } from './executor';
import { judge } from './judge';
import { settle, verifyPoints } from './verify';

/*
 * 케이스 하나 실행: 준비 → 단계 수행 → 검증 포인트 판정 → 집계 → CaseResult → 원복.
 */

/** 테스트 계정 비밀값의 플레이스홀더 이름 (호스트가 vault에 이 이름으로 넣는다) */
export const ACCOUNT_SECRET = { password: 'password', totp: 'totp' } as const;

/** 배정받은 테스트 계정. 로그인 ID는 화면에 보이는 값이라 그대로 알려 준다 */
export type CaseAccount = { kind: string; loginId: string; totp: boolean };

/**
 * `login_failed`: 앱이 계정 정보를 거절했다 — 그 계정을 다시 배정하지 않는다.
 * `login_flow_failed`: 계정 탓이 아닌 이유로 로그인 플로우를 끝내지 못했다 (요소를 못 찾음 등).
 * `restore_failed`: 원복 실패 — 계정을 격리한다
 */
export type AccountIssue = 'login_failed' | 'login_flow_failed' | 'restore_failed';

/** Agent에 알려 줄 계정 안내. 비밀값은 플레이스홀더만 */
export function accountContext(a: CaseAccount): string {
  const totp = a.totp ? `, 인증 앱(OTP) 코드 {{secret.${ACCOUNT_SECRET.totp}}}` : '';
  return `테스트 계정(${a.kind}): 로그인 ID ${a.loginId}, 비밀번호 {{secret.${ACCOUNT_SECRET.password}}}${totp}. 비밀값은 플레이스홀더 그대로 input_text에 넣는다.`;
}

export type RunCaseInput = {
  testCase: TestCase;
  prepFlows: PrepFlow[];
  deviceId: string;
  runId?: string;
  /** 사용량을 케이스 단위로 기록 (tokens·costUsd) */
  meter?: UsageMeter;
  /** 단계가 바뀔 때 (단계별 시간·비용 측정용) */
  onPhase?: (phase: 'prep' | 'steps' | 'verify') => void;
  /** 배정받은 테스트 계정. 비밀값은 env.vault에 ACCOUNT_SECRET 이름으로 들어 있어야 한다 */
  account?: CaseAccount;
  /** 로그인 준비 플로우 실패·원복 실패. 호스트가 계정에 표시하거나 격리해 반납한다 */
  onAccountIssue?: (issue: AccountIssue, detail: string) => void;
  /** 디바이스가 다른 테스트 계정으로 로그인돼 있을 수 있다 — 클린 상태가 아니어도 앱 데이터를 초기화한다 */
  resetApp?: boolean;
};

/**
 * 준비: 클린 상태면 앱 데이터 초기화, 아니면 앱 재시작. 그다음 UI 준비 플로우를 Agent가 수행.
 * 실패하면 사유를, 성공하면 다음 관찰 번호를 돌려준다.
 */
export async function prepare(
  env: AgentEnv,
  tc: TestCase,
  flows: PrepFlow[],
  account?: CaseAccount,
  resetApp = false,
): Promise<{ failed: string; flow?: PrepFlow; authRejected?: boolean } | { nextIndex: number }> {
  const start = clockOf(env).now();
  const used = tc.prepFlowIds.map((id) => flows.find((f) => f.id === id));
  const missing = tc.prepFlowIds.find((_, i) => !used[i]);
  if (missing) return { failed: `준비 플로우 없음: ${missing}` };
  const d = env.device;
  if (tc.cleanState || resetApp || used.some((f) => f!.kind === 'env')) {
    thought(
      env,
      start,
      'system',
      tc.cleanState || !resetApp
        ? '준비: 앱 데이터 초기화 후 실행'
        : '준비: 이전 테스트 계정을 지우려고 앱 데이터 초기화 후 실행',
    );
    await d.clearAppData(env.appPackage);
  } else {
    thought(env, start, 'system', '준비: 앱 재시작');
    await d.stopApp(env.appPackage);
  }
  await d.launchApp(env.appPackage);

  let nextIndex = 0;
  for (const f of used) {
    if (!f || f.kind === 'env' || f.kind === 'restore') continue;
    thought(env, start, 'system', `준비 플로우: ${f.name}`);
    const r = await runSteps(env, {
      caseId: tc.tcId,
      steps: f.steps.map((text) => ({ text, manual: false })),
      context: withAccount(
        `준비 플로우 "${f.name}"를 수행한다. 끝나면 이 상태여야 한다: ${f.check}${f.kind === 'login' ? `\n${LOGIN_RULE}` : ''}`,
        account,
      ),
      firstIndex: nextIndex,
    });
    if (r.status !== 'done') {
      return {
        failed: `준비 플로우 실패: ${f.name} (${r.reason ?? r.status})`,
        flow: f,
        ...(f.kind === 'login' && r.gaveUp === 'prep_failed' ? { authRejected: true } : {}),
      };
    }
    nextIndex = r.nextIndex;
  }
  return { nextIndex };
}

/** 로그인 플로우에서 계정 탓(인증 거부)과 그 밖의 실패를 구분하게 한다 */
const LOGIN_RULE =
  '앱이 입력한 계정 정보를 거절하면(비밀번호 오류, 없는 계정, 계정 잠김 같은 메시지) 다시 시도하지 말고 give_up(kind=prep_failed)를 부른다. 다른 이유로 진행할 수 없으면 give_up(kind=stuck).';

const withAccount = (context: string, a?: CaseAccount) => (a ? `${context}\n${accountContext(a)}` : context);

/** 원복 관찰 번호는 검증 대기(settle) 관찰과 겹치지 않게 띄운다 */
const RESTORE_INDEX_GAP = 100;

/**
 * 원복 플로우: 케이스가 바꾼 계정 상태를 되돌린다. 판정과 상관없이 준비가 끝난 케이스면 수행한다.
 * 실패하면 사유를 돌려준다 (호스트가 계정을 격리한다). 원복 결과는 판정에 영향을 주지 않는다
 */
async function restore(
  env: AgentEnv,
  tc: TestCase,
  flows: PrepFlow[],
  account: CaseAccount | undefined,
  firstIndex: number,
): Promise<string | undefined> {
  const start = clockOf(env).now();
  const f = flows.find((x) => x.id === tc.restoreFlowId);
  if (!f) return `원복 플로우 없음: ${tc.restoreFlowId}`;
  thought(env, start, 'system', `원복 플로우: ${f.name}`);
  const r = await runSteps(env, {
    caseId: tc.tcId,
    steps: f.steps.map((text) => ({ text, manual: false })),
    context: withAccount(
      `원복 플로우 "${f.name}": 케이스가 바꾼 계정 상태를 되돌린다. 끝나면 이 상태여야 한다: ${f.check}`,
      account,
    ),
    firstIndex,
  });
  if (r.status === 'done') return undefined;
  return `${f.name}: ${r.reason ?? r.status}`;
}

/**
 * 케이스 실행. Agent가 끈 네트워크는 성공·실패와 상관없이 끝날 때 다시 켠다.
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

/**
 * 결과에 남길 OS 빌드: `Android 15 · AP3A.240905.015.A2 · 보안 패치 2024-10-01`.
 * 대상은 모델 + OS 메이저로 맞추고, 정확한 빌드·보안 패치는 여기에 기록한다. 읽지 못한 값은 뺀다
 */
export function osBuildOf(info: Pick<DeviceInfo, 'osMajor' | 'build' | 'securityPatch'>): string {
  return [`Android ${info.osMajor}`, info.build, info.securityPatch && `보안 패치 ${info.securityPatch}`]
    .filter(Boolean)
    .join(' · ');
}

type ResultOf = (r: Partial<CaseResult> & Pick<CaseResult, 'verdict'>) => CaseResult;

/** 이 케이스의 결과를 만드는 함수 (시작 시각·디바이스 OS·사용량을 채운다) */
async function resultOf(env: AgentEnv, input: Pick<RunCaseInput, 'testCase' | 'deviceId' | 'runId' | 'meter'>) {
  const { testCase: tc, meter } = input;
  const startedAt = new Date(clockOf(env).now()).toISOString();
  const info = await env.device.info();
  const result: ResultOf = (r) => {
    const usage = meter?.forCase(tc.tcId);
    return {
      tcId: tc.tcId,
      deviceId: input.deviceId,
      autoConfirmed: false,
      unmetConditions: [],
      attempts: 1,
      executor: 'agent',
      executedAt: startedAt,
      osBuild: osBuildOf(info),
      runId: input.runId,
      steps: [],
      points: [],
      history: [],
      decidedBy: { kind: 'agent' },
      ...(usage ? { tokens: usage.tokens, costUsd: usage.costUsd } : {}),
      ...r,
    };
  };
  return result;
}

/** 실행하지 않고 Blocked로 끝내는 케이스 (예: 배정할 테스트 계정이 없음) */
export async function blockedCase(
  env: AgentEnv,
  input: Pick<RunCaseInput, 'testCase' | 'deviceId' | 'runId'>,
  reason: string,
): Promise<CaseResult> {
  return (await resultOf(env, input))({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: reason });
}

async function runCaseInner(env: AgentEnv, input: RunCaseInput): Promise<CaseResult> {
  const { testCase: tc, meter } = input;
  const clock = clockOf(env);
  const result = await resultOf(env, input);

  try {
    input.onPhase?.('prep');
    const prep = await prepare(env, tc, input.prepFlows, input.account, input.resetApp);
    if ('failed' in prep) {
      if (input.account && prep.flow?.kind === 'login') {
        // 앱이 계정 정보를 거절했으면 그 계정을 다시 배정하지 않게 알린다. 그 밖의 실패는 플로우 탓일 수 있다
        input.onAccountIssue?.(prep.authRejected ? 'login_failed' : 'login_flow_failed', prep.failed);
        if (prep.authRejected) {
          return result({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: `로그인 실패: ${prep.failed}` });
        }
      }
      return result({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: prep.failed });
    }

    const out = await afterPrep(env, input, prep.nextIndex, result);
    if (tc.restoreFlowId) {
      const failed = await restore(env, tc, input.prepFlows, input.account, out.nextIndex + RESTORE_INDEX_GAP);
      if (failed) {
        thought(env, clock.now(), 'system', `원복 실패 — 계정을 격리합니다: ${failed}`);
        input.onAccountIssue?.('restore_failed', failed);
      }
      // 원복에 쓴 사용량도 이 케이스 몫이다
      const usage = meter?.forCase(tc.tcId);
      if (usage) return { ...out.result, tokens: usage.tokens, costUsd: usage.costUsd };
    }
    return out.result;
  } catch (e) {
    // 플랜 한도·Claude Code 로그인은 케이스 결함이 아니다. 판정하지 않고 Run을 일시정지하게 던진다
    if (
      e instanceof PlanLimitError ||
      e instanceof ClaudeCodeSetupError ||
      e instanceof RunAbortedError ||
      e instanceof DeviceDisconnectedError
    )
      throw e;
    // 서버 무응답·디바이스 연결 끊김 등 환경 오류
    return result({ verdict: 'blocked', agentVerdict: 'blocked', blockedReason: `환경 오류: ${(e as Error).message}` });
  }
}

/** 준비가 끝난 뒤: 단계 수행 → 검증 → 집계. 원복이 이어 쓸 관찰 번호를 함께 돌려준다 */
async function afterPrep(
  env: AgentEnv,
  input: RunCaseInput,
  firstIndex: number,
  result: ResultOf,
): Promise<{ result: CaseResult; nextIndex: number }> {
  const { testCase: tc } = input;
  const clock = clockOf(env);
  {
    input.onPhase?.('steps');
    const exec = await runSteps(env, {
      caseId: tc.tcId,
      steps: tc.steps,
      firstIndex,
      context: [
        `케이스: ${tc.title}`,
        tc.preconditions.length ? `사전조건: ${tc.preconditions.join(' / ')}` : '',
        tc.data ? `데이터: ${tc.data}` : '',
        tc.verificationPoints.length
          ? `기대 결과(무엇을 확인하는 케이스인지 참고. 판정은 따로 한다):\n${tc.verificationPoints.map((p) => `- ${p.expected}`).join('\n')}`
          : '',
        input.account ? accountContext(input.account) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (exec.status !== 'done') {
      const j = judge(exec, [], env.limits?.retryLimit);
      const r = result({
        verdict: j.verdict,
        agentVerdict: j.agentVerdict,
        unmetConditions: j.unmet,
        blockedReason: exec.status === 'blocked' ? exec.reason : undefined,
        actualSummary: exec.status === 'fail' ? exec.reason : undefined,
        steps: exec.steps,
      });
      return { result: r, nextIndex: exec.nextIndex };
    }

    input.onPhase?.('verify');
    const evidence = await settle(env, { caseId: tc.tcId, evidence: exec.evidence, nextIndex: exec.nextIndex });
    const points = await verifyPoints(env, { caseId: tc.tcId, points: tc.verificationPoints, evidence });
    const start = clock.now();
    for (const p of points) thought(env, start, 'verify', `${p.pointId} ${p.result} · ${p.reason}`);
    const j = judge(exec, points, env.limits?.retryLimit);
    const misses = points.filter((p) => p.result !== 'match');
    const r = result({
      verdict: j.verdict,
      agentVerdict: j.agentVerdict,
      autoConfirmed: j.autoConfirmed,
      unmetConditions: j.unmet,
      actualSummary: misses.length ? misses.map((p) => `${p.expected} → ${p.observed}`).join(' / ') : undefined,
      steps: exec.steps,
      points,
    });
    return { result: r, nextIndex: exec.nextIndex };
  }
}
