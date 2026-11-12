// QA 문서 생성 작업 상세 화면의 순수 로직: 행 상태·단계·시간·페이지. 화면 코드와 분리해 테스트한다.
import type { JobPlanRow, QaDocJob } from '@qcard/shared';

export type RowStatus = 'wait' | 'active' | 'draft' | 'saved' | 'copy';
export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  wait: '대기',
  active: '생성 중',
  draft: '초안',
  saved: '저장됨',
  copy: '이전 것 사용',
};

/** 행 하나의 상태. drafted: 이 스펙에서 초안이 있는 행 ID */
export function rowStatus(job: QaDocJob, spec: string, row: JobPlanRow, drafted: ReadonlySet<string>): RowStatus {
  if (row.change === 'same') return 'copy';
  if (drafted.has(row.id)) return job.status === 'done' ? 'saved' : 'draft';
  if (job.status === 'running' && job.progress?.active?.includes(`${spec}/${row.id}`)) return 'active';
  return 'wait';
}

export type PhaseKey = 'plan' | 'cases' | 'save';
export type PhaseState = 'done' | 'current' | 'stopped' | 'todo';
export const PHASE_LABEL: Record<PhaseKey, string> = { plan: '스펙 계획', cases: '케이스 변환', save: '저장' };
const PHASES: PhaseKey[] = ['plan', 'cases', 'save'];

/**
 * 단계 표시: 스펙 계획 → 케이스 변환 → 저장. 멈춘 작업은 멈춘 단계를 표시한다.
 * 계획이 끝난 스펙부터 케이스를 변환하므로, 케이스 변환 중에도 계획이 남아 있으면 두 단계가 함께 진행 중이다
 */
export function phaseSteps(job: QaDocJob): { key: PhaseKey; state: PhaseState; count?: string }[] {
  const p = job.progress;
  const at = job.status === 'done' ? PHASES.length : job.status === 'queued' || !p ? -1 : PHASES.indexOf(p.phase);
  const stopped = job.status === 'paused' || job.status === 'failed';
  const planned = job.plan?.specs.filter((s) => s.new + s.changed > 0).length;
  const planning = p?.phase === 'cases' && planned !== undefined && p.planDone !== undefined && p.planDone < planned;
  return PHASES.map((key, i) => {
    const reached = i < at && !(key === 'plan' && planning);
    const state: PhaseState = reached ? 'done' : i <= at ? (stopped ? 'stopped' : 'current') : 'todo';
    let count: string | undefined;
    if (key === 'plan' && p && state !== 'todo')
      count =
        p.phase === 'plan'
          ? `${p.done}/${p.total}`
          : planned !== undefined
            ? `${planning ? p.planDone : planned}/${planned}`
            : undefined;
    if (key === 'cases' && p && state !== 'todo' && p.phase !== 'plan')
      count = p.phase === 'cases' ? `${p.done}/${p.total}` : `${targetsOf(job)}/${targetsOf(job)}`;
    if (key === 'save' && job.status === 'done' && job.result) count = `${job.result.cases}`;
    return { key, state, ...(count ? { count } : {}) };
  });
}

const targetsOf = (job: QaDocJob) => job.plan?.specs.reduce((n, s) => n + s.new + s.changed, 0) ?? 0;

/**
 * 걸린 시간과 남은 시간 추정. 지금 시각 대신 호스트가 마지막으로 갱신한 시각을 쓴다 —
 * 화면을 다시 그릴 때마다 숫자가 흔들리지 않고, 호스트가 멈췄으면 시간도 멈춘다
 */
export function jobTiming(job: QaDocJob): { elapsedMs?: number; etaMs?: number } {
  const p = job.progress;
  const end = job.finishedAt ?? p?.updatedAt;
  const elapsedMs = job.startedAt && end ? Math.max(0, Date.parse(end) - Date.parse(job.startedAt)) : undefined;
  let etaMs: number | undefined;
  if (job.status === 'running' && p?.phase === 'cases' && p.done > 0 && p.phaseStartedAt && p.updatedAt) {
    const perRow = (Date.parse(p.updatedAt) - Date.parse(p.phaseStartedAt)) / p.done;
    etaMs = Math.max(0, perRow * (p.total - p.done));
  }
  return { ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...(etaMs !== undefined ? { etaMs } : {}) };
}

/** `1시간 5분` · `12분` · `1분 미만` */
export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '1분 미만';
  const h = Math.floor(min / 60);
  return h ? `${h}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}

/** 페이지 나누기 (page는 1부터). 범위를 벗어나면 가장 가까운 페이지 */
export function paged<T>(items: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pages,
    from: start + 1,
    to: Math.min(items.length, start + size),
  };
}

/** 처음 여는 페이지: 지금 만들고 있는 행이 있는 곳, 없으면 아직 안 만든 첫 행이 있는 곳 */
export function initialPage(statuses: RowStatus[], size: number): number {
  const i = statuses.indexOf('active');
  const j = i >= 0 ? i : statuses.indexOf('wait');
  return j >= 0 ? Math.floor(j / size) + 1 : 1;
}
