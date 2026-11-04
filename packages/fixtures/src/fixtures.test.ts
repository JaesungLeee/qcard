import { CaseResult, Defect, QADocument, TestCycle } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { matchVersions } from '@qcard/spec';
import raw from './data/onboarding-flow.json';
import { SCREENS, createFixtureDb, qaDocV120, qaDocV130 } from './index';

const db = createFixtureDb();

describe('fixture가 도메인 스키마를 따른다', () => {
  it.each(db.qaDocs.map((d) => [d.appVersion, d] as const))('QA 문서 %s', (_, doc) => {
    expect(() => QADocument.parse(doc)).not.toThrow();
  });
  it.each(db.cycles.map((c) => [c.name, c] as const))('사이클 %s', (_, cycle) => {
    expect(() => TestCycle.parse(cycle)).not.toThrow();
    for (const r of db.results[cycle.id]!) CaseResult.parse(r);
    for (const d of db.defects[cycle.id]!) Defect.parse(d);
  });
});

describe('fixture 일관성', () => {
  it('목업 스크린샷은 모두 정의된 화면을 가리킨다', () => {
    const screens = Object.values(db.results)
      .flat()
      .flatMap((r) => [...r.steps.map((s) => s.screenshot), ...r.points.map((p) => p.evidence)])
      .concat(db.console.current.steps.map((s) => s.screenshot))
      .filter((s) => s.kind === 'mock')
      .map((s) => (s.kind === 'mock' ? s.screen : ''));
    expect(screens.filter((s) => !SCREENS[s])).toEqual([]);
  });

  it('사이클 결과는 스냅샷 케이스 × 대상 디바이스를 모두 덮는다', () => {
    for (const cycle of db.cycles) {
      const results = db.results[cycle.id]!;
      expect(results).toHaveLength(cycle.snapshot.length * cycle.targets.length);
    }
  });

  it('결과의 결함 ID는 결함 목록에 있다', () => {
    for (const cycle of db.cycles) {
      const ids = new Set(db.defects[cycle.id]!.map((d) => d.id));
      for (const r of db.results[cycle.id]!) if (r.defectId) expect(ids).toContain(r.defectId);
    }
  });

  it('1.3.0 QA 문서에 신규·변경·삭제·동일 케이스가 모두 있다', () => {
    const changes = new Set(db.qaDocs[0]!.cases.map((c) => c.change));
    expect([...changes].sort()).toEqual(['changed', 'new', 'removed', 'same']);
  });

  it('로컬 콘솔은 수동 스텝에서 멈춘다', () => {
    const { steps, pauseAt } = db.console.current;
    expect(steps[pauseAt - 1]?.action).toBe('manual');
  });
});

describe('버전 매칭 — 스펙 생성기와 fixture가 같은 판정을 내린다', () => {
  it('1.2.0 문서 → 1.3.0 스펙 행: 동일·변경·신규와 TC ID가 fixture 1.3.0과 같다', () => {
    // fixture를 만든 스펙 행(onboarding-flow.json)을 1.3.0 스펙 묶음으로 쓴다
    const spec = {
      name: raw.spec,
      title: raw.feature,
      requirements: raw.requirements.map((r) => ({
        ...r,
        kind: r.id.startsWith('UX') ? ('UX' as const) : ('FR' as const),
        headingPath: [],
      })),
      rows: raw.rows.map((r) => ({ ...r, kind: r.kind as 'TS' | 'EC', headingPath: [] })),
      flows: [],
    };
    const plan = matchVersions({ specs: [spec], warnings: {}, ignored: 0 }, qaDocV120);
    const expected = qaDocV130.cases.filter((c) => c.change !== 'removed');
    expect(plan.rows.map((r) => [r.sourceId, r.decision])).toEqual(expected.map((c) => [c.sourceId, c.change]));
    // 동일·변경은 이전 TC ID를 이어받는다
    const kept = plan.rows.filter((r) => r.decision !== 'new');
    expect(kept.map((r) => r.tcId)).toEqual(expected.filter((c) => c.change !== 'new').map((c) => c.tcId));
    // 신규는 이전에 쓴 적 없는 다음 번호 (fixture는 행 순서로 매겼지만 생성기는 쓰지 않은 번호를 잇는다)
    expect(plan.rows.filter((r) => r.decision === 'new').map((r) => r.tcId)).toEqual([
      'TC-ONBOARDING-063',
      'TC-ONBOARDING-064',
      'TC-ONBOARDING-065',
      'TC-ONBOARDING-066',
    ]);
    expect(plan.counts).toMatchObject({ new: 4, changed: 3 });
  });
});
