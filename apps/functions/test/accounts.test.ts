import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MembershipError, type TestAccount } from '@qcard/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import * as acc from '../src/accounts';
import * as h from '../src/handlers';
import { localBox } from '../src/secretBox';

/*
 * 테스트 계정 풀을 Firestore 에뮬레이터 위에서 핸들러로 돌린다.
 * 비밀값이 봉인돼 저장되는지, 배정이 Run 상태·연결 신호를 따르는지, 표시·격리가 배정에서 빠지는지를 본다.
 */

const PROJECT = 'demo-qcard-test';
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();
const box = localBox('test');

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
  box,
  now: () => opts.now ?? T0,
  ...(opts.host ? { host: opts.host } : {}),
});

const expectRule = async (p: Promise<unknown>, kind: MembershipError['kind'], text?: string) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(MembershipError);
  expect((e as MembershipError).kind).toBe(kind);
  if (text) expect((e as MembershipError).message).toContain(text);
};

let p = '';

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

/** qa의 호스트가 돌리는 Run. 연결 신호는 `heartbeat`초 시점 */
async function run(id: string, opts: { status?: string; heartbeat?: number; executor?: Who } = {}) {
  await db.doc(`projects/${p}/cycles/c1/runs/${id}`).set({
    id,
    cycleId: 'c1',
    executor: USERS[opts.executor ?? 'qa'].name,
    executorUid: USERS[opts.executor ?? 'qa'].uid,
    hostId: 'h-qa',
    deviceId: 'pixel8',
    status: opts.status ?? 'running',
    startedAt: T0,
    heartbeatAt: at(opts.heartbeat ?? 0),
  });
}

const create = (loginId: string, extra: Record<string, unknown> = {}) =>
  acc.createAccount(ctx('lead'), { projectId: p, loginId, password: `pw-${loginId}`, ...extra });
const claim = (runId: string, kind: string, extra: Record<string, unknown> = {}, now = T0) =>
  acc.claimAccount(ctx('qa', { now, host: 'h-qa' }), {
    projectId: p,
    cycleId: 'c1',
    runId,
    tcId: 'TC-1',
    kind,
    restoring: false,
    ...extra,
  });
const stored = async (id: string) => (await db.doc(`projects/${p}/accounts/${id}`).get()).data() as TestAccount;

describe('등록', () => {
  it('비밀값은 봉인해 따로 두고, 계정 문서에는 없다', async () => {
    const a = await create('qa01@moa.test', { totp: 'otpauth://totp/moa:qa01?secret=JBSWY3DPEHPK3PXPJBSWY3DP' });
    expect(a).toMatchObject({ kind: '기본', loginId: 'qa01@moa.test', usesTotp: true, secretUpdated: { by: '이재성' } });
    expect(JSON.stringify(await stored(a.id))).not.toContain('pw-qa01');
    const sealed = (await db.doc(`projects/${p}/accountSecrets/${a.id}`).get()).data()!.sealed as string;
    expect(sealed).not.toContain('pw-qa01');
    expect(JSON.parse(await box.open(sealed))).toEqual({ password: 'pw-qa01@moa.test', totpSeed: 'JBSWY3DPEHPK3PXPJBSWY3DP' });
  });

  it('Viewer는 못 하고, 같은 로그인 ID·잘못된 TOTP·빈 비밀번호는 거부한다', async () => {
    await create('qa01@moa.test');
    await expectRule(acc.createAccount(ctx('viewer'), { projectId: p, loginId: 'x', password: 'y' }), 'permission');
    await expectRule(create('QA01@moa.test'), 'rule', '이미 등록');
    await expectRule(create('qa02@moa.test', { totp: '123' }), 'rule', 'base32');
    await expectRule(acc.createAccount(ctx('lead'), { projectId: p, loginId: 'z', password: '' }), 'rule', '비밀번호');
  });

  it('비밀번호를 바꾸면 기존 TOTP 시드는 남고 로그인 실패 표시가 지워진다', async () => {
    const a = await create('qa01@moa.test', { totp: 'JBSWY3DPEHPK3PXPJBSWY3DP' });
    await db.doc(`projects/${p}/accounts/${a.id}`).update({ loginFailed: { at: T0, cycleId: 'c1', runId: 'r', tcId: 'TC-1' } });
    const next = await acc.updateAccount(ctx('qa', { now: at(60) }), { projectId: p, accountId: a.id, password: 'new' });
    expect(next.loginFailed).toBeUndefined();
    expect(next.secretUpdated).toEqual({ by: '김민지', at: at(60) });
    const sealed = (await db.doc(`projects/${p}/accountSecrets/${a.id}`).get()).data()!.sealed as string;
    expect(JSON.parse(await box.open(sealed))).toEqual({ password: 'new', totpSeed: 'JBSWY3DPEHPK3PXPJBSWY3DP' });

    const noTotp = await acc.updateAccount(ctx('qa'), { projectId: p, accountId: a.id, totp: null, note: '책 3권' });
    expect(noTotp).toMatchObject({ usesTotp: false, note: '책 3권' });
  });
});

describe('배정·반납', () => {
  it('실행 중인 내 Run의 호스트만, 같은 종류의 빈 계정을 받고 전달 기록이 남는다', async () => {
    const a = await create('a@moa.test');
    await create('sub@moa.test', { kind: '구독자' });
    await run('r1');
    await expectRule(acc.claimAccount(ctx('qa'), { projectId: p, cycleId: 'c1', runId: 'r1', tcId: 'T', kind: '기본', restoring: false }), 'permission');
    await expectRule(acc.claimAccount(ctx('lead', { host: 'h-lead' }), { projectId: p, cycleId: 'c1', runId: 'r1', tcId: 'T', kind: '기본', restoring: false }), 'permission');

    const r = await claim('r1', '기본');
    expect(r.account).toMatchObject({ id: a.id, lease: { runId: 'r1', uid: USERS.qa.uid, hostId: 'h-qa', executor: '김민지' } });
    expect(r).toMatchObject({ secret: { password: 'pw-a@moa.test' } });
    const log = (await db.collection(`projects/${p}/secretAccessLog`).get()).docs.map((d) => d.data());
    expect(log).toEqual([expect.objectContaining({ accountId: a.id, runId: 'r1', uid: USERS.qa.uid, hostId: 'h-qa' })]);

    // 같은 종류의 다른 빈 계정이 없다 → 없음
    await run('r2');
    expect(await claim('r2', '기본')).toEqual({ account: null });
  });

  it('이어 쓰기는 배정만 갱신하고 비밀값을 다시 보내지 않는다', async () => {
    const a = await create('a@moa.test');
    await run('r1');
    await claim('r1', '기본');
    const next = await claim('r1', '기본', { accountId: a.id, tcId: 'TC-2' });
    expect(next).toEqual({ account: expect.objectContaining({ lease: expect.objectContaining({ tcId: 'TC-2' }) }) });
    expect((await db.collection(`projects/${p}/secretAccessLog`).get()).size).toBe(1);
  });

  it('끝났거나 신호가 끊긴 Run의 배정은 풀리고, 원복 중에 끊겼으면 격리한다', async () => {
    const a = await create('a@moa.test');
    const b = await create('b@moa.test');
    await run('r1');
    await claim('r1', '기본'); // a
    await claim('r1', '기본', { restoring: true }); // b (원복 플로우가 있는 케이스)
    await db.doc(`projects/${p}/cycles/c1/runs/r1`).update({ heartbeatAt: at(0) });

    await run('r2', { heartbeat: 200 });
    const r = await claim('r2', '기본', {}, at(200));
    expect(r.account?.id).toBe(a.id);
    expect((await stored(b.id)).quarantine).toMatchObject({ reason: 'interrupted', runId: 'r1' });
    expect((await stored(b.id)).lease).toBeUndefined();
  });

  it('로그인 실패·원복 실패로 반납하면 다음 배정에서 빠지고, 해제하면 다시 배정한다', async () => {
    const a = await create('a@moa.test');
    await run('r1');
    await claim('r1', '기본');
    const release = (outcome: string) =>
      acc.releaseAccount(ctx('qa', { host: 'h-qa' }), { projectId: p, accountId: a.id, runId: 'r1', outcome, detail: '비밀번호 오류' });
    await release('login_failed');
    expect(await stored(a.id)).toMatchObject({ loginFailed: { runId: 'r1', detail: '비밀번호 오류' } });
    expect(await claim('r1', '기본')).toEqual({ account: null });

    await acc.clearAccountFlag(ctx('qa'), { projectId: p, accountId: a.id, flag: 'loginFailed' });
    await claim('r1', '기본');
    await release('restore_failed');
    expect((await stored(a.id)).quarantine).toMatchObject({ reason: 'restore_failed' });
    expect(await claim('r1', '기본')).toEqual({ account: null });

    await expectRule(acc.clearAccountFlag(ctx('viewer'), { projectId: p, accountId: a.id, flag: 'quarantine' }), 'permission');
    await acc.clearAccountFlag(ctx('lead'), { projectId: p, accountId: a.id, flag: 'quarantine' });
    expect((await claim('r1', '기본')).account?.id).toBe(a.id);
  });

  it('이미 풀린 배정을 반납하면 아무것도 바꾸지 않는다', async () => {
    const a = await create('a@moa.test');
    await acc.releaseAccount(ctx('qa', { host: 'h-qa' }), { projectId: p, accountId: a.id, runId: 'r1', outcome: 'login_failed' });
    expect((await stored(a.id)).loginFailed).toBeUndefined();
  });
});

describe('삭제', () => {
  it('실행 중인 Run이 쓰는 계정은 지우지 못하고, 끝나면 비밀값과 함께 지운다', async () => {
    const a = await create('a@moa.test');
    await run('r1');
    await claim('r1', '기본');
    await expectRule(acc.deleteAccount(ctx('lead'), { projectId: p, accountId: a.id }), 'rule', '삭제할 수 없습니다');
    await db.doc(`projects/${p}/cycles/c1/runs/r1`).update({ status: 'done' });
    await acc.deleteAccount(ctx('lead'), { projectId: p, accountId: a.id });
    expect((await db.doc(`projects/${p}/accounts/${a.id}`).get()).exists).toBe(false);
    expect((await db.doc(`projects/${p}/accountSecrets/${a.id}`).get()).exists).toBe(false);
  });
});
