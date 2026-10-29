import { describe, expect, it } from 'vitest';
import type { Member, PrepFlow, TestCase, TestCycle } from './domain';
import { MembershipError } from './membership';
import {
  newPrepFlow,
  prepFlowChange,
  prepFlowDeleteBlocker,
  prepFlowDeletion,
  prepFlowIdFor,
  prepFlowProblem,
  prepFlowUses,
  flowsUsedBy,
  splitPrepFlowsByDoc,
} from './prepFlows';

const T0 = '2026-10-28T10:00:00.000Z';
const members: Member[] = [
  { projectId: 'p', uid: 'u-qa', user: '김민지', github: 'minji', role: 'qa', joinedAt: T0, dataNoticeAckAt: T0 },
  { projectId: 'p', uid: 'u-v', user: '박도윤', github: 'doyoon', role: 'viewer', joinedAt: T0, dataNoticeAckAt: T0 },
];
const qa = { uid: 'u-qa', name: '김민지' };
const viewer = { uid: 'u-v', name: '박도윤' };
const login = {
  name: '로그인 상태',
  kind: 'login' as const,
  check: '홈 탭이 보인다',
  steps: ['아이디 입력', '[로그인]'],
};

const kind = (f: () => void) => {
  try {
    f();
  } catch (e) {
    return e instanceof MembershipError ? e.kind : 'other';
  }
  return 'ok';
};

const tc = (tcId: string, prepFlowIds: string[], extra: Partial<TestCase> = {}) =>
  ({ tcId, prepFlowIds, change: 'same', ...extra }) as TestCase;
const cycle = (id: string, extra: Partial<TestCycle> = {}) =>
  ({ id, name: `사이클 ${id}`, period: { start: T0 }, ...extra }) as TestCycle;

describe('준비 플로우 편집 (F-PF-01)', () => {
  it('이름·확인 조건은 필수, env가 아니면 스텝이 1개 이상', () => {
    expect(prepFlowProblem(login)).toBeUndefined();
    expect(prepFlowProblem({ ...login, name: '  ' })).toContain('이름');
    expect(prepFlowProblem({ ...login, check: '' })).toContain('확인 조건');
    expect(prepFlowProblem({ ...login, steps: ['', ' '] })).toContain('스텝');
    expect(prepFlowProblem({ ...login, kind: 'env', steps: [] })).toBeUndefined();
  });

  it('id는 pf-<종류>, 겹치면 숫자를 붙인다', () => {
    expect(prepFlowIdFor('login', () => false)).toBe('pf-login');
    expect(prepFlowIdFor('data_state', (id) => ['pf-data', 'pf-data-2'].includes(id))).toBe('pf-data-3');
  });

  it('추가: Admin·QA만, 공백을 다듬고 rev 1로 만든다', () => {
    expect(kind(() => newPrepFlow(members, viewer, login, [], T0))).toBe('permission');
    expect(kind(() => newPrepFlow(members, qa, { ...login, steps: [] }, [], T0))).toBe('rule');
    const existing = [{ id: 'pf-login', ...login }];
    const f = newPrepFlow(members, qa, { ...login, name: ' 관리자 로그인 ', steps: ['a', ' ', 'b '] }, existing, T0);
    expect(f).toEqual({
      id: 'pf-login-2',
      name: '관리자 로그인',
      kind: 'login',
      check: '홈 탭이 보인다',
      steps: ['a', 'b'],
      rev: 1,
      updatedBy: '김민지',
      updatedAt: T0,
    });
  });

  it('편집: rev가 오르고 id는 그대로. QA 문서 생성이 만든 플로우(rev 없음)는 0에서 시작', () => {
    const generated: PrepFlow = { id: 'pf-done', ...login };
    const next = prepFlowChange(members, qa, generated, { ...login, kind: 'data_state' }, T0);
    expect(next).toMatchObject({ id: 'pf-done', kind: 'data_state', rev: 1, updatedBy: '김민지' });
    expect(prepFlowChange(members, qa, next, login, T0).rev).toBe(2);
    expect(kind(() => prepFlowChange(members, viewer, next, login, T0))).toBe('permission');
  });
});

describe('준비 플로우 사용처·삭제', () => {
  const doc = {
    id: 'd2',
    appVersion: '1.1.0',
    cases: [
      tc('TC-1', ['pf-a']),
      tc('TC-2', ['pf-gone'], { change: 'removed' }),
      tc('TC-9', ['pf-old'], { restoreFlowId: 'pf-undo' }),
    ],
  };
  const cycles = [
    { cycle: cycle('c-open', { docId: 'd2' }), cases: [tc('TC-5', ['pf-cycle', 'pf-cycle'])] },
    { cycle: cycle('c-other', { docId: 'd1' }), cases: [tc('TC-8', ['pf-a'])] },
    { cycle: cycle('c-done', { docId: 'd2', period: { start: T0, end: T0 } }), cases: [tc('TC-6', ['pf-closed'])] },
    { cycle: cycle('c-local', { docId: 'd2', origin: 'local_run' }), cases: [tc('TC-7', ['pf-local'])] },
  ];
  const uses = prepFlowUses(doc, cycles);

  it('그 버전의 활성 케이스와 원복 플로우를 본다 (삭제 케이스 제외)', () => {
    expect(uses['pf-a']).toEqual([{ tcId: 'TC-1', in: 'doc', docId: 'd2', appVersion: '1.1.0' }]);
    expect(uses['pf-old']).toHaveLength(1);
    expect(uses['pf-undo']).toHaveLength(1);
    expect(uses['pf-gone']).toBeUndefined();
  });

  it('그 버전으로 만든 완료되지 않은 사이클의 케이스 사본만 본다', () => {
    expect(uses['pf-cycle']).toEqual([{ tcId: 'TC-5', in: 'cycle', cycleId: 'c-open', cycleName: '사이클 c-open' }]);
    expect(uses['pf-closed']).toBeUndefined();
    expect(uses['pf-local']).toBeUndefined();
  });

  it('사용처가 있으면 이유와 함께 막는다', () => {
    expect(prepFlowDeleteBlocker([])).toBeUndefined();
    const blocker = prepFlowDeleteBlocker([...uses['pf-a']!, ...uses['pf-cycle']!])!;
    expect(blocker).toContain('2개 케이스');
    expect(blocker).toContain('QA 문서 1.1.0');
    expect(blocker).toContain('사이클 “사이클 c-open”');
    expect(kind(() => prepFlowDeletion(members, qa, uses['pf-a']!))).toBe('rule');
    expect(kind(() => prepFlowDeletion(members, viewer, []))).toBe('permission');
    expect(kind(() => prepFlowDeletion(members, qa, []))).toBe('ok');
  });
});

describe('QA 문서 버전별 사본 (F-PF-01, F-QD-08)', () => {
  const f = (id: string): PrepFlow => ({ id, name: id, kind: 'data_state', check: '-', steps: ['-'] });
  const flows = [f('pf-a'), f('pf-b'), f('pf-undo'), f('pf-manual'), f('pf-gone')];

  it('이어받기: 활성 케이스가 참조하는 플로우만, 목록 순서대로', () => {
    const cases = [
      tc('TC-2', ['pf-b'], { restoreFlowId: 'pf-undo' }),
      tc('TC-1', ['pf-a', 'pf-missing']),
      tc('TC-3', ['pf-gone'], { change: 'removed' }),
    ];
    expect(flowsUsedBy(flows, cases).map((x) => x.id)).toEqual(['pf-a', 'pf-b', 'pf-undo']);
  });

  it('공용 목록 나누기: 참조하는 버전마다, 아무도 안 쓰는 플로우는 최신 버전에', () => {
    const docs = [
      { id: 'd1', createdAt: '2026-10-01', cases: [tc('TC-1', ['pf-a', 'pf-b'])] },
      { id: 'd2', createdAt: '2026-10-02', cases: [tc('TC-1', ['pf-a'])] },
    ];
    const out = splitPrepFlowsByDoc(flows, docs);
    expect(out['d1']!.map((x) => x.id)).toEqual(['pf-a', 'pf-b']);
    expect(out['d2']!.map((x) => x.id)).toEqual(['pf-a', 'pf-undo', 'pf-manual', 'pf-gone']);
    expect(splitPrepFlowsByDoc(flows, [])).toEqual({});
  });
});
