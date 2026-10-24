import type { CaseBody } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../data/api';
import { createMemoryApi } from '../../data/memory';
import {
  cleanBody,
  coverage,
  diffCase,
  diffLines,
  filterCases,
  caseTree,
  groupRows,
  inScope,
  isDirty,
  orderByGroup,
  paginate,
  isSelectable,
  nextPointId,
  prepFlowUsage,
  rebaseDraft,
  toBody,
  validateBody,
} from './logic';
import { suggestionsText } from './SuggestionsTab';

const api = () => createMemoryApi();
const DOC130 = { projectId: 'haru', docId: 'doc-130' };
const doc130 = () => api().getQaDoc(DOC130);

describe('doc-130 fixture 전제', () => {
  it('62개: 동일 54 · 변경 3 · 신규 4 · 삭제 1', async () => {
    const d = await doc130();
    const by = (k: string) => d.cases.filter((c) => c.change === k).length;
    expect(d.cases).toHaveLength(62);
    expect([by('same'), by('changed'), by('new'), by('removed')]).toEqual([54, 3, 4, 1]);
  });
});

describe('filterCases', () => {
  it('변경 필터·미승인만·검색을 함께 적용한다', async () => {
    const d = await doc130();
    const all = { change: 'all' as const, unapprovedOnly: false, q: '' };
    expect(filterCases(d.cases, all)).toHaveLength(62);
    expect(filterCases(d.cases, { ...all, change: 'changed' }).map((c) => c.sourceId)).toEqual([
      'onboarding-flow/TS-008',
      'onboarding-flow/EC-004',
      'onboarding-flow/TS-019',
    ]);
    // 미승인 = 미승인 5 + 보류 2 (삭제 케이스는 제외)
    expect(filterCases(d.cases, { ...all, unapprovedOnly: true })).toHaveLength(7);
    expect(filterCases(d.cases, { ...all, q: 'ts-008' }).map((c) => c.tcId)).toEqual(['TC-ONBOARDING-008']);
    expect(filterCases(d.cases, { ...all, q: 'FR-022' }).length).toBeGreaterThan(0);
  });

  it('보류·삭제 케이스는 일괄 선택할 수 없다', async () => {
    const d = await doc130();
    const notSelectable = d.cases.filter((c) => !isSelectable(c)).map((c) => c.tcId);
    expect(notSelectable.sort()).toEqual(['TC-ONBOARDING-030', 'TC-ONBOARDING-056', 'TC-ONBOARDING-062']);
  });
});

describe('groupRows', () => {
  it('기능 › 세부 기능 순서대로 묶고, 승인 수는 삭제 케이스를 빼고 센다', async () => {
    const d = await doc130();
    const rows = groupRows(orderByGroup(d.cases));
    const groups = rows.filter((r) => r.kind === 'group');
    expect(groups.map((g) => g.subFeature)).toEqual([
      '온보딩을 처음부터 끝까지 밟는다',
      '첫 습관 만들기를 건너뛴다',
      '첫 습관에 메이트를 초대한다',
      '사용법 안내를 본다',
      '온보딩을 끝낸 뒤 앱을 다시 켠다',
    ]);
    expect(rows.filter((r) => r.kind === 'case')).toHaveLength(62);
    // 삭제 케이스(TS-040)는 첫 그룹에 들어가지만 total에는 안 센다
    expect(groups[0]).toMatchObject({ total: 15 });
    expect(rows[16]).toMatchObject({ kind: 'case', case: { tcId: 'TC-ONBOARDING-062' } });
    expect(groups.every((g) => !g.continued)).toBe(true);
  });

  it('페이지 단위로 묶을 때 승인 수는 전체에서 세고, 앞 페이지에서 이어지는 묶음을 표시한다', async () => {
    const d = await doc130();
    const all = orderByGroup(d.cases);
    const p2 = paginate(all, 2, 10);
    const rows = groupRows(p2.items, all);
    // 첫 묶음(16개)이 1페이지에서 이어진다
    expect(rows[0]).toMatchObject({ kind: 'group', subFeature: '온보딩을 처음부터 끝까지 밟는다', total: 15, continued: true });
    expect(rows.filter((r) => r.kind === 'case')).toHaveLength(10);
    const second = rows.filter((r) => r.kind === 'group')[1];
    expect(second).toMatchObject({ continued: false });
  });
});

describe('paginate', () => {
  it('페이지를 범위 안으로 맞춘다', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    expect(paginate(items, 1, 10)).toMatchObject({ page: 1, pageCount: 3, start: 0, items: items.slice(0, 10) });
    expect(paginate(items, 3, 10).items).toEqual([20, 21, 22, 23, 24]);
    expect(paginate(items, 9, 10)).toMatchObject({ page: 3, start: 20 });
    expect(paginate(items, 0, 10)).toMatchObject({ page: 1 });
    expect(paginate([], 2, 10)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});

describe('caseTree · inScope', () => {
  it('기능 › 세부 기능별로 케이스 수와 승인 수를 센다', async () => {
    const d = await doc130();
    const tree = caseTree(d.cases);
    expect(tree).toHaveLength(1);
    const [f] = tree;
    expect(f!.count).toBe(62);
    expect(f!.total).toBe(61); // 삭제 1 제외
    expect(f!.hasNew).toBe(true);
    expect(f!.flows.map((x) => x.subFeature)).toHaveLength(5);
    expect(f!.flows.reduce((n, x) => n + x.count, 0)).toBe(62);
  });

  it('기능만 고르면 그 기능 전체, 세부 기능까지 고르면 그 플로우만', async () => {
    const d = await doc130();
    const [f] = caseTree(d.cases);
    const flow = f!.flows[1]!;
    expect(d.cases.filter((c) => inScope(c, { feature: null, subFeature: null }))).toHaveLength(62);
    expect(d.cases.filter((c) => inScope(c, { feature: f!.feature, subFeature: null }))).toHaveLength(62);
    expect(d.cases.filter((c) => inScope(c, { feature: f!.feature, subFeature: flow.subFeature }))).toHaveLength(
      flow.count,
    );
    expect(d.cases.filter((c) => inScope(c, { feature: '없는 기능', subFeature: null }))).toHaveLength(0);
  });
});

describe('diff', () => {
  it('diffLines: LCS 기준으로 같은 줄을 유지한다', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });

  it('변경 케이스는 이전 블록 대비 검증 포인트만 바뀌었다', async () => {
    const d = await doc130();
    const c = d.cases.find((x) => x.sourceId.endsWith('TS-008'))!;
    const diffs = diffCase(c.previous!, toBody(c));
    expect(diffs.map((x) => x.key)).toEqual(['verificationPoints']);
    const lines = diffs[0]!.lines;
    expect(lines.some((l) => l.op === 'del' && l.text.includes('첫 습관 만들기 스텝에 머물러 있다'))).toBe(true);
    expect(lines.some((l) => l.op === 'add')).toBe(true);
  });

  it('빈 문자열과 undefined는 같은 값으로 본다', async () => {
    const d = await doc130();
    const body = toBody(d.cases[0]!);
    expect(isDirty(body, { ...body, accountRole: '' })).toBe(false);
    expect(isDirty(body, { ...body, title: body.title + '!' })).toBe(true);
  });
});

describe('편집 검증', () => {
  it('cleanBody는 빈 선택 필드·빈 사전 조건 줄을 지운다', async () => {
    const d = await doc130();
    const body: CaseBody = { ...toBody(d.cases[0]!), data: '  ', preconditions: ['a', ' '], title: ' t ' };
    const out = cleanBody(body);
    expect(out.data).toBeUndefined();
    expect(out.preconditions).toEqual(['a']);
    expect(out.title).toBe('t');
  });

  it('validateBody', async () => {
    const d = await doc130();
    const body = toBody(d.cases[0]!);
    expect(validateBody(body)).toEqual([]);
    expect(validateBody({ ...body, title: '', steps: [], verificationPoints: [] })).toHaveLength(3);
  });

  it('nextPointId는 쓰지 않은 번호를 고른다', async () => {
    const d = await doc130();
    const c = d.cases[0]!;
    const id = nextPointId(c.tcId, c);
    expect(c.verificationPoints.map((p) => p.id)).not.toContain(id);
  });
});

describe('낙관적 잠금 + 다시 적용 (F-QD-09)', () => {
  it('같은 rev로 두 번 저장하면 두 번째는 ConflictError, 내 편집을 최신 위에 다시 적용해 저장한다', async () => {
    const shared = api();
    const d = await shared.getQaDoc(DOC130);
    const c = d.cases.find((x) => x.sourceId.endsWith('TS-008'))!;
    const base = toBody(c);

    // 상대: 우선순위를 바꿔 먼저 저장
    await shared.updateCase(DOC130, c.tcId, { ...base, priority: 'high' }, c.rev);

    // 나: 같은 rev에서 제목을 바꿔 저장 → 충돌
    const mine: CaseBody = { ...base, title: `${base.title} (수정)` };
    const err = await shared.updateCase(DOC130, c.tcId, mine, c.rev).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const latest = (err as ConflictError).latest;
    expect(latest.rev).toBe(c.rev + 1);

    const r = rebaseDraft(base, mine, toBody(latest));
    expect(r.mine).toEqual(['title']);
    expect(r.conflicts).toEqual([]);
    expect(r.body.priority).toBe('high'); // 상대 변경 유지
    expect(r.body.title).toBe(mine.title); // 내 변경 다시 적용

    const saved = await shared.updateCase(DOC130, c.tcId, r.body, latest.rev);
    expect(saved).toMatchObject({ rev: c.rev + 2, title: mine.title, priority: 'high' });
  });

  it('같은 필드를 서로 다르게 바꾸면 conflicts로 알린다', async () => {
    const d = await doc130();
    const base = toBody(d.cases[0]!);
    const r = rebaseDraft(base, { ...base, title: '내 제목' }, { ...base, title: '상대 제목' });
    expect(r.conflicts).toEqual(['title']);
    expect(r.body.title).toBe('내 제목');
  });

  it('내가 지운 선택 필드는 다시 적용해도 지워진다', async () => {
    const d = await doc130();
    const withData = d.cases.find((c) => c.data)!;
    const base = toBody(withData);
    const r = rebaseDraft(base, { ...base, data: '' }, { ...base, priority: 'low' });
    expect(r.body.data).toBeUndefined();
    expect(r.body.priority).toBe('low');
  });

  it('승인된 케이스 내용을 바꾸면 미승인으로 돌아간다', async () => {
    const shared = api();
    const d = await shared.getQaDoc(DOC130);
    const c = d.cases.find((x) => x.approval.status === 'approved' && x.change === 'same')!;
    const saved = await shared.updateCase(DOC130, c.tcId, { ...toBody(c), title: 'x' }, c.rev);
    expect(saved.approval.status).toBe('pending');
  });
});

describe('coverage · prepFlowUsage', () => {
  it('요구사항마다 삭제 케이스를 뺀 케이스 수와 승인 수를 센다', async () => {
    const d = await doc130();
    const cov = coverage(d);
    expect(cov.rows).toHaveLength(d.requirements.length);
    const ux6 = cov.rows.find((r) => r.requirement.id === 'onboarding-flow/UX-006')!;
    expect(ux6.cases.map((c) => c.sourceId)).toEqual(['onboarding-flow/TS-010']);
    const ux3 = cov.rows.find((r) => r.requirement.id === 'onboarding-flow/UX-003')!;
    expect(ux3.openQuestions).toBe(1);
    expect(ux3.status).toBe('partial');
  });

  it('케이스가 없는 요구사항은 none', async () => {
    const d = await doc130();
    const cov = coverage({ ...d, cases: d.cases.filter((c) => !c.requirementIds.includes('onboarding-flow/FR-024')) });
    expect(cov.rows.find((r) => r.requirement.id === 'onboarding-flow/FR-024')!.status).toBe('none');
    expect(cov.uncovered).toBe(1);
  });

  it('준비 플로우별 사용 케이스 (삭제 케이스 제외)', async () => {
    const d = await doc130();
    const usage = prepFlowUsage(d.cases);
    expect(usage.get('pf-clean')).toHaveLength(61);
    const total = ['pf-habit', 'pf-mate', 'pf-guide', 'pf-done'].reduce(
      (n, id) => n + (usage.get(id)?.length ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(61);
  });
});

describe('suggestionsText', () => {
  it('요구사항·기법 라벨이 들어간 전달용 텍스트', async () => {
    const d = await doc130();
    const text = suggestionsText(d);
    expect(text).toContain('스펙 보강 제안 5건');
    expect(text).toContain('onboarding-flow/FR-009 (경계값)');
  });
});
