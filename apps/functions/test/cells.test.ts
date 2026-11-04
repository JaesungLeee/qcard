import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MembershipError, type Run } from '@qcard/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import * as cells from '../src/cells';
import * as h from '../src/handlers';

/*
 * 칸 자동 선점을 Firestore 에뮬레이터 위에서 핸들러로 돌린다.
 * 두 Run이 같은 칸을 동시에 잡으려 하면 하나만 잡는지, 연결 신호가 끊긴 Run의 칸을 가져가는지를 본다.
 */

const PROJECT = 'demo-qcard-test';
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();

const USERS = {
  lead: { uid: 'u-lead', name: '이재성', github: 'jaesung-lee' },
  qa: { uid: 'u-qa', name: '김민지', github: 'minji-kim' },
  viewer: { uid: 'u-viewer', name: '박도윤', github: 'doyoon-park' },
};
type Who = keyof typeof USERS;
const T0 = '2026-10-25T10:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const ctx = (who: Who, opts: { now?: string; host?: string } = {}): h.Ctx => ({
  db,
  uid: USERS[who].uid,
  now: () => opts.now ?? T0,
  ...(opts.host ? { host: opts.host } : {}),
});

let p = '';
const C = () => `projects/${p}/cycles/c1`;

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('Firestore 에뮬레이터가 필요합니다 (pnpm --filter @qcard/functions test)');
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  for (const who of Object.keys(USERS) as Who[]) {
    await h.registerProfile(ctx(who), { github: USERS[who].github, name: USERS[who].name }, { emulator: true });
  }
  const project = await h.createProject(ctx('lead'), {
    name: 'Moa Book',
    appName: '모아북',
    packageName: 'com.example.moabook',
    dataNoticeAck: true,
  });
  p = project.id;
  for (const [who, role] of [['qa', 'qa'], ['viewer', 'viewer']] as const) {
    const u = USERS[who];
    await db.doc(`projects/${p}/members/${u.uid}`).set({ projectId: p, uid: u.uid, user: u.name, github: u.github, role, joinedAt: T0 });
  }
});

/** 같은 대상 디바이스로 도는 Run. 연결 신호는 `heartbeat`초 시점 */
async function run(id: string, who: Who, opts: { status?: Run['status']; heartbeat?: number; deviceId?: string } = {}) {
  await db.doc(`${C()}/runs/${id}`).set({
    id,
    cycleId: 'c1',
    executor: USERS[who].name,
    executorUid: USERS[who].uid,
    hostId: `h-${who}`,
    deviceId: opts.deviceId ?? 'pixel8',
    status: opts.status ?? 'running',
    startedAt: T0,
    heartbeatAt: at(opts.heartbeat ?? 0),
  });
}
const claim = (who: Who, runId: string, tcId: string, opts: { now?: string; rerun?: boolean } = {}) =>
  cells.claimCell(ctx(who, { now: opts.now ?? at(10), host: `h-${who}` }), {
    projectId: p,
    cycleId: 'c1',
    runId,
    tcId,
    rerun: opts.rerun ?? false,
  });
const current = async (runId: string) => ((await db.doc(`${C()}/runs/${runId}`).get()).data() as Run).currentTcId;

describe('칸 자동 선점', () => {
  it('두 Run이 같은 칸을 동시에 잡으려 하면 하나만 잡고, 다른 쪽은 그 실행자를 보고 건너뛴다', async () => {
    await run('r-qa', 'qa');
    await run('r-lead', 'lead');
    const [a, b] = await Promise.all([claim('qa', 'r-qa', 'TC-1'), claim('lead', 'r-lead', 'TC-1')]);
    const won = [a, b].filter((r) => r.claimed);
    expect(won).toHaveLength(1);
    const lost = (a.claimed ? b : a) as { claimed: false; skip: unknown };
    const winner = a.claimed ? 'r-qa' : 'r-lead';
    expect(lost.skip).toEqual({
      reason: 'running',
      runId: winner,
      executor: winner === 'r-qa' ? '김민지' : '이재성',
    });
    expect(await current(winner)).toBe('TC-1');
    expect(await current(winner === 'r-qa' ? 'r-lead' : 'r-qa')).toBeUndefined();
    // 진 쪽은 남은 칸을 가져간다
    expect(await claim(winner === 'r-qa' ? 'lead' : 'qa', winner === 'r-qa' ? 'r-lead' : 'r-qa', 'TC-2')).toEqual({
      claimed: true,
    });
  });

  it('하트비트가 만료된 Run(호스트 연결 끊김)과 일시정지된 Run의 칸은 가져간다', async () => {
    await run('r-qa', 'qa');
    await run('r-lead', 'lead');
    expect(await claim('qa', 'r-qa', 'TC-1')).toEqual({ claimed: true });
    // 잡은 시각이 연결 신호가 된다 (10초). 그로부터 90초 안이면 잡혀 있다
    expect((await claim('lead', 'r-lead', 'TC-1', { now: at(100) })).claimed).toBe(false);
    expect(await claim('lead', 'r-lead', 'TC-1', { now: at(101) })).toEqual({ claimed: true });

    await run('r-paused', 'qa', { status: 'paused', heartbeat: 0 });
    await db.doc(`${C()}/runs/r-paused`).update({ currentTcId: 'TC-3' });
    expect(await claim('lead', 'r-lead', 'TC-3', { now: at(110) })).toEqual({ claimed: true });
  });

  it('완료된 칸은 건너뛰고, 다른 대상 디바이스의 Run은 같은 케이스를 따로 잡는다', async () => {
    await run('r-qa', 'qa');
    await run('r-lead', 'lead', { deviceId: 'galaxy' });
    await db.doc(`${C()}/results/TC-1__pixel8`).set({ tcId: 'TC-1', deviceId: 'pixel8', verdict: 'pass', runId: 'r-old', executedAt: at(-60) });
    expect(await claim('qa', 'r-qa', 'TC-1')).toEqual({ claimed: false, skip: { reason: 'done', runId: 'r-old' } });
    // 다시 실행으로 고른 칸
    expect(await claim('qa', 'r-qa', 'TC-1', { rerun: true })).toEqual({ claimed: true });
    expect(await claim('lead', 'r-lead', 'TC-1')).toEqual({ claimed: true });
  });

  it('실행 중인 내 Run의 호스트만 잡는다', async () => {
    await run('r-qa', 'qa');
    await run('r-done', 'qa', { status: 'done' });
    const denied = async (x: Promise<unknown>) => {
      const e = await x.catch((v: unknown) => v);
      expect(e).toBeInstanceOf(MembershipError);
      expect((e as MembershipError).kind).toBe('permission');
    };
    await denied(cells.claimCell(ctx('qa'), { projectId: p, cycleId: 'c1', runId: 'r-qa', tcId: 'TC-1', rerun: false }));
    await denied(claim('lead', 'r-qa', 'TC-1'));
    await denied(claim('qa', 'r-done', 'TC-1'));
    // 실행 중 Viewer로 바뀌었으면 더 잡지 못한다
    await run('r-viewer', 'viewer');
    await denied(claim('viewer', 'r-viewer', 'TC-1'));
  });
});
