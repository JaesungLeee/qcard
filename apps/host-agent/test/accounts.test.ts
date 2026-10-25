import { SecretVault } from '@qcard/llm';
import type { TestAccount, TestCase } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { RunAccounts, type AccountLeaser, type ClaimInput, type ReleaseInput } from '../src/accounts';

/*
 * Run 하나의 테스트 계정 (F-PF-04·08·09): 종류가 같으면 이어 쓰고, 바뀌거나 끝나면 반납하며, 비밀값은 vault에만 둔다.
 */

const account = (id: string, kind: string, usesTotp = false) =>
  ({ id, kind, loginId: `${id}@moa.test`, usesTotp }) as TestAccount;

function fakeLeaser(pool: TestAccount[]) {
  const claims: ClaimInput[] = [];
  const releases: ReleaseInput[] = [];
  const leased = new Set<string>();
  /** 로그인 실패 표시·격리 (다시 배정하지 않는다) */
  const flagged = new Set<string>();
  const leaser: AccountLeaser = {
    async claim(input) {
      claims.push(input);
      if (input.accountId) return { account: pool.find((a) => a.id === input.accountId)! };
      const a = pool.find((x) => x.kind === input.kind && !leased.has(x.id) && !flagged.has(x.id));
      if (!a) return { account: null };
      leased.add(a.id);
      return { account: a, secret: { password: `pw-${a.id}`, ...(a.usesTotp ? { totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' } : {}) } };
    },
    async release(input) {
      releases.push(input);
      leased.delete(input.accountId);
      if (input.outcome !== 'ok') flagged.add(input.accountId);
    },
  };
  return { leaser, claims, releases };
}

const tc = (tcId: string, accountKind?: string, restoreFlowId?: string) =>
  ({ tcId, accountKind, restoreFlowId }) as TestCase;

function setup(pool: TestAccount[]) {
  const f = fakeLeaser(pool);
  const vault = new SecretVault();
  const accounts = new RunAccounts({
    leaser: f.leaser,
    vault,
    projectId: 'moabook',
    cycleId: 'c1',
    runId: 'r1',
    now: () => 59_000,
  });
  return { ...f, vault, accounts };
}

describe('Run의 테스트 계정', () => {
  it('같은 종류는 이어 쓰고, 종류가 바뀌거나 계정이 필요 없는 케이스가 오면 반납한다', async () => {
    const { accounts, claims, releases, vault } = setup([account('a', '기본'), account('s', '구독자', true)]);
    expect(await accounts.forCase(tc('T1', '기본'))).toEqual({
      account: { kind: '기본', loginId: 'a@moa.test', totp: false },
    });
    expect(vault.resolve('{{secret.password}}')).toBe('pw-a');
    await accounts.forCase(tc('T2', '기본'));
    expect(claims.map((c) => [c.tcId, c.accountId])).toEqual([
      ['T1', undefined],
      ['T2', 'a'],
    ]);

    await accounts.forCase(tc('T3', '구독자'));
    expect(releases).toEqual([{ projectId: 'moabook', accountId: 'a', runId: 'r1', outcome: 'ok' }]);
    expect(vault.resolve('{{secret.password}}')).toBe('pw-s');
    // TOTP 코드는 입력할 때 계산한다 (RFC 6238, 59초)
    expect(vault.resolve('{{secret.totp}}')).toBe('287082');

    expect(await accounts.forCase(tc('T4'))).toEqual({});
    expect(releases.map((r) => r.accountId)).toEqual(['a', 's']);
    expect(vault.has('password')).toBe(false);
  });

  it('빈 계정이 없거나 배정에 실패하면 Blocked 사유를 준다', async () => {
    const { accounts } = setup([]);
    expect(await accounts.forCase(tc('T1', '관리자'))).toEqual({ blocked: '계정 없음: 관리자 종류의 빈 계정이 없습니다' });
    const broken = new RunAccounts({
      leaser: { claim: () => Promise.reject(new Error('네트워크')), release: async () => {} },
      vault: new SecretVault(),
      projectId: 'p',
      cycleId: 'c',
      runId: 'r',
    });
    expect(await broken.forCase(tc('T1', '기본'))).toEqual({
      blocked: '계정 없음: 테스트 계정을 배정받지 못했습니다 (네트워크)',
    });
    const noPool = new RunAccounts({ projectId: 'p', cycleId: 'c', runId: 'r' });
    expect(await noPool.forCase(tc('T1', '기본'))).toHaveProperty('blocked');
  });

  it('로그인 실패는 표시로 반납하고, 원복 중에 멈추면 격리로 반납한다 (F-PF-08·09)', async () => {
    const { accounts, releases, vault } = setup([account('a', '기본'), account('b', '기본')]);
    await accounts.forCase(tc('T1', '기본'));
    await accounts.issue('login_failed', '비밀번호 오류');
    expect(vault.has('password')).toBe(false);
    await accounts.forCase(tc('T2', '기본', 'pf-restore'));
    await accounts.finish();
    expect(releases.map((r) => [r.accountId, r.outcome, r.detail])).toEqual([
      ['a', 'login_failed', '비밀번호 오류'],
      ['b', 'restore_failed', '원복하기 전에 실행이 멈췄습니다'],
    ]);

    // 원복까지 끝난 뒤 멈추면 그냥 반납
    const s = setup([account('c', '기본')]);
    await s.accounts.forCase(tc('T3', '기본', 'pf-restore'));
    s.accounts.caseEnded();
    await s.accounts.finish();
    expect(s.releases.map((r) => r.outcome)).toEqual(['ok']);
  });
});
