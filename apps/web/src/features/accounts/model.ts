import { DEFAULT_ACCOUNT_KIND, type AccountState } from '@qcard/shared';
import type { AccountView, QaDocSummary } from '../../data/api';

/** 계정 종류별 현황. `cases`는 기준 QA 문서에서 그 종류를 쓰는 케이스 수 */
export type KindRow = {
  kind: string;
  cases: number;
  accounts: number;
  free: number;
  busy: number;
  /** 로그인 실패·격리 — 사람이 확인해야 다시 배정된다 */
  flagged: number;
};

/** 계정·케이스에 나온 종류를 모은다. 기본 종류가 먼저, 나머지는 케이스가 많은 순 */
export function kindRows(views: AccountView[], caseKinds: (string | undefined)[]): KindRow[] {
  const rows = new Map<string, KindRow>();
  const row = (kind: string) => {
    let r = rows.get(kind);
    if (!r) rows.set(kind, (r = { kind, cases: 0, accounts: 0, free: 0, busy: 0, flagged: 0 }));
    return r;
  };
  for (const k of caseKinds) if (k) row(k).cases++;
  for (const { account, state } of views) {
    const r = row(account.kind);
    r.accounts++;
    if (state === 'free') r.free++;
    else if (state === 'busy') r.busy++;
    else r.flagged++;
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.kind === DEFAULT_ACCOUNT_KIND) - Number(a.kind === DEFAULT_ACCOUNT_KIND) ||
      b.cases - a.cases ||
      a.kind.localeCompare(b.kind),
  );
}

/** 종류는 기본 외의 종류가 있을 때만 화면에 드러낸다 (F-PF-08) */
export const showsKinds = (rows: KindRow[]) => rows.some((r) => r.kind !== DEFAULT_ACCOUNT_KIND);

export type StateFilter = 'all' | 'free' | 'busy' | 'flagged';
export const isFlagged = (s: AccountState) => s === 'login_failed' || s === 'quarantined';

export function filterViews(views: AccountView[], f: StateFilter): AccountView[] {
  if (f === 'all') return views;
  if (f === 'flagged') return views.filter((v) => isFlagged(v.state));
  return views.filter((v) => v.state === f);
}

export function filterCounts(views: AccountView[]): Record<StateFilter, number> {
  return {
    all: views.length,
    free: filterViews(views, 'free').length,
    busy: filterViews(views, 'busy').length,
    flagged: filterViews(views, 'flagged').length,
  };
}

/** 종류 현황의 기준: 가장 최근에 만든 QA 문서 */
export const latestDoc = (docs: QaDocSummary[]) =>
  [...docs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
