import type { ConsoleCycleOption, TestCase, Verdict } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PICK_FILTER,
  defaultPicked,
  matchesPick,
  pickAllVisible,
  pickedState,
  pickedTcIds,
  pickGroups,
  pickMany,
  pickRows,
  pickVerdictCounts,
  toggleIn,
  togglePick,
} from './rules';

const tc = (tcId: string, over: Partial<TestCase> = {}) =>
  ({
    tcId,
    mode: 'auto',
    feature: '온보딩',
    subFeature: '처음 실행',
    priority: 'high',
    ...over,
  }) as TestCase;
const alarm = (tcId: string, over: Partial<TestCase> = {}) =>
  tc(tcId, { feature: '알림', subFeature: '알림 받기', ...over });

const CASES = [
  tc('TC-1'),
  tc('TC-2', { priority: 'low', subFeature: '건너뛰기' }),
  alarm('TC-3'),
  tc('TC-4'),
  tc('TC-5', { mode: 'manual' }),
  alarm('TC-6', { priority: 'medium' }),
];
const VERDICTS: Record<string, Verdict> = { 'TC-2': 'fail', 'TC-3': 'blocked', 'TC-4': 'pass', 'TC-6': 'check' };
const rows = pickRows(CASES, (c) => VERDICTS[c.tcId]);
const ids = (rs: { tc: { tcId: string } }[]) => rs.map((r) => r.tc.tcId);

describe('Run 케이스 고르기 (case-pick rules)', () => {
  it('자동 케이스만, 내 기기 칸에 결과가 있으면 다시 실행', () => {
    expect(ids(rows)).toEqual(['TC-1', 'TC-2', 'TC-3', 'TC-4', 'TC-6']);
    expect(rows.filter((r) => r.rerun).map((r) => [r.tc.tcId, r.verdict])).toEqual([
      ['TC-2', 'fail'],
      ['TC-3', 'blocked'],
      ['TC-4', 'pass'],
      ['TC-6', 'check'],
    ]);
  });

  it('판정·우선순위로 거른다', () => {
    const f = (over: Partial<typeof DEFAULT_PICK_FILTER>) =>
      ids(rows.filter((r) => matchesPick(r, { ...DEFAULT_PICK_FILTER, ...over })));
    expect(f({})).toEqual(['TC-1']);
    expect(f({ verdict: 'fail' })).toEqual(['TC-2']);
    expect(f({ verdict: 'check' })).toEqual(['TC-6']);
    expect(f({ verdict: 'all', priorities: ['high', 'medium'] })).toEqual(['TC-1', 'TC-3', 'TC-4', 'TC-6']);
    expect(f({ verdict: 'blocked', priorities: ['low', 'medium'] })).toEqual([]);
  });

  it('판정 칩 숫자는 우선순위 필터를 적용한 건수', () => {
    expect(pickVerdictCounts(rows, DEFAULT_PICK_FILTER)).toEqual({
      remaining: 1,
      fail: 1,
      blocked: 1,
      check: 1,
      all: 5,
    });
    expect(pickVerdictCounts(rows, { ...DEFAULT_PICK_FILTER, priorities: ['low', 'medium'] })).toEqual({
      remaining: 0,
      fail: 1,
      blocked: 0,
      check: 1,
      all: 2,
    });
  });

  it('처음엔 남은 칸 전체를 고르고, 개별로 넣고 뺀다', () => {
    let picked = defaultPicked(rows);
    expect([...picked]).toEqual(['TC-1']);
    picked = togglePick(picked, 'TC-2', true);
    picked = togglePick(picked, 'TC-1', false);
    expect([...picked]).toEqual(['TC-2']);
    expect(toggleIn(['high'], 'low', true)).toEqual(['high', 'low']);
    expect(toggleIn(['high', 'low'], 'high', false)).toEqual(['low']);
  });

  it('걸러진 것 모두 고르기: 모두 골라져 있으면 그 줄만 뺀다', () => {
    const alarm = rows.filter((r) => r.tc.feature === '알림');
    let picked = new Set(['TC-1', 'TC-3']);
    expect(pickedState(picked, alarm)).toBe('some');
    picked = pickAllVisible(picked, alarm);
    expect([...picked].sort()).toEqual(['TC-1', 'TC-3', 'TC-6']);
    expect(pickedState(picked, alarm)).toBe('all');
    picked = pickAllVisible(picked, alarm);
    expect([...picked]).toEqual(['TC-1']);
    expect(pickedState(picked, alarm)).toBe('none');
  });

  it('기능(스펙) → 세부 기능으로 묶고, 묶음째 고른다', () => {
    const real = pickGroups(
      pickRows([tc('TC-ONBOARDING-001'), alarm('TC-ALARM-001'), tc('TC-ONBOARDING-002')], () => undefined),
    );
    expect(real.map((g) => [g.code, g.name, ids(g.rows)])).toEqual([
      ['ONBOARDING', '온보딩', ['TC-ONBOARDING-001', 'TC-ONBOARDING-002']],
      ['ALARM', '알림', ['TC-ALARM-001']],
    ]);
    const groups = pickGroups(rows);
    expect(groups[0]!.subs.map((x) => [x.name, ids(x.rows)])).toEqual([
      ['처음 실행', ['TC-1', 'TC-4']],
      ['건너뛰기', ['TC-2']],
    ]);
    let picked = pickMany(new Set(['TC-1']), groups[1]!.rows, true);
    expect([...picked]).toEqual(['TC-1', 'TC-3', 'TC-6']);
    expect(pickedState(picked, groups[0]!.rows)).toBe('some');
    picked = pickMany(picked, groups[0]!.subs[0]!.rows, false);
    expect([...picked]).toEqual(['TC-3', 'TC-6']);
  });

  it('요청 목록은 문서 순서, 고르기 대상만, 다시 실행 수와 함께', () => {
    expect(pickedTcIds(rows, new Set(['TC-4', 'TC-1', 'TC-5']))).toEqual({ tcIds: ['TC-1', 'TC-4'], rerun: 1 });
  });

  it('콘솔 사이클의 케이스(자동만, 판정 포함)로도 같은 줄을 만든다', () => {
    const cases: ConsoleCycleOption['cases'] = [
      { tcId: 'TC-1', title: '', done: false, feature: '온보딩', subFeature: '처음', priority: 'high', verdict: 'nt' },
      { tcId: 'TC-2', title: '', done: true, feature: '온보딩', subFeature: '처음', priority: 'low', verdict: 'fail' },
    ];
    const console = pickRows(cases, (c) => c.verdict);
    expect(console.map((r) => [r.tc.tcId, r.verdict, r.rerun])).toEqual([
      ['TC-1', 'nt', false],
      ['TC-2', 'fail', true],
    ]);
    expect([...defaultPicked(console)]).toEqual(['TC-1']);
  });
});
