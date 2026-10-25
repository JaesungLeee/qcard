import { ACCOUNT_SECRET, type AccountIssue, type CaseAccount } from '@qcard/agent';
import { totpCode, type SecretVault } from '@qcard/llm';
import type { AccountSecret, TestAccount, TestCase } from '@qcard/shared';

/*
 * Run 하나의 테스트 계정 (F-PF-04·08·09, F-EX-09). 케이스마다 필요한 종류의 계정을 배정받고, 비밀값은 vault(메모리)에만 둔다.
 * 종류가 같으면 이어 쓰고, 바뀌거나 Run이 끝나면 반납한다. 로그인 실패·원복 실패는 표시·격리로 반납한다.
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
  outcome: 'ok' | AccountIssue;
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

export class RunAccounts {
  private held?: TestAccount;
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

  /** 케이스 시작 전: 필요한 종류의 계정을 받는다. 받을 수 없으면 Blocked 사유 */
  async forCase(tc: TestCase): Promise<{ account?: CaseAccount } | { blocked: string }> {
    const kind = tc.accountKind;
    if (!kind) {
      await this.release('ok');
      return {};
    }
    const { leaser, vault } = this.opts;
    if (!leaser || !vault) return { blocked: '계정 없음: 이 실행은 테스트 계정을 배정받을 수 없습니다' };
    if (this.held && this.held.kind !== kind) await this.release('ok');
    let r: Awaited<ReturnType<AccountLeaser['claim']>>;
    try {
      r = await leaser.claim({
        projectId: this.opts.projectId,
        cycleId: this.opts.cycleId,
        runId: this.opts.runId,
        tcId: tc.tcId,
        kind,
        restoring: !!tc.restoreFlowId,
        ...(this.held ? { accountId: this.held.id } : {}),
      });
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
    return { account: { kind, loginId: r.account.loginId, totp: r.account.usesTotp } };
  }

  /** 케이스가 끝났다 (원복까지) */
  caseEnded() {
    this.restoring = false;
  }

  /** 로그인 실패·원복 실패: 표시·격리로 반납한다 */
  async issue(issue: AccountIssue, detail: string) {
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
