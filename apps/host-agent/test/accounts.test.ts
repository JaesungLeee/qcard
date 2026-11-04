import { SecretVault } from '@qcard/llm';
import type { TestAccount, TestCase } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { LOGIN_FAILURE_LIMIT, RunAccounts, type AccountLeaser, type ClaimInput, type ReleaseInput } from '../src/accounts';

/*
 * Run 하나의 테스트 계정: 종류가 같으면 이어 쓰고, 바뀌거나 끝나면 반납하며, 비밀값은 vault에만 둔다.
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
      resetApp: false,
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

    // 디바이스에 s 계정 로그인이 남아 있을 수 있어 앱 데이터를 초기화한다
    expect(await accounts.forCase(tc('T4'))).toEqual({ resetApp: true });
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

  it('로그인 실패는 표시로 반납하고, 원복 중에 멈추면 격리로 반납한다', async () => {
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

  it('다른 계정으로 바뀌거나 계정이 없는 케이스가 오면 앱을 초기화하라고 알린다', async () => {
    const { accounts } = setup([account('a', '기본'), account('s', '구독자')]);
    const reset = async (t: TestCase) => {
      const r = await accounts.forCase(t);
      return 'resetApp' in r ? r.resetApp : r;
    };
    expect(await reset(tc('T0'))).toBe(false);
    expect(await reset(tc('T1', '기본'))).toBe(false);
    expect(await reset(tc('T2', '기본'))).toBe(false);
    expect(await reset(tc('T3', '구독자'))).toBe(true);
    expect(await reset(tc('T4'))).toBe(true);
    expect(await reset(tc('T5'))).toBe(false);
  });

  it('이어 쓰던 계정을 잃으면 내려놓고 새 계정을 받는다', async () => {
    const claims: ClaimInput[] = [];
    let n = 0;
    const leaser: AccountLeaser = {
      async claim(input) {
        claims.push(input);
        if (input.accountId) throw new Error('이 Run이 배정받은 계정이 아닙니다.');
        const a = account(['a', 'b', 'c'][n++]!, '기본');
        return { account: a, secret: { password: `pw-${a.id}` } };
      },
      async release() {},
    };
    const vault = new SecretVault();
    const accounts = new RunAccounts({ leaser, vault, projectId: 'p', cycleId: 'c', runId: 'r' });
    await accounts.forCase(tc('T1', '기본'));
    expect(await accounts.forCase(tc('T2', '기본'))).toEqual({
      account: { kind: '기본', loginId: 'b@moa.test', totp: false },
      resetApp: true,
    });
    expect(vault.resolve('{{secret.password}}')).toBe('pw-b');
    expect(claims.map((c) => `${c.tcId}:${c.accountId ?? 'new'}`)).toEqual(['T1:new', 'T2:a', 'T2:new']);
  });

  it('계정 탓이 아닌 로그인 실패는 계정을 그대로 두고, 한 종류가 여러 번 실패하면 더 배정받지 않는다', async () => {
    const { accounts, claims, releases } = setup([account('a', '기본'), account('b', '기본'), account('c', '기본')]);
    await accounts.forCase(tc('T1', '기본'));
    await accounts.issue('login_flow_failed', '로그인 입력란을 찾지 못함');
    expect(releases).toEqual([]);
    await accounts.forCase(tc('T2', '기본'));
    expect(claims.map((c) => c.accountId)).toEqual([undefined, 'a']);
    await accounts.issue('login_flow_failed', '로그인 입력란을 찾지 못함');

    // 플로우가 잘못됐을 수 있다: 풀의 다른 계정을 차례로 쓰지 않는다
    const r = await accounts.forCase(tc('T3', '기본'));
    expect(r).toEqual({ blocked: expect.stringMatching(/^로그인 플로우 확인 필요/) });
    expect(claims).toHaveLength(2);
    expect(releases.map((x) => [x.accountId, x.outcome])).toEqual([['a', 'ok']]);
    expect(LOGIN_FAILURE_LIMIT).toBe(2);
  });

  it('인증 거부도 횟수에 들어가 풀 전체를 로그인 실패로 표시하지 않는다', async () => {
    const { accounts, releases } = setup([account('a', '기본'), account('b', '기본'), account('c', '기본')]);
    for (const t of ['T1', 'T2', 'T3']) {
      const r = await accounts.forCase(tc(t, '기본'));
      if ('account' in r && r.account) await accounts.issue('login_failed', '비밀번호 오류');
    }
    expect(releases.map((x) => [x.accountId, x.outcome])).toEqual([
      ['a', 'login_failed'],
      ['b', 'login_failed'],
    ]);
  });
});
