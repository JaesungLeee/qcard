// Run에서 돌릴 케이스 고르기: 내 기기 칸의 판정·우선순위로 거르고, 기능·세부 기능 묶음째 또는 개별로 고른다.
// 웹 QA 시트(CycleDetail)와 로컬 콘솔(ConsoleCycleOption)이 같은 규칙을 쓰도록 데이터 소스와 분리했다.
import type { Priority, TestCase, Verdict } from '@qcard/shared';

/** 고르기에 필요한 케이스 정보. TestCase와 콘솔의 ConsoleCycleOption.cases 둘 다 맞는다 */
export type PickCase = Pick<TestCase, 'tcId' | 'title' | 'feature' | 'subFeature' | 'priority'>;

/** 판정 필터. `remaining`은 아직 결과가 없는(N/T) 칸 — Run의 기본 대상 */
export const PICK_VERDICTS = ['remaining', 'fail', 'blocked', 'check', 'all'] as const;
export type PickVerdict = (typeof PICK_VERDICTS)[number];
export const PICK_VERDICT_LABEL: Record<PickVerdict, string> = {
  remaining: '남은 칸',
  fail: 'Fail',
  blocked: 'Blocked',
  check: '확인필요',
  all: '전체',
};

export const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

/** 고르기 대상 한 줄: 자동 케이스와 내 기기 칸의 판정. 결과가 있는 칸을 고르면 다시 실행한다 */
export type PickRow = { tc: PickCase; verdict: Verdict; rerun: boolean };

/** 빈 목록이면 거르지 않는다 */
export type PickFilter = { verdict: PickVerdict; priorities: Priority[] };
export const DEFAULT_PICK_FILTER: PickFilter = { verdict: 'remaining', priorities: [] };

/**
 * Run은 자동 케이스만 돌린다(`mode`가 없으면 이미 자동 케이스만 받은 것). `verdictOf`는 내 기기 칸의 판정 (결과가 없으면 undefined)
 */
export function pickRows<C extends PickCase & { mode?: TestCase['mode'] }>(
  cases: C[],
  verdictOf: (tc: C) => Verdict | undefined,
): PickRow[] {
  return cases
    .filter((tc) => (tc.mode ?? 'auto') === 'auto')
    .map((tc) => {
      const verdict = verdictOf(tc) ?? 'nt';
      return { tc, verdict, rerun: verdict !== 'nt' };
    });
}

export function matchesPickVerdict(row: PickRow, v: PickVerdict): boolean {
  if (v === 'all') return true;
  if (v === 'remaining') return !row.rerun;
  return row.verdict === v;
}

export function matchesPick(row: PickRow, f: PickFilter): boolean {
  return matchesPickVerdict(row, f.verdict) && (f.priorities.length === 0 || f.priorities.includes(row.tc.priority));
}

/** 판정 칩 숫자: 우선순위 필터를 적용한 뒤 판정별 건수 */
export function pickVerdictCounts(rows: PickRow[], f: PickFilter): Record<PickVerdict, number> {
  const rest = rows.filter((r) => matchesPick(r, { ...f, verdict: 'all' }));
  return Object.fromEntries(
    PICK_VERDICTS.map((v) => [v, rest.filter((r) => matchesPickVerdict(r, v)).length]),
  ) as Record<PickVerdict, number>;
}

/** 처음 고른 상태: 남은 칸 전체 (지금 [내 호스트에서 실행]과 같은 대상) */
export const defaultPicked = (rows: PickRow[]) => new Set(rows.filter((r) => !r.rerun).map((r) => r.tc.tcId));

/** 목록에 하나를 넣거나 뺀다 */
export function toggleIn<T>(list: T[], x: T, on: boolean): T[] {
  return on ? (list.includes(x) ? list : [...list, x]) : list.filter((y) => y !== x);
}

export function togglePick(picked: Set<string>, tcId: string, on: boolean): Set<string> {
  const next = new Set(picked);
  if (on) next.add(tcId);
  else next.delete(tcId);
  return next;
}

/** 여러 줄을 한꺼번에 넣거나 뺀다 (기능·세부 기능 묶음 체크) */
export function pickMany(picked: Set<string>, rows: PickRow[], on: boolean): Set<string> {
  const next = new Set(picked);
  for (const r of rows) {
    if (on) next.add(r.tc.tcId);
    else next.delete(r.tc.tcId);
  }
  return next;
}

/** 걸러진 것 중 고른 수: 모두 / 일부 / 없음 — 머리·묶음 체크박스 상태 */
export function pickedState(picked: Set<string>, visible: PickRow[]): 'all' | 'some' | 'none' {
  const n = visible.filter((r) => picked.has(r.tc.tcId)).length;
  if (n === 0) return 'none';
  return n === visible.length ? 'all' : 'some';
}

/** "걸러진 것 모두 고르기": 걸러진 줄이 모두 골라져 있으면 그 줄들만 빼고, 아니면 모두 더한다. 걸러지지 않은 고른 칸은 그대로 */
export function pickAllVisible(picked: Set<string>, visible: PickRow[]): Set<string> {
  return pickMany(picked, visible, pickedState(picked, visible) !== 'all');
}

/** 실행 요청에 보낼 목록: QA 문서 순서대로, 고르기 대상(자동 케이스)만. 다시 실행할 칸 수도 함께 */
export function pickedTcIds(rows: PickRow[], picked: Set<string>): { tcIds: string[]; rerun: number } {
  const chosen = rows.filter((r) => picked.has(r.tc.tcId));
  return { tcIds: chosen.map((r) => r.tc.tcId), rerun: chosen.filter((r) => r.rerun).length };
}

/** 기능 묶음 (스펙 하나 = 기능 하나). `code`는 TC ID 접두어(`TC-ONBOARDING-001` → `ONBOARDING`) */
export type PickGroup = { key: string; code: string; name: string; rows: PickRow[]; subs: PickSubGroup[] };
export type PickSubGroup = { key: string; name: string; rows: PickRow[] };

const TC_CODE = /^TC-(.+)-\d+$/;

/** 줄을 기능 → 세부 기능으로 묶는다. 순서는 처음 나온 순서 (QA 문서 순서) */
export function pickGroups(rows: PickRow[]): PickGroup[] {
  const groups = new Map<string, PickGroup>();
  for (const r of rows) {
    const key = r.tc.feature;
    let g = groups.get(key);
    if (!g) {
      g = { key, code: TC_CODE.exec(r.tc.tcId)?.[1] ?? key, name: r.tc.feature, rows: [], subs: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
    let sub = g.subs.find((s) => s.name === r.tc.subFeature);
    if (!sub) {
      sub = { key: `${key}::${r.tc.subFeature}`, name: r.tc.subFeature, rows: [] };
      g.subs.push(sub);
    }
    sub.rows.push(r);
  }
  return [...groups.values()];
}
