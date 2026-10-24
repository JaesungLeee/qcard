// QA 문서 검토 화면의 순수 로직: 필터·그룹·diff·재적용·커버리지. 화면 코드와 분리해 테스트한다.
import {
  PLATFORM_LABEL,
  POINT_COMPARE_LABEL,
  POINT_METHOD_LABEL,
  PRIORITY_LABEL,
  TEST_TYPE_LABEL,
  type CaseBody,
  type CaseChange,
  type QADocument,
  type Requirement,
  type TestCase,
} from '@qcard/shared';

// ---------------------------------------------------------------- 케이스 본문

export const BODY_KEYS = [
  'title',
  'preconditions',
  'prepFlowIds',
  'cleanState',
  'accountRole',
  'data',
  'steps',
  'verificationPoints',
  'priority',
  'type',
  'platform',
  'mode',
] as const satisfies readonly (keyof CaseBody)[];
export type BodyKey = (typeof BODY_KEYS)[number];

export const BODY_LABEL: Record<BodyKey, string> = {
  title: '제목',
  preconditions: '사전 조건',
  prepFlowIds: '준비 플로우',
  cleanState: '클린 상태',
  accountRole: '필요 계정 역할',
  data: '테스트 데이터',
  steps: '단계',
  verificationPoints: '검증 포인트',
  priority: '우선순위',
  type: '유형',
  platform: '플랫폼',
  mode: '수행 방식',
};

/** 케이스에서 편집 대상 본문만 꺼낸다 (깊은 복사). */
export function toBody(c: CaseBody): CaseBody {
  const body = {} as Record<BodyKey, unknown>;
  for (const k of BODY_KEYS) if (c[k] !== undefined) body[k] = structuredClone(c[k]);
  return body as CaseBody;
}

const norm = (v: unknown) => (v === '' ? undefined : v);
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** 저장 전에 빈 값 정리: 빈 문자열 선택 필드는 지우고, 빈 사전 조건 줄은 뺀다. */
export function cleanBody(body: CaseBody): CaseBody {
  const out = toBody(body);
  out.title = out.title.trim();
  out.preconditions = out.preconditions.map((p) => p.trim()).filter(Boolean);
  if (!out.accountRole?.trim()) delete out.accountRole;
  if (!out.data?.trim()) delete out.data;
  return out;
}

export function validateBody(body: CaseBody): string[] {
  const errors: string[] = [];
  if (!body.title.trim()) errors.push('제목을 입력하세요.');
  if (body.steps.length === 0) errors.push('단계가 하나 이상 있어야 합니다.');
  if (body.steps.some((s) => !s.text.trim())) errors.push('비어 있는 단계가 있습니다.');
  if (body.verificationPoints.length === 0) errors.push('검증 포인트가 하나 이상 있어야 합니다.');
  if (body.verificationPoints.some((p) => !p.expected.trim()))
    errors.push('기대값이 비어 있는 검증 포인트가 있습니다.');
  return errors;
}

export function isDirty(base: CaseBody, draft: CaseBody): boolean {
  return BODY_KEYS.some((k) => !same(base[k], draft[k]));
}

/** 새 검증 포인트 ID: `<TC ID>-P<n>` 중 아직 안 쓴 번호 */
export function nextPointId(tcId: string, body: CaseBody): string {
  const used = new Set(body.verificationPoints.map((p) => p.id));
  let n = body.verificationPoints.length + 1;
  while (used.has(`${tcId}-P${n}`)) n++;
  return `${tcId}-P${n}`;
}

// ---------------------------------------------------------------- 필터·그룹

export type ChangeFilter = CaseChange | 'all';
export type CaseFilter = { change: ChangeFilter; unapprovedOnly: boolean; q: string };

export const isActive = (c: TestCase) => c.change !== 'removed';
/** 승인 대상(실행 대상)인데 아직 승인되지 않은 케이스 */
export const needsApproval = (c: TestCase) => isActive(c) && c.approval.status !== 'approved';
/** 일괄 승인·반려할 수 있는 케이스: 삭제·보류 제외 */
export const isSelectable = (c: TestCase) => isActive(c) && c.approval.status !== 'held';

export function filterCases(cases: TestCase[], f: CaseFilter): TestCase[] {
  const q = f.q.trim().toLowerCase();
  return cases.filter((c) => {
    if (f.change !== 'all' && c.change !== f.change) return false;
    if (f.unapprovedOnly && !needsApproval(c)) return false;
    if (!q) return true;
    return [c.tcId, c.title, c.sourceId, ...c.requirementIds].some((s) => s.toLowerCase().includes(q));
  });
}

export function countBy<K extends string>(cases: TestCase[], key: (c: TestCase) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const c of cases) out[key(c)] = (out[key(c)] ?? 0) + 1;
  return out;
}

export type GroupRow = {
  kind: 'group';
  key: string;
  feature: string;
  subFeature: string;
  total: number;
  approved: number;
  /** 이 묶음이 이전 페이지에서 이어진다 */
  continued: boolean;
};
export type CaseRow = { kind: 'case'; case: TestCase };
export type GridRow = GroupRow | CaseRow;

const groupKey = (c: TestCase) => `${c.feature}\u0000${c.subFeature}`;

/** 기능 › 세부 기능(유저 플로우) 단위로 모아 편다. 묶음은 처음 나온 순서, 묶음 안은 원래 순서. */
export function orderByGroup(cases: TestCase[]): TestCase[] {
  const groups = new Map<string, TestCase[]>();
  for (const c of cases) {
    const list = groups.get(groupKey(c));
    if (list) list.push(c);
    else groups.set(groupKey(c), [c]);
  }
  return [...groups.values()].flat();
}

/**
 * 묶음 머리 행을 넣는다. `items`는 `orderByGroup`으로 편 `context`의 연속 구간(한 페이지)이다.
 * 승인 수는 `context` 전체에서 세고(삭제 케이스 제외), 첫 묶음이 앞 페이지에서 이어지면 `continued`.
 */
export function groupRows(items: TestCase[], context: TestCase[] = items): GridRow[] {
  const counts = new Map<string, { total: number; approved: number }>();
  for (const c of context) {
    const n = counts.get(groupKey(c)) ?? { total: 0, approved: 0 };
    if (isActive(c)) {
      n.total++;
      if (c.approval.status === 'approved') n.approved++;
    }
    counts.set(groupKey(c), n);
  }
  const start = items.length > 0 ? context.indexOf(items[0]!) : -1;
  const rows: GridRow[] = [];
  let last: string | null = null;
  for (const c of items) {
    const key = groupKey(c);
    if (key !== last) {
      const before = rows.length === 0 && start > 0 ? context[start - 1] : undefined;
      rows.push({
        kind: 'group',
        key,
        feature: c.feature,
        subFeature: c.subFeature,
        ...counts.get(key)!,
        continued: !!before && groupKey(before) === key,
      });
      last = key;
    }
    rows.push({ kind: 'case', case: c });
  }
  return rows;
}

/** 분류 범위: 기능만, 또는 기능 › 세부 기능. 비면 전체 */
export type CaseScope = { feature: string | null; subFeature: string | null };

export const inScope = (c: TestCase, s: CaseScope) =>
  (s.feature === null || c.feature === s.feature) && (s.subFeature === null || c.subFeature === s.subFeature);

type Tally = { count: number; total: number; approved: number };
export type FlowNode = Tally & { subFeature: string };
export type FeatureNode = Tally & { feature: string; hasNew: boolean; flows: FlowNode[] };

/** 분류 목록: 기능 › 세부 기능별 케이스 수와 승인 수(삭제 케이스 제외). 처음 나온 순서 */
export function caseTree(cases: TestCase[]): FeatureNode[] {
  const features = new Map<string, FeatureNode>();
  const add = (n: Tally, c: TestCase) => {
    n.count++;
    if (isActive(c)) {
      n.total++;
      if (c.approval.status === 'approved') n.approved++;
    }
  };
  for (const c of cases) {
    let f = features.get(c.feature);
    if (!f) {
      f = { feature: c.feature, count: 0, total: 0, approved: 0, hasNew: false, flows: [] };
      features.set(c.feature, f);
    }
    let flow = f.flows.find((x) => x.subFeature === c.subFeature);
    if (!flow) {
      flow = { subFeature: c.subFeature, count: 0, total: 0, approved: 0 };
      f.flows.push(flow);
    }
    add(f, c);
    add(flow, c);
    if (c.change === 'new') f.hasNew = true;
  }
  return [...features.values()];
}

export const PAGE_SIZES = [10, 20, 50] as const;

/** `page`(1부터)를 범위 안으로 맞춰 자른다. */
export function paginate<T>(items: T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return { page: current, pageCount, start, items: items.slice(start, start + size) };
}

/** `onboarding-flow/TS-008` → `TS-008` */
export const shortSource = (sourceId: string) => sourceId.split('/').pop() ?? sourceId;
/** `onboarding-flow/FR-007` → `FR-007` */
export const shortReq = shortSource;

// ---------------------------------------------------------------- diff

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string };
export type FieldDiff = { key: BodyKey; label: string; lines: DiffLine[] };

/** 줄 단위 LCS diff */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: 'del', text: a[i++]! });
    else out.push({ op: 'add', text: b[j++]! });
  }
  while (i < n) out.push({ op: 'del', text: a[i++]! });
  while (j < m) out.push({ op: 'add', text: b[j++]! });
  return out;
}

/** 본문 필드 하나를 사람이 읽는 줄 목록으로 */
export function fieldLines(body: CaseBody, key: BodyKey, prepName: (id: string) => string = (id) => id): string[] {
  switch (key) {
    case 'title':
      return [body.title];
    case 'preconditions':
      return body.preconditions;
    case 'prepFlowIds':
      return body.prepFlowIds.map(prepName);
    case 'cleanState':
      return [body.cleanState ? '필요 (앱 데이터 초기화)' : '필요 없음'];
    case 'accountRole':
      return body.accountRole ? [body.accountRole] : [];
    case 'data':
      return body.data ? [body.data] : [];
    case 'steps':
      return body.steps.map((s, i) => `${i + 1}. ${s.text}${s.manual ? ' (수동)' : ''}`);
    case 'verificationPoints':
      return body.verificationPoints.map(
        (p) => `${p.expected} (${POINT_COMPARE_LABEL[p.compare]} · 대상 ${p.target} · ${POINT_METHOD_LABEL[p.method]})`,
      );
    case 'priority':
      return [PRIORITY_LABEL[body.priority]];
    case 'type':
      return [TEST_TYPE_LABEL[body.type]];
    case 'platform':
      return [PLATFORM_LABEL[body.platform]];
    case 'mode':
      return [body.mode === 'auto' ? 'Auto' : 'Manual'];
  }
}

/** 이전 블록 대비 바뀐 필드만 줄 단위 diff로 돌려준다. */
export function diffCase(before: CaseBody, after: CaseBody, prepName?: (id: string) => string): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const key of BODY_KEYS) {
    if (same(before[key], after[key])) continue;
    out.push({
      key,
      label: BODY_LABEL[key],
      lines: diffLines(fieldLines(before, key, prepName), fieldLines(after, key, prepName)),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 충돌 후 재적용 (F-QD-09)

export type Rebase = {
  body: CaseBody;
  /** 내가 바꾼 필드 (최신 내용 위에 다시 적용됨) */
  mine: BodyKey[];
  /** 나와 상대가 같은 필드를 서로 다르게 바꾼 경우 — 내 값으로 덮었으니 확인이 필요하다 */
  conflicts: BodyKey[];
};

/**
 * 3-way 재적용: 내가 편집을 시작한 기준(base) 대비 내가 바꾼 필드만 최신(latest) 위에 얹는다.
 * 내가 안 건드린 필드는 최신 값을 따른다.
 */
export function rebaseDraft(base: CaseBody, mine: CaseBody, latest: CaseBody): Rebase {
  const body = toBody(latest) as Record<BodyKey, unknown>;
  const changed: BodyKey[] = [];
  const conflicts: BodyKey[] = [];
  for (const k of BODY_KEYS) {
    if (same(base[k], mine[k])) continue;
    changed.push(k);
    if (!same(base[k], latest[k]) && !same(latest[k], mine[k])) conflicts.push(k);
    if (mine[k] === undefined || mine[k] === '') delete body[k];
    else body[k] = structuredClone(mine[k]);
  }
  return { body: body as CaseBody, mine: changed, conflicts };
}

// ---------------------------------------------------------------- 추적성 (F-QD-11)

export type CoverageRow = {
  requirement: Requirement;
  cases: TestCase[];
  approved: number;
  openQuestions: number;
  suggestions: number;
  status: 'none' | 'partial' | 'full';
};

export function coverage(doc: Pick<QADocument, 'requirements' | 'cases' | 'questions' | 'suggestions'>): {
  rows: CoverageRow[];
  covered: number;
  uncovered: number;
} {
  const rows = doc.requirements.map((r): CoverageRow => {
    const cases = doc.cases.filter((c) => isActive(c) && c.requirementIds.includes(r.id));
    const approved = cases.filter((c) => c.approval.status === 'approved').length;
    return {
      requirement: r,
      cases,
      approved,
      openQuestions: doc.questions.filter((q) => q.requirementId === r.id && q.status === 'open').length,
      suggestions: doc.suggestions.filter((s) => s.requirementId === r.id).length,
      status: cases.length === 0 ? 'none' : approved === cases.length ? 'full' : 'partial',
    };
  });
  const uncovered = rows.filter((r) => r.status === 'none').length;
  return { rows, covered: rows.length - uncovered, uncovered };
}

// ---------------------------------------------------------------- 준비 플로우 사용처

export function prepFlowUsage(cases: TestCase[]): Map<string, TestCase[]> {
  const out = new Map<string, TestCase[]>();
  for (const c of cases) {
    if (!isActive(c)) continue;
    for (const id of c.prepFlowIds) {
      const list = out.get(id) ?? [];
      list.push(c);
      out.set(id, list);
    }
  }
  return out;
}
