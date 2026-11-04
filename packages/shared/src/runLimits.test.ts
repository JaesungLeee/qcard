import { describe, expect, it } from 'vitest';
import type { Member } from './domain';
import { MembershipError } from './membership';
import { DEFAULT_RUN_LIMITS, maxTurnsFor, runLimitsChange, runLimitsOf, runLimitsProblem } from './runLimits';

const T0 = '2026-10-29T10:00:00.000Z';
const members: Member[] = [
  { projectId: 'p', uid: 'u-a', user: '이서준', github: 'seojun', role: 'admin', joinedAt: T0, dataNoticeAckAt: T0 },
  { projectId: 'p', uid: 'u-qa', user: '김민지', github: 'minji', role: 'qa', joinedAt: T0, dataNoticeAckAt: T0 },
];
const kind = (f: () => void) => {
  try {
    f();
  } catch (e) {
    return e instanceof MembershipError ? e.kind : 'other';
  }
  return undefined;
};

describe('실행 안전장치', () => {
  it('저장하지 않은 프로젝트는 기본값, 최대 턴은 단계 수 × 단계당 턴 + 추가 턴', () => {
    expect(runLimitsOf({})).toEqual(DEFAULT_RUN_LIMITS);
    expect(maxTurnsFor(DEFAULT_RUN_LIMITS, 4)).toBe(4 * 3 + 10);
    const limits = { ...DEFAULT_RUN_LIMITS, tokensPerRun: 5_000_000 };
    expect(runLimitsOf({ runLimits: limits }).tokensPerRun).toBe(5_000_000);
  });

  it('범위 밖·정수가 아닌 값은 이름과 범위로 알린다', () => {
    expect(runLimitsProblem(DEFAULT_RUN_LIMITS)).toBeUndefined();
    expect(runLimitsProblem({ ...DEFAULT_RUN_LIMITS, repeatLimit: 1 })).toBe(
      '같은 액션 반복은(는) 2~10 사이의 정수여야 합니다.',
    );
    expect(runLimitsProblem({ ...DEFAULT_RUN_LIMITS, tokensPerRun: NaN })).toMatch(/^Run당 토큰은\(는\) 500,000~/);
    expect(runLimitsProblem({ ...DEFAULT_RUN_LIMITS, extraTurns: 1.5 })).toMatch(/^추가 턴/);
  });

  it('Admin만 바꾸고, 범위 밖이면 rule', () => {
    const admin = { uid: 'u-a', name: '이서준', github: 'seojun' };
    const qa = { uid: 'u-qa', name: '김민지', github: 'minji' };
    const next = { ...DEFAULT_RUN_LIMITS, callsPerCase: 60 };
    expect(runLimitsChange(members, admin, next)).toEqual(next);
    expect(kind(() => runLimitsChange(members, qa, next))).toBe('permission');
    expect(kind(() => runLimitsChange(members, admin, { ...next, waitTimeoutMin: 0 }))).toBe('rule');
    // 모르는 값은 저장하지 않는다
    expect(runLimitsChange(members, admin, { ...next, extra: 1 } as typeof next)).toEqual(next);
  });
});
