import { describe, expect, it } from 'vitest';
import type { Build, CaseResult, Defect, Member, TestCycle } from './domain';
import { retestIssueComment } from './issues';
import { MembershipError } from './membership';
import {
  isNewerBuild,
  isRetestTarget,
  retestCell,
  retestConfirmation,
  retestReading,
  type RetestSource,
} from './retest';

const S24_15 = {
  id: 'galaxy-s24-15',
  model: 'Galaxy S24',
  osMajor: 15,
  resolution: '—',
  label: 'Galaxy S24 (Android 15)',
};
const S24_16 = { ...S24_15, id: 'galaxy-s24-16', osMajor: 16, label: 'Galaxy S24 (Android 16)' };

const build = (id: string, buildNumber: number, packageName = 'com.harukong'): Build => ({
  id,
  version: `1.${buildNumber}`,
  buildNumber,
  packageName,
  signingSha1: 'AA',
  uploadedAt: '2026-11-01T00:00:00.000Z',
});

const cycle = (id: string, buildId: string, over: Partial<TestCycle> = {}): TestCycle => ({
  id,
  projectId: 'haru',
  name: `${id} 회귀`,
  docId: 'doc',
  buildId,
  targets: [S24_15],
  period: { start: '2026-11-01T00:00:00.000Z' },
  serverEnv: 'stage',
  snapshot: [{ tcId: 'TC-1', contentHash: 'h1' }],
  createdBy: '이재성',
  ...over,
});

const defect = (over: Partial<Defect> = {}): Defect => ({
  id: 'D-1',
  title: '버튼이 안 보인다',
  severity: 'major',
  tcId: 'TC-1',
  deviceId: S24_15.id,
  repro: ['앱을 연다'],
  expected: '보인다',
  actual: '안 보인다',
  status: 'fixed',
  ...over,
});

const result = (over: Partial<CaseResult> = {}): CaseResult => ({
  tcId: 'TC-1',
  deviceId: S24_15.id,
  verdict: 'pass',
  decidedBy: { kind: 'agent' },
  autoConfirmed: true,
  unmetConditions: [],
  attempts: 1,
  steps: [],
  points: [],
  history: [],
  ...over,
});

const A = cycle('a', 'b120');
const B = cycle('b', 'b130');
const src = (d: Partial<Defect> = {}): RetestSource => ({ cycle: A, build: build('b120', 120), defect: defect(d) });
const inB = { cycle: B, build: build('b130', 130) };

const members: Member[] = [
  { projectId: 'haru', uid: 'u-qa', user: '김민지', github: 'minji-kim', role: 'qa', joinedAt: '' },
  { projectId: 'haru', uid: 'u-viewer', user: '박도윤', github: 'doyoon-park', role: 'viewer', joinedAt: '' },
] as Member[];
const qa = { uid: 'u-qa', name: '김민지', github: 'minji-kim' };
const confirm = (over: Partial<Parameters<typeof retestConfirmation>[0]> = {}) =>
  retestConfirmation({
    members,
    actor: qa,
    projectId: 'haru',
    src: src(),
    b: inB,
    result: result(),
    to: 'closed',
    at: '2026-11-05T00:00:00.000Z',
    ...over,
  });
const ruleOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MembershipError);
    return (e as MembershipError).message;
  }
  throw new Error('막지 않았다');
};

describe('재테스트 대상', () => {
  it('패키지명이 같고 빌드 번호가 더 커야 새 빌드다', () => {
    expect(isNewerBuild(build('x', 120), build('y', 130))).toBe(true);
    expect(isNewerBuild(build('x', 130), build('y', 130))).toBe(false);
    expect(isNewerBuild(build('x', 120), build('y', 130, 'com.other'))).toBe(false);
  });

  it('다른 사이클의 fixed 결함만, 더 새 빌드 사이클에서', () => {
    expect(isRetestTarget(src(), inB)).toBe(true);
    expect(isRetestTarget(src({ status: 'open' }), inB)).toBe(false);
    expect(isRetestTarget(src(), { cycle: A, build: build('b120', 120) })).toBe(false);
    expect(isRetestTarget(src(), { cycle: B, build: build('b120', 120) })).toBe(false);
    expect(isRetestTarget(src(), { ...inB, cycle: { ...B, origin: 'local_run' } })).toBe(false);
  });

  it('그 사이클에서 확정한 결함은 상태가 바뀌어도 남는다', () => {
    const record = confirm().record;
    expect(isRetestTarget(src({ status: 'closed', retests: [record] }), inB)).toBe(true);
  });
});

describe('재테스트 칸', () => {
  it('같은 TC ID × 같은 모델·OS 메이저', () => {
    expect(retestCell(src(), B)).toEqual({
      kind: 'found',
      tcId: 'TC-1',
      deviceId: S24_15.id,
      deviceLabel: S24_15.label,
      caseChanged: false,
    });
  });

  it('케이스 내용 해시가 다르면 표시한다', () => {
    const b = { ...B, snapshot: [{ tcId: 'TC-1', contentHash: 'h2' }] };
    expect(retestCell(src(), b)).toMatchObject({ kind: 'found', caseChanged: true });
  });

  it('케이스가 없거나 같은 대상 디바이스가 없으면 찾지 못한다', () => {
    expect(retestCell(src(), { ...B, snapshot: [] }).kind).toBe('no_case');
    expect(retestCell(src(), { ...B, targets: [S24_16] }).kind).toBe('no_device');
  });

  it('판정 읽기: Pass는 자동 확정도, Fail은 사람 확정만', () => {
    expect(retestReading(result())).toBe('pass');
    expect(retestReading(result({ verdict: 'fail' }))).toBe('fail_unconfirmed');
    expect(retestReading(result({ verdict: 'fail', decidedBy: { kind: 'human', name: '김민지' } }))).toBe('fail');
    expect(retestReading(result({ verdict: 'check' }))).toBe('pending');
    expect(retestReading(undefined)).toBe('pending');
  });
});

describe('확정', () => {
  const humanFail = result({ verdict: 'fail', decidedBy: { kind: 'human', name: '김민지' } });

  it('Pass면 closed, 기록에 사이클·빌드·칸·판정 추적 주소가 남는다', () => {
    const { record, linkCell } = confirm();
    expect(record).toMatchObject({
      cycleId: 'b',
      build: { version: '1.130', buildNumber: 130 },
      deviceLabel: S24_15.label,
      verdict: 'pass',
      to: 'closed',
      by: '김민지',
    });
    expect(record.traceUrl).toContain('/p/haru/cycles/b/results/TC-1/galaxy-s24-15');
    expect(linkCell).toBe(false);
  });

  it('사람이 확정한 Fail이면 다시 열고 칸에 연결한다', () => {
    const { record, linkCell } = confirm({ to: 'open', result: humanFail });
    expect([record.verdict, record.to, linkCell]).toEqual(['fail', 'open', true]);
  });

  it('판정이 맞지 않으면 막는다', () => {
    expect(ruleOf(() => confirm({ result: humanFail }))).toContain('Pass일 때만');
    expect(ruleOf(() => confirm({ to: 'open', result: result({ verdict: 'fail' }) }))).toContain('먼저 사람이');
    expect(ruleOf(() => confirm({ to: 'open' }))).toContain('Fail일 때만');
    expect(ruleOf(() => confirm({ result: undefined }))).toContain('Pass일 때만');
  });

  it('결함이 fixed가 아니게 됐거나, 칸을 찾지 못하면 막는다', () => {
    expect(ruleOf(() => confirm({ src: src({ status: 'closed' }) }))).toContain('fixed가 아닙니다');
    expect(ruleOf(() => confirm({ b: { ...inB, cycle: { ...B, snapshot: [] } } }))).toContain('케이스 없음');
    expect(ruleOf(() => confirm({ b: { cycle: B, build: build('b120', 120) } }))).toContain('새 빌드가 아닙니다');
  });

  it('칸에 다른 결함이 있으면 다시 열지 않는다 — 같은 증상이면 결함 사이클에서 직접 바꾸라고 안내한다', () => {
    const message = ruleOf(() => confirm({ to: 'open', result: { ...humanFail, defectId: 'D-3' } }));
    expect(message).toContain('D-3');
    expect(message).toContain('같은 증상이면');
  });

  it('이 사이클에서 이미 확정한 결함은 다시 fixed가 돼도 다시 확정하지 않는다 (칸 결과가 고치기 전 빌드의 것)', () => {
    const reopened = confirm({ to: 'open', result: humanFail }).record;
    const fixedAgain = src({ status: 'fixed', retests: [reopened] });
    expect(ruleOf(() => confirm({ src: fixedAgain, to: 'open', result: humanFail }))).toContain('이미');
    expect(ruleOf(() => confirm({ src: fixedAgain }))).toContain('다음 새 빌드');
    // 다른 사이클의 기록은 막지 않는다
    expect(confirm({ src: src({ retests: [{ ...reopened, cycleId: 'older' }] }) }).record.to).toBe('closed');
  });

  it('로컬 실행 묶음·삭제 중인 사이클로는 확정하지 않는다', () => {
    const local = { ...inB, cycle: { ...B, origin: 'local_run' as const } };
    expect(ruleOf(() => confirm({ b: local }))).toContain('재테스트를 받지 않는');
    const deleting = { ...inB, cycle: { ...B, deletingAt: '2026-11-05T00:00:00.000Z' } };
    expect(ruleOf(() => confirm({ b: deleting }))).toContain('재테스트를 받지 않는');
    const srcDeleting = { ...src(), cycle: { ...A, deletingAt: '2026-11-05T00:00:00.000Z' } };
    expect(ruleOf(() => confirm({ src: srcDeleting }))).toContain('삭제 중');
  });

  it('Viewer는 확정하지 못한다', () => {
    const e = (() => {
      try {
        confirm({ actor: { uid: 'u-viewer', name: '박도윤', github: 'doyoon-park' } });
      } catch (x) {
        return x as MembershipError;
      }
    })();
    expect(e?.kind).toBe('permission');
  });
});

describe('이슈 코멘트', () => {
  const base = {
    build: { version: '1.2.1', buildNumber: 45 },
    cycleName: '1.2.1 회귀',
    deviceLabel: 'Galaxy S24 (Android 15)',
    traceUrl: 'https://qcard.dev/p/haru/cycles/c/results/TC-1/galaxy-s24-15',
    by: 'minji-kim',
  };

  it('Pass: 빌드·사이클·디바이스, 판정 추적, 확인한 사람', () => {
    expect(retestIssueComment({ ...base, verdict: 'pass' })).toBe(
      [
        'QA 재테스트 Pass — 빌드 1.2.1 (45) · 사이클 "1.2.1 회귀" · Galaxy S24 (Android 15)',
        `판정 추적: ${base.traceUrl}`,
        '확인: @minji-kim',
      ].join('\n'),
    );
  });

  it('Fail: 실제 결과 한 줄을 덧붙인다', () => {
    const text = retestIssueComment({ ...base, verdict: 'fail', actual: '토스트가 3개 쌓였다\n자세히는…' });
    expect(text.split('\n').slice(0, 2)).toEqual([
      'QA 재테스트 Fail — 빌드 1.2.1 (45) · 사이클 "1.2.1 회귀" · Galaxy S24 (Android 15)',
      '실제 결과: 토스트가 3개 쌓였다',
    ]);
  });
});
