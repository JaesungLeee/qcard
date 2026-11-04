import { describe, expect, it } from 'vitest';
import { cellSkip, cycleDeleteBlocker, cycleDeletion, holdsCell } from './cycles';
import type { Member, Run, TestCycle } from './domain';
import { MembershipError } from './membership';

const T0 = '2026-10-28T10:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const members: Member[] = [
  { projectId: 'p', uid: 'u-qa', user: '김민지', github: 'minji', role: 'qa', joinedAt: T0, dataNoticeAckAt: T0 },
  { projectId: 'p', uid: 'u-v', user: '박도윤', github: 'doyoon', role: 'viewer', joinedAt: T0, dataNoticeAckAt: T0 },
];
const qa = { uid: 'u-qa', name: '김민지', github: 'minji' };
const viewer = { uid: 'u-v', name: '박도윤', github: 'doyoon' };
const cycle: TestCycle = {
  id: 'c',
  projectId: 'p',
  name: '1.0.0 (7) 통합테스트',
  docId: 'd',
  buildId: 'b',
  targets: [],
  period: { start: T0 },
  serverEnv: 'dev',
  snapshot: [],
  createdBy: '김민지',
};
const run = (status: Run['status'], heartbeat?: number): Run => ({
  id: `r-${status}`,
  cycleId: 'c',
  executor: '김민지',
  deviceId: 'd1',
  status,
  startedAt: T0,
  ...(heartbeat === undefined ? {} : { heartbeatAt: at(heartbeat) }),
});

const kind = (f: () => void) => {
  try {
    f();
  } catch (e) {
    return e instanceof MembershipError ? e.kind : 'other';
  }
  return 'ok';
};

describe('사이클 삭제', () => {
  it('완료된 사이클과 신호가 살아 있는 Run이 있는 사이클은 막는다', () => {
    expect(cycleDeleteBlocker(cycle, [run('done'), run('aborted')], T0)).toBeUndefined();
    expect(cycleDeleteBlocker({ ...cycle, period: { start: T0, end: T0 } }, [], T0)).toContain('다시 연 뒤');
    expect(cycleDeleteBlocker(cycle, [run('running', 0), run('paused', 0)], at(30))).toContain('Run 2개');
  });

  it('신호가 끊긴 Run은 막지 않는다', () => {
    expect(cycleDeleteBlocker(cycle, [run('running', 0)], at(600))).toBeUndefined();
  });

  it('Admin·QA만, 이름이 같아야 지운다', () => {
    expect(kind(() => cycleDeletion(members, viewer, cycle, [], cycle.name, T0))).toBe('permission');
    expect(kind(() => cycleDeletion(members, qa, cycle, [], '1.0.0 (7)', T0))).toBe('rule');
    expect(kind(() => cycleDeletion(members, qa, cycle, [], ` ${cycle.name} `, T0))).toBe('ok');
  });
});

describe('칸 자동 선점', () => {
  const me: Run = { ...run('running', 0), id: 'r-me' };
  const other = (status: Run['status'], heartbeat: number, currentTcId = 'TC-1', deviceId = 'd1'): Run => ({
    ...run(status, heartbeat),
    id: 'r-other',
    executor: '박도윤',
    currentTcId,
    deviceId,
  });
  const result = (verdict: 'pass' | 'nt', runId: string, executedSec: number) => ({
    verdict,
    runId,
    executedAt: at(executedSec),
  });

  it('칸은 실행 중이고 신호가 90초 안에 있는 Run만 잡는다 (일시정지·끝난 Run은 놓는다)', () => {
    expect(holdsCell(other('running', 0), at(90))).toBe(true);
    expect(holdsCell(other('running', 0), at(91))).toBe(false);
    expect(holdsCell(other('paused', 0), at(10))).toBe(false);
    expect(holdsCell(other('done', 0), at(10))).toBe(false);
    expect(holdsCell({ status: 'running' }, T0)).toBe(false);
  });

  it('같은 대상 디바이스의 다른 Run이 잡은 칸은 건너뛰고, 신호가 끊기면 가져간다', () => {
    expect(cellSkip(me, [me, other('running', 0)], undefined, 'TC-1', false, at(30))).toEqual({
      reason: 'running',
      executor: '박도윤',
      runId: 'r-other',
    });
    // 하트비트 만료 (호스트 연결 끊김)
    expect(cellSkip(me, [me, other('running', 0)], undefined, 'TC-1', false, at(120))).toBeUndefined();
    // 일시정지 · 다른 칸 · 다른 디바이스
    expect(cellSkip(me, [other('paused', 0)], undefined, 'TC-1', false, at(30))).toBeUndefined();
    expect(cellSkip(me, [other('running', 0, 'TC-2')], undefined, 'TC-1', false, at(30))).toBeUndefined();
    expect(cellSkip(me, [other('running', 0, 'TC-1', 'd2')], undefined, 'TC-1', false, at(30))).toBeUndefined();
    // 다시 실행하려고 고른 칸도 잡혀 있으면 건너뛴다
    expect(cellSkip(me, [other('running', 0)], undefined, 'TC-1', true, at(30))?.reason).toBe('running');
  });

  it('결과가 있는 칸은 건너뛰고, 다시 실행으로 고른 칸은 이 Run이 시작하기 전의 결과일 때만 돌린다', () => {
    expect(cellSkip(me, [], result('nt', 'r-x', 10), 'TC-1', false, at(30))).toBeUndefined();
    expect(cellSkip(me, [], result('pass', 'r-old', -100), 'TC-1', false, at(30))).toEqual({
      reason: 'done',
      runId: 'r-old',
    });
    expect(cellSkip(me, [], result('pass', 'r-old', -100), 'TC-1', true, at(30))).toBeUndefined();
    // 이 Run이 시작한 뒤 다른 Run이 끝냄 (일시정지 중 다른 실행자가 돌린 칸 포함)
    expect(cellSkip(me, [], result('pass', 'r-other', 10), 'TC-1', true, at(30))?.reason).toBe('done');
    expect(cellSkip(me, [], result('pass', 'r-me', 10), 'TC-1', true, at(30))).toBeUndefined();
  });
});
