import { ACCOUNT_SECRET, type AccountIssue, type CaseAccount } from '@qcard/agent';
import { totpCode, type SecretVault } from '@qcard/llm';
import type { AccountSecret, TestAccount, TestCase } from '@qcard/shared';

/*
 * Run 하나의 테스트 계정 (F-PF-04·08·09, F-EX-09). 케이스마다 필요한 종류의 계정을 배정받고, 비밀값은 vault(메모리)에만 둔다.
 * 종류가 같으면 이어 쓰고, 바뀌거나 Run이 끝나면 반납한다. 로그인 실패·원복 실패는 표시·격리로 반납한다.
 * 한 종류의 로그인이 LOGIN_FAILURE_LIMIT번 실패하면 플로우 탓으로 보고 그 종류의 계정을 더 받지 않는다 — 계정을 차례로 태우지 않게.
 * 배정·반납은 Functions(claimAccount·releaseAccount)가 하고, 호스트는 그 Run을 실행 중일 때만 받을 수 있다.
 */

export type ClaimInput = {
  projectId: string;
  cycleId: string;
  runId: string;
  tcId: string;
  kind: string;
  restoring: boolean;
  accountId?: string;
};
export type ReleaseInput = {
  projectId: string;
  accountId: string;
  runId: string;
  outcome: 'ok' | Exclude<AccountIssue, 'login_flow_failed'>;
  detail?: string;
};

/** 배정·반납 (호스트 토큰으로 부르는 callable) */
export interface AccountLeaser {
  claim(input: ClaimInput): Promise<{ account: TestAccount; secret?: AccountSecret } | { account: null }>;
  release(input: ReleaseInput): Promise<void>;
}

export const callableLeaser = (call: <T>(name: string, data: unknown) => Promise<T>): AccountLeaser => ({
  claim: (input) => call('claimAccount', input),
  release: (input) => call('releaseAccount', input),
});

/** 한 Run에서 같은 종류의 로그인이 이만큼 실패하면 그 종류는 더 배정받지 않는다 */
export const LOGIN_FAILURE_LIMIT = 2;

export class RunAccounts {
  private held?: TestAccount;
  /** 디바이스가 로그인돼 있을 수 있는 계정 (마지막으로 실행한 케이스의 계정) */
  private signedIn?: string;
  /** 종류별 로그인 실패 횟수 */
  private readonly loginFailures = new Map<string, number>();
  /** 지금 케이스에 원복 플로우가 있다 — 이 상태로 Run이 멈추면 계정 상태를 알 수 없어 격리한다 */
  private restoring = false;

  constructor(
    private readonly opts: {
      leaser?: AccountLeaser;
      vault?: SecretVault;
      projectId: string;
      cycleId: string;
      runId: string;
      log?: (line: string) => void;
      /** TOTP 코드 계산용 실제 시각 (Agent의 가짜 시계와 따로) */
      now?: () => number;
    },
  ) {}

  /**
   * 케이스 시작 전: 필요한 종류의 계정을 받는다. 받을 수 없으면 Blocked 사유.
   * `resetApp`: 디바이스가 다른 계정으로 로그인돼 있을 수 있다 — 준비 때 앱 데이터를 초기화해야 한다
   */
  async forCase(tc: TestCase): Promise<{ account?: CaseAccount; resetApp: boolean } | { blocked: string }> {
    const kind = tc.accountKind;
    if (!kind) {
      await this.release('ok');
      return { resetApp: this.signIn(undefined) };
    }
    const { leaser, vault } = this.opts;
    if (!leaser || !vault) return { blocked: '계정 없음: 이 실행은 테스트 계정을 배정받을 수 없습니다' };
    if ((this.loginFailures.get(kind) ?? 0) >= LOGIN_FAILURE_LIMIT) {
      await this.release('ok');
      return {
        blocked: `로그인 플로우 확인 필요: 이 실행에서 ${kind} 계정 로그인이 ${LOGIN_FAILURE_LIMIT}번 실패해 더 배정받지 않습니다. 로그인 준비 플로우를 확인하세요`,
      };
    }
    if (this.held && this.held.kind !== kind) await this.release('ok');
    const claim = (accountId?: string) =>
      leaser.claim({
        projectId: this.opts.projectId,
        cycleId: this.opts.cycleId,
        runId: this.opts.runId,
        tcId: tc.tcId,
        kind,
        restoring: !!tc.restoreFlowId,
        ...(accountId ? { accountId } : {}),
      });
    let r: Awaited<ReturnType<AccountLeaser['claim']>>;
    try {
      if (this.held) {
        try {
          r = await claim(this.held.id);
        } catch (e) {
          // 이어 쓰던 계정을 잃었다 (연결 신호가 끊겨 배정이 풀렸거나 계정이 바뀜). 내려놓고 새로 받는다
          this.opts.log?.(`  테스트 계정 ${this.held.loginId}을(를) 이어 쓸 수 없어 새로 받습니다: ${(e as Error).message}`);
          await this.release('ok');
          r = await claim();
        }
      } else r = await claim();
    } catch (e) {
      return { blocked: `계정 없음: 테스트 계정을 배정받지 못했습니다 (${(e as Error).message})` };
    }
    if (!r.account) return { blocked: `계정 없음: ${kind} 종류의 빈 계정이 없습니다` };
    if (r.secret) {
      vault.clear();
      vault.set(ACCOUNT_SECRET.password, r.secret.password);
      const seed = r.secret.totpSeed;
      if (seed) vault.setDynamic(ACCOUNT_SECRET.totp, () => totpCode(seed, (this.opts.now ?? Date.now)()));
      this.opts.log?.(`  테스트 계정 ${r.account.loginId} (${kind})`);
    }
    this.held = r.account;
    this.restoring = !!tc.restoreFlowId;
    return {
      account: { kind, loginId: r.account.loginId, totp: r.account.usesTotp },
      resetApp: this.signIn(r.account.id),
    };
  }

  /** 이번 케이스가 쓸 계정을 기록하고, 디바이스에 다른 계정이 남아 있을 수 있는지 돌려준다 */
  private signIn(accountId: string | undefined) {
    const reset = this.signedIn !== undefined && this.signedIn !== accountId;
    this.signedIn = accountId;
    return reset;
  }

  /** 케이스가 끝났다 (원복까지) */
  caseEnded() {
    this.restoring = false;
  }

  /** 로그인 실패·원복 실패: 표시·격리로 반납한다. 계정 탓이 아닌 로그인 실패는 계정을 그대로 두고 횟수만 센다 */
  async issue(issue: AccountIssue, detail: string) {
    const kind = this.held?.kind;
    if (kind && issue !== 'restore_failed') this.loginFailures.set(kind, (this.loginFailures.get(kind) ?? 0) + 1);
    if (issue === 'login_flow_failed') return;
    await this.release(issue, detail);
  }

  /** Run이 끝나거나 멈출 때. 원복 플로우가 있는 케이스 도중이면 격리한다 (F-PF-09) */
  async finish() {
    if (this.restoring) await this.release('restore_failed', '원복하기 전에 실행이 멈췄습니다');
    else await this.release('ok');
  }

  private async release(outcome: ReleaseInput['outcome'], detail?: string) {
    const held = this.held;
    this.held = undefined;
    this.restoring = false;
    this.opts.vault?.clear();
    if (!held || !this.opts.leaser) return;
    try {
      await this.opts.leaser.release({
        projectId: this.opts.projectId,
        accountId: held.id,
        runId: this.opts.runId,
        outcome,
        ...(detail ? { detail } : {}),
      });
    } catch (e) {
      // 반납하지 못해도 Run 연결 신호가 끊기면 다음 배정 때 풀린다
      this.opts.log?.(`  테스트 계정 ${held.loginId}을(를) 반납하지 못했습니다: ${(e as Error).message}`);
    }
  }
}
