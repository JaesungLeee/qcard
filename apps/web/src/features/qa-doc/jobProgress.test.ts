import { jobParts, jobs } from '@qcard/fixtures';
import type { QaDocJob } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { fmtDuration, initialPage, jobTiming, paged, phaseSteps, rowStatus } from './jobProgress';

const job = (id: string) => jobs.find((j) => j.id === id) as QaDocJob;
const statuses = (id: string) => {
  const j = job(id);
  const spec = jobParts[id]!.specs[0]!;
  const drafted = new Set(jobParts[id]!.drafts.map((d) => d.rowId));
  return spec.rows.map((r) => rowStatus(j, spec.spec, r, drafted));
};

describe('작업 상세 — 행 상태', () => {
  it('생성 중: 동일은 이전 것 사용, 초안 16개, 다음 묶음 24행은 생성 중, 나머지 대기', () => {
    const s = statuses('job-140');
    const count = (k: string) => s.filter((x) => x === k).length;
    expect([count('copy'), count('draft'), count('active'), count('wait')]).toEqual([21, 16, 24, 0]);
  });

  it('멈춘 작업은 생성 중인 행이 없다', () => {
    expect(statuses('job-131')).not.toContain('active');
    expect(statuses('job-131').filter((x) => x === 'draft')).toHaveLength(8);
  });

  it('완료한 작업의 초안은 저장됨', () => {
    const j = { ...job('job-140'), status: 'done' } as QaDocJob;
    const spec = jobParts['job-140']!.specs[0]!;
    const row = spec.rows.find((r) => r.change !== 'same')!;
    expect(rowStatus(j, spec.spec, row, new Set([row.id]))).toBe('saved');
  });

  it('처음 여는 페이지는 생성 중인 행이 있는 곳', () => {
    expect(initialPage(statuses('job-140'), 12)).toBe(4); // 38번째 행
    expect(initialPage(['copy', 'draft'], 12)).toBe(1);
  });
});

describe('작업 상세 — 단계·시간', () => {
  it('케이스 변환 중: 계획은 끝, 변환은 진행, 저장은 아직', () => {
    expect(phaseSteps(job('job-140'))).toEqual([
      { key: 'plan', state: 'done', count: '1/1' },
      { key: 'cases', state: 'current', count: '16/40' },
      { key: 'save', state: 'todo' },
    ]);
    expect(phaseSteps(job('job-131'))[1]).toMatchObject({ state: 'stopped', count: '8/12' });
    expect(phaseSteps(job('job-130')).map((p) => p.state)).toEqual(['done', 'done', 'done']);
  });

  it('케이스 변환 중에 계획이 남아 있으면 두 단계가 함께 진행 중', () => {
    const j = job('job-140');
    const plan = { specs: [...j.plan!.specs, { name: 'more', title: '더', new: 4, changed: 0, same: 0 }], removed: 0 };
    const overlap = { ...j, plan, progress: { ...j.progress!, planDone: 1 } } as QaDocJob;
    expect(phaseSteps(overlap)).toEqual([
      { key: 'plan', state: 'current', count: '1/2' },
      { key: 'cases', state: 'current', count: '16/40' },
      { key: 'save', state: 'todo' },
    ]);
    const paused = { ...overlap, status: 'paused' } as QaDocJob;
    expect(phaseSteps(paused).map((p) => p.state)).toEqual(['stopped', 'stopped', 'todo']);
    // 계획을 다 끝냈으면 계획은 끝
    expect(phaseSteps({ ...overlap, progress: { ...overlap.progress!, planDone: 2 } })[0]).toMatchObject({
      state: 'done',
      count: '2/2',
    });
  });

  it('남은 시간은 호스트가 마지막으로 갱신한 시각까지의 속도로 추정한다', () => {
    // 16:42에 변환 시작, 16:45까지 16행 → 남은 24행은 4.5분
    expect(jobTiming(job('job-140'))).toEqual({ elapsedMs: 4 * 60_000, etaMs: 4.5 * 60_000 });
    expect(jobTiming(job('job-131'))).not.toHaveProperty('etaMs');
    expect(fmtDuration(4.5 * 60_000)).toBe('5분');
    expect(fmtDuration(65 * 60_000)).toBe('1시간 5분');
    expect(fmtDuration(10_000)).toBe('1분 미만');
  });

  it('페이지는 범위를 벗어나면 가장 가까운 쪽', () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    expect(paged(xs, 3, 12)).toMatchObject({ page: 3, pages: 3, from: 25, to: 30 });
    expect(paged(xs, 9, 12).page).toBe(3);
    expect(paged([], 1, 12)).toMatchObject({ page: 1, pages: 1, items: [] });
  });
});
