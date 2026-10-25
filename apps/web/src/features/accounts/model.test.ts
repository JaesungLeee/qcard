import type { AccountState, TestAccount } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import type { AccountView } from '../../data/api';
import { filterCounts, filterViews, kindRows, showsKinds } from './model';

const view = (id: string, kind: string, state: AccountState): AccountView => ({
  account: { id, kind } as TestAccount,
  state,
});

describe('계정 종류 현황', () => {
  it('케이스와 계정에 나온 종류를 모으고, 기본 종류를 먼저 둔다', () => {
    const views = [view('a', '기본', 'free'), view('b', '기본', 'busy'), view('c', '구독자', 'quarantined')];
    const rows = kindRows(views, ['기본', '구독자', '관리자', '관리자', '관리자', undefined]);
    expect(rows).toEqual([
      { kind: '기본', cases: 1, accounts: 2, free: 1, busy: 1, flagged: 0 },
      { kind: '관리자', cases: 3, accounts: 0, free: 0, busy: 0, flagged: 0 },
      { kind: '구독자', cases: 1, accounts: 1, free: 0, busy: 0, flagged: 1 },
    ]);
    expect(showsKinds(rows)).toBe(true);
  });

  it('기본 종류만 있으면 종류를 드러내지 않는다', () => {
    expect(showsKinds(kindRows([view('a', '기본', 'free')], ['기본']))).toBe(false);
    expect(showsKinds(kindRows([], []))).toBe(false);
  });

  it('상태 거르기: 확인 필요는 로그인 실패와 격리', () => {
    const views = [view('a', '기본', 'free'), view('b', '기본', 'login_failed'), view('c', '기본', 'quarantined')];
    expect(filterViews(views, 'flagged').map((v) => v.account.id)).toEqual(['b', 'c']);
    expect(filterCounts(views)).toEqual({ all: 3, free: 1, busy: 0, flagged: 2 });
  });
});
