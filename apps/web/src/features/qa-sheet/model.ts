// QA 시트 화면이 쓰는 순수 계산. 화면 코드와 분리해 단위 테스트한다.
import {
  AUTO_CONFIRM_LABEL,
  type AutoConfirmCondition,
  type CaseResult,
  type PauseReason,
  type Requirement,
  type Run,
  type TargetDevice,
  type TestCase,
  type Verdict,
} from '@qcard/shared';
import type { VerdictCounts } from '../../data/api';
import { countVerdicts, passRate } from '../../data/memory';

export const VERDICTS: Verdict[] = ['pass', 'fail', 'blocked', 'check', 'nt', 'na'];

export const QA_TABS = ['summary', 'cases', 'defects', 'traceability', 'env'] as const;
export type QaTab = (typeof QA_TABS)[number];
export const parseTab = (v: string | null): QaTab =>
  (QA_TABS as readonly string[]).includes(v ?? '') ? (v as QaTab) : 'cases';

export const resultKey = (tcId: string, deviceId: string) => `${tcId}::${deviceId}`;

export type ResultIndex = Map<string, CaseResult>;
export function indexResults(results: CaseResult[]): ResultIndex {
  return new Map(results.map((r) => [resultKey(r.tcId, r.deviceId), r]));
}

/** 여러 칸의 판정을 하나로 모을 때의 우선순위: Fail > Blocked > 확인필요 > N/T > Pass. N/A는 무시한다. */
const SEVERITY_ORDER: Verdict[] = ['fail', 'blocked', 'check', 'nt', 'pass'];
export function worstVerdict(verdicts: Verdict[]): Verdict | undefined {
  const vs: Verdict[] = verdicts.filter((v) => v !== 'na');
  if (vs.length === 0) return verdicts.length ? 'na' : undefined;
  return SEVERITY_ORDER.find((v) => vs.includes(v));
}

export type DeviceStat = {
  device: TargetDevice;
  counts: VerdictCounts;
  total: number;
  done: number;
  passRate: number;
};

/** 디바이스별·전체 판정 건수와 통과율 (F-RP-01) */
export function deviceStats(
  targets: TargetDevice[],
  results: CaseResult[],
): { overall: DeviceStat; perDevice: DeviceStat[] } {
  const stat = (device: TargetDevice, rs: CaseResult[]): DeviceStat => {
    const counts = countVerdicts(rs);
    return { device, counts, total: rs.length, done: rs.length - counts.nt, passRate: passRate(counts) };
  };
  const perDevice = targets.map((d) =>
    stat(
      d,
      results.filter((r) => r.deviceId === d.id),
    ),
  );
  const overall = stat({ id: 'all', model: '전체', osMajor: 0, resolution: '', label: '전체' }, results);
  return { overall, perDevice };
}

export type CellState = 'done' | 'running' | 'remaining';
export type MatrixCell = {
  tcId: string;
  state: CellState;
  verdict: Verdict;
  executor?: string;
  paused?: boolean;
  pauseReason?: PauseReason;
};
export type MatrixRow = { device: TargetDevice; cells: MatrixCell[]; done: number; running: number; remaining: number };

/** 진행 매트릭스 (F-CY-05): 케이스 × 대상 디바이스 칸을 완료 / 실행 중(실행자) / 남은 칸으로 나눈다. */
export function progressMatrix(
  cases: TestCase[],
  targets: TargetDevice[],
  index: ResultIndex,
  runs: Run[],
): MatrixRow[] {
  return targets.map((device) => {
    const active = runs.filter(
      (r) => r.deviceId === device.id && (r.status === 'running' || r.status === 'paused') && r.currentTcId,
    );
    const cells = cases.map((tc): MatrixCell => {
      const verdict = index.get(resultKey(tc.tcId, device.id))?.verdict ?? 'nt';
      const run = active.find((r) => r.currentTcId === tc.tcId);
      if (run)
        return {
          tcId: tc.tcId,
          state: 'running',
          verdict,
          executor: run.executor,
          paused: run.status === 'paused',
          pauseReason: run.pauseReason,
        };
      return { tcId: tc.tcId, state: verdict === 'nt' ? 'remaining' : 'done', verdict };
    });
    const n = (s: CellState) => cells.filter((c) => c.state === s).length;
    return { device, cells, done: n('done'), running: n('running'), remaining: n('remaining') };
  });
}

export type ReqStatus = Verdict | 'uncovered';
export type TraceRow = {
  requirement: Requirement;
  cases: { tc: TestCase; verdict: Verdict }[];
  status: ReqStatus;
};

/** 추적성 매트릭스: 요구사항별 연결 케이스·커버리지·통과 여부. 연결 케이스가 없으면 미커버. */
export function traceability(
  requirements: Requirement[],
  cases: TestCase[],
  targets: TargetDevice[],
  index: ResultIndex,
): TraceRow[] {
  return requirements.map((requirement) => {
    const linked = cases
      .filter((tc) => tc.requirementIds.includes(requirement.id))
      .map((tc) => ({
        tc,
        verdict: worstVerdict(targets.map((d) => index.get(resultKey(tc.tcId, d.id))?.verdict ?? 'nt')) ?? 'nt',
      }));
    const status: ReqStatus = linked.length === 0 ? 'uncovered' : (worstVerdict(linked.map((c) => c.verdict)) ?? 'nt');
    return { requirement, cases: linked, status };
  });
}

export function traceSummary(rows: TraceRow[]) {
  const covered = rows.filter((r) => r.status !== 'uncovered').length;
  return {
    total: rows.length,
    covered,
    uncovered: rows.length - covered,
    passed: rows.filter((r) => r.status === 'pass').length,
    failing: rows.filter((r) => r.status === 'fail').length,
    coverage: rows.length === 0 ? 0 : covered / rows.length,
  };
}

/** Fail·확인필요·Blocked 셀에 보여줄 한 줄 요약. 없으면 undefined. */
export function oneLineSummary(r: CaseResult | undefined): string | undefined {
  if (!r) return undefined;
  if (r.verdict === 'blocked') return r.blockedReason ?? r.actualSummary;
  if (r.verdict !== 'fail' && r.verdict !== 'check') return undefined;
  if (r.actualSummary) return r.actualSummary;
  const p = r.points.find((x) => x.result !== 'match');
  if (p) return p.observed;
  const unmet = r.unmetConditions[0];
  return unmet ? `자동 확정 불가: ${AUTO_CONFIRM_LABEL[unmet]}` : undefined;
}

export const AUTO_CONDITIONS = Object.keys(AUTO_CONFIRM_LABEL) as AutoConfirmCondition[];
export function autoConfirmChecks(r: CaseResult): { condition: AutoConfirmCondition; label: string; met: boolean }[] {
  return AUTO_CONDITIONS.map((condition) => ({
    condition,
    label: AUTO_CONFIRM_LABEL[condition],
    met: !r.unmetConditions.includes(condition),
  }));
}

/** 판정 주체 표시: Agent(자동 확정) / 사람 이름 */
export function decidedByLabel(r: CaseResult | undefined): string {
  if (!r || r.verdict === 'nt' || !r.decidedBy) return '—';
  if (r.decidedBy.kind === 'human') return r.decidedBy.name;
  return r.autoConfirmed ? 'Agent(자동 확정)' : 'Agent';
}

/**
 * TC ID에서 판정 추적 뷰를 열 때의 디바이스: 확인할 거리가 있는 칸(Fail > Blocked > 확인필요)을 먼저,
 * 없으면 수행한 칸, 그것도 없으면 첫 대상 디바이스.
 */
export function primaryDevice(
  targets: { id: string }[],
  results: Record<string, CaseResult | undefined>,
): string | undefined {
  const pick = (ok: (r: CaseResult) => boolean) => targets.find((t) => results[t.id] && ok(results[t.id]!))?.id;
  for (const v of ['fail', 'blocked', 'check'] as Verdict[]) {
    const id = pick((r) => r.verdict === v);
    if (id) return id;
  }
  return pick((r) => r.verdict !== 'nt') ?? targets[0]?.id;
}

/** 자동 Pass를 사람이 뒤집은 결과 (F-RP-07) */
export const isAutoPassReversal = (r: CaseResult) =>
  r.agentVerdict === 'pass' && r.verdict !== 'pass' && r.decidedBy?.kind === 'human';

export function neighbors<T extends { tcId: string }>(cases: T[], tcId: string): { prev?: T; next?: T; index: number } {
  const index = cases.findIndex((c) => c.tcId === tcId);
  return { prev: index > 0 ? cases[index - 1] : undefined, next: index >= 0 ? cases[index + 1] : undefined, index };
}

/** 테스트 계정 ID 마스킹: 앞 2자만 남긴다. 괄호로 된 설명값은 그대로 둔다. */
export function maskAccount(id: string): string {
  if (id.startsWith('(')) return id;
  const at = id.indexOf('@');
  const local = at >= 0 ? id.slice(0, at) : id;
  const masked = local.slice(0, 2) + '*'.repeat(Math.max(2, local.length - 2));
  return at >= 0 ? masked + id.slice(at) : masked;
}

/** 검색: TC ID, 출처, 제목, 요구사항 ID, 기능/세부 기능 */
export function matchesQuery(tc: TestCase, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [tc.tcId, tc.sourceId, tc.title, tc.feature, tc.subFeature, ...tc.requirementIds].some((s) =>
    s.toLowerCase().includes(q),
  );
}

export type VerdictFilter = Verdict | 'all';
/** 판정 필터: 대상 디바이스 중 한 칸이라도 그 판정이면 통과 */
export function matchesVerdict(tc: TestCase, targets: TargetDevice[], index: ResultIndex, f: VerdictFilter): boolean {
  if (f === 'all') return true;
  return targets.some((d) => (index.get(resultKey(tc.tcId, d.id))?.verdict ?? 'nt') === f);
}

/** 케이스 단위 판정 건수 (어느 디바이스든 그 판정이 있는 케이스 수) — 판정 필터 칩 숫자 */
export function caseVerdictCounts(cases: TestCase[], targets: TargetDevice[], index: ResultIndex): VerdictCounts {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
  for (const tc of cases) for (const v of VERDICTS) if (matchesVerdict(tc, targets, index, v)) counts[v]++;
  return counts;
}

/** 요구사항 ID에서 스펙 이름을 뺀 짧은 표기: `onboarding-flow/FR-001` → `FR-001` */
export const shortId = (id: string) => id.slice(id.lastIndexOf('/') + 1);
