import { createFixtureDb } from '@qcard/fixtures';
import type { CaseResult } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryApi } from '../../data/memory';
import {
  autoConfirmChecks,
  caseVerdictCounts,
  deviceStats,
  indexResults,
  maskAccount,
  matchesQuery,
  neighbors,
  oneLineSummary,
  parseTab,
  progressMatrix,
  resultKey,
  traceability,
  traceSummary,
  worstVerdict,
} from './model';

const load = (id = 'cycle-130-1') => createMemoryApi({ db: createFixtureDb() }).getCycle(id);
const bySrc = (cases: { sourceId: string; tcId: string }[], id: string) =>
  cases.find((c) => c.sourceId === `onboarding-flow/${id}`)!.tcId;

describe('worstVerdict', () => {
  it('Fail > Blocked > 확인필요 > N/T > Pass, N/A는 무시', () => {
    expect(worstVerdict(['pass', 'check', 'blocked'])).toBe('blocked');
    expect(worstVerdict(['pass', 'nt'])).toBe('nt');
    expect(worstVerdict(['pass', 'na'])).toBe('pass');
    expect(worstVerdict(['na'])).toBe('na');
    expect(worstVerdict([])).toBeUndefined();
  });
});

describe('progressMatrix', () => {
  it('Pixel 8은 일시정지된 Run의 현재 케이스가 실행 중 칸이고, 나머지는 완료/남은 칸', async () => {
    const d = await load();
    const index = indexResults(d.results);
    const [s24, p8] = progressMatrix(d.cases, d.cycle.targets, index, d.runs);
    expect(s24!.remaining).toBe(0);
    expect(s24!.running).toBe(0);
    expect(s24!.done).toBe(d.cases.length);
    expect(p8!.running).toBe(1);
    const running = p8!.cells.find((c) => c.state === 'running')!;
    expect(running.tcId).toBe(bySrc(d.cases, 'TS-021'));
    expect(running.executor).toBe('이재성');
    expect(running.paused).toBe(true);
    expect(p8!.done + p8!.running + p8!.remaining).toBe(d.cases.length);
    expect(p8!.remaining).toBeGreaterThan(0);
  });
});

describe('deviceStats', () => {
  it('전체 = 디바이스 합', async () => {
    const d = await load();
    const { overall, perDevice } = deviceStats(d.cycle.targets, d.results);
    expect(overall.total).toBe(perDevice.reduce((n, s) => n + s.total, 0));
    expect(overall.counts.fail).toBe(3);
    expect(perDevice[0]!.done).toBe(perDevice[0]!.total);
  });
});

describe('traceability', () => {
  it('요구사항마다 연결 케이스와 상태를 계산하고, 연결이 없으면 미커버', async () => {
    const d = await load();
    const index = indexResults(d.results);
    const rows = traceability(d.doc.requirements, d.cases, d.cycle.targets, index);
    expect(rows).toHaveLength(d.doc.requirements.length);
    for (const r of rows) expect(r.status === 'uncovered').toBe(r.cases.length === 0);
    // TS-034(FR-007)는 Pixel 8 Fail → FR-007은 Fail
    const fr7 = rows.find((r) => r.requirement.id === 'onboarding-flow/FR-007')!;
    expect(fr7.cases.some((c) => c.tc.tcId === bySrc(d.cases, 'TS-034'))).toBe(true);
    expect(fr7.status).toBe('fail');
    const s = traceSummary(rows);
    expect(s.covered + s.uncovered).toBe(s.total);
  });

  it('가짜 요구사항은 미커버', async () => {
    const d = await load();
    const fake = { ...d.doc.requirements[0]!, id: 'x/FR-999' };
    const [row] = traceability([fake], d.cases, d.cycle.targets, indexResults(d.results));
    expect(row!.status).toBe('uncovered');
  });
});

describe('oneLineSummary', () => {
  it('Fail은 실제 결과, 확인필요는 판단불가 포인트 관찰값, Blocked는 사유', async () => {
    const d = await load();
    const index = indexResults(d.results);
    const get = (src: string, dev: string) => index.get(resultKey(bySrc(d.cases, src), dev));
    expect(oneLineSummary(get('EC-009', 'galaxy-s24-15'))).toContain('토스트');
    expect(oneLineSummary(get('TS-023', 'galaxy-s24-15'))).toContain('여백');
    expect(oneLineSummary(get('EC-003', 'pixel-8-16'))).toContain('실행 한도');
    expect(oneLineSummary(get('TS-001', 'galaxy-s24-15'))).toBeUndefined();
  });
});

describe('autoConfirmChecks', () => {
  it('미충족 조건만 met=false', () => {
    const r = { unmetConditions: ['tree_only'] } as unknown as CaseResult;
    const checks = autoConfirmChecks(r);
    expect(checks).toHaveLength(4);
    expect(checks.filter((c) => !c.met).map((c) => c.condition)).toEqual(['tree_only']);
  });
});

describe('기타', () => {
  it('parseTab 기본값은 cases', () => {
    expect(parseTab(null)).toBe('cases');
    expect(parseTab('env')).toBe('env');
    expect(parseTab('nope')).toBe('cases');
  });
  it('maskAccount', () => {
    expect(maskAccount('qa.tester@haru.app')).toBe('qa*******@haru.app');
    expect(maskAccount('ab')).toBe('ab**');
    expect(maskAccount('(설치마다 새로 생성)')).toBe('(설치마다 새로 생성)');
  });
  it('neighbors', () => {
    const cs = [{ tcId: 'a' }, { tcId: 'b' }, { tcId: 'c' }];
    expect(neighbors(cs, 'a')).toEqual({ prev: undefined, next: { tcId: 'b' }, index: 0 });
    expect(neighbors(cs, 'c').next).toBeUndefined();
  });
  it('검색·판정 칩 건수', async () => {
    const d = await load();
    const tc = d.cases.find((c) => c.sourceId.endsWith('TS-034'))!;
    expect(matchesQuery(tc, 'ts-034')).toBe(true);
    expect(matchesQuery(tc, 'FR-007')).toBe(true);
    expect(matchesQuery(tc, 'zzz')).toBe(false);
    const counts = caseVerdictCounts(d.cases, d.cycle.targets, indexResults(d.results));
    expect(counts.fail).toBe(3);
    expect(counts.check).toBe(2);
  });
});
