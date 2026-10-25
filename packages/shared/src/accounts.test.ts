import { describe, expect, it } from 'vitest';
import {
  accountState,
  claiming,
  expiredLease,
  leaseLive,
  mergeSecret,
  normalizeTotpSeed,
  releasing,
  type ClaimRequest,
} from './accounts';
import type { Member, TestAccount } from './domain';
import { MembershipError } from './membership';

const T0 = '2026-10-25T10:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const members: Member[] = [
  { projectId: 'p', uid: 'u-qa', user: '김민지', github: 'minji', role: 'qa', joinedAt: T0, dataNoticeAckAt: T0 },
  { projectId: 'p', uid: 'u-v', user: '박도윤', github: 'doyoon', role: 'viewer', joinedAt: T0, dataNoticeAckAt: T0 },
];
const qa = { uid: 'u-qa', name: '김민지', github: 'minji' };
const acct = (id: string, extra: Partial<TestAccount> = {}): TestAccount => ({
  id,
  projectId: 'p',
  kind: '기본',
  loginId: `${id}@moa.test`,
  usesTotp: false,
  createdAt: T0,
  createdBy: '이재성',
  secretUpdated: { by: '이재성', at: T0 },
  ...extra,
});
const req: ClaimRequest = { cycleId: 'c', runId: 'r1', tcId: 'TC-1', kind: '기본', restoring: false };
const lease = { cycleId: 'c', runId: 'r0', tcId: 'TC-0', uid: 'u-qa', executor: '김민지', hostId: 'h', at: T0, restoring: false };

describe('TOTP 시드', () => {
  it('otpauth 주소·공백 섞인 키를 base32로 맞추고, 짧거나 base32가 아니면 거부한다', () => {
    expect(normalizeTotpSeed('otpauth://totp/moa:qa?secret=jbswy3dpehpk3pxp&issuer=moa')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeTotpSeed(' jbsw y3dp-ehpk 3pxp ')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => normalizeTotpSeed('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toThrow(MembershipError);
    expect(() => normalizeTotpSeed('JBSWY3DP')).toThrow('16자');
    expect(() => normalizeTotpSeed('1234567890123456')).toThrow('base32');
  });

  it('비밀번호만 바꾸면 TOTP 시드가 남고, null이면 지운다', () => {
    const cur = { password: 'a', totpSeed: 'S' };
    expect(mergeSecret(cur, { password: 'b' })).toEqual({ password: 'b', totpSeed: 'S' });
    expect(mergeSecret(cur, { totpSeed: null })).toEqual({ password: 'a' });
  });
});

describe('배정', () => {
  it('배정은 실행 중·일시정지인 Run의 연결 신호가 살아 있을 때만 유효하다', () => {
    expect(leaseLive({ status: 'running', heartbeatAt: T0 }, at(90))).toBe(true);
    expect(leaseLive({ status: 'paused', heartbeatAt: T0 }, at(30))).toBe(true);
    expect(leaseLive({ status: 'running', heartbeatAt: T0 }, at(91))).toBe(false);
    expect(leaseLive({ status: 'done', heartbeatAt: T0 }, at(1))).toBe(false);
    expect(leaseLive({ status: 'running' }, T0)).toBe(false);
    expect(leaseLive(undefined, T0)).toBe(false);
  });

  it('같은 종류에서 배정·표시·격리가 없는 계정을 로그인 ID 순으로 고른다', () => {
    const accounts = [
      acct('d', { kind: '구독자' }),
      acct('c', { lease }),
      acct('b', { loginFailed: { at: T0, cycleId: 'c', runId: 'r0', tcId: 'TC-0' } }),
      acct('a', { quarantine: { reason: 'restore_failed', at: T0, cycleId: 'c', runId: 'r0', tcId: 'TC-0' } }),
      acct('f'),
      acct('e'),
    ];
    expect(claiming(members, accounts, qa, 'h', req, T0)?.id).toBe('e');
    expect(claiming(members, accounts, qa, 'h', { ...req, kind: '관리자' }, T0)).toBeUndefined();
    expect(() => claiming(members, accounts, { ...qa, uid: 'u-v' }, 'h', req, T0)).toThrow('Viewer');
  });

  it('끊긴 배정은 풀고, 원복 중이었으면 격리한다', () => {
    expect(expiredLease(acct('a', { lease }), at(200))).toEqual(acct('a'));
    expect(expiredLease(acct('a', { lease: { ...lease, restoring: true } }), at(200)).quarantine).toEqual({
      reason: 'interrupted',
      at: at(200),
      cycleId: 'c',
      runId: 'r0',
      tcId: 'TC-0',
    });
  });

  it('반납은 그 Run의 배정일 때만 바꾸고, 결과에 따라 표시·격리한다', () => {
    const mine = acct('a', { lease });
    expect(releasing(mine, 'r9', { kind: 'ok' }, T0)).toBeUndefined();
    expect(releasing(mine, 'r0', { kind: 'ok' }, T0)).toEqual(acct('a'));
    expect(releasing(mine, 'r0', { kind: 'login_failed', detail: '오류' }, T0)?.loginFailed).toMatchObject({ detail: '오류' });
    expect(accountState(releasing(mine, 'r0', { kind: 'restore_failed' }, T0)!, false)).toBe('quarantined');
    expect(accountState(mine, true)).toBe('busy');
    expect(accountState(mine, false)).toBe('free');
  });
});
