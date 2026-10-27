import { describe, expect, it } from 'vitest';
import { cycleDeleteBlocker, cycleDeletion } from './cycles';
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

describe('사이클 삭제 (F-CY-10)', () => {
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
