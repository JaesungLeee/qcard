import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { MembershipError } from '@qcard/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as h from '../src/handlers';

/*
 * Firestore·Storage 에뮬레이터 위에서 핸들러를 직접 부른다 (`pnpm --filter @qcard/functions test`가 에뮬레이터를 띄운다).
 * 규칙 자체는 @qcard/shared membership과 웹 메모리 구현 테스트가 다루고, 여기서는 Firestore에 맞게
 * 읽고 쓰는지(트랜잭션·색인·하위 문서)를 본다.
 */

const PROJECT = 'demo-qcard-test';
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();
const bucket = getStorage().bucket(`${PROJECT}.appspot.com`);
const removeFiles: h.RemoveFiles = (prefix) => bucket.deleteFiles({ prefix });

const USERS = {
  lead: { uid: 'u-lead', name: '이재성', github: 'jaesung-lee' },
  qa: { uid: 'u-qa', name: '김민지', github: 'minji-kim' },
  guest: { uid: 'u-guest', name: '박도윤', github: 'doyoon-park' },
};
type Who = keyof typeof USERS;
const ctx = (who: Who, now?: string): h.Ctx => ({ db, uid: USERS[who].uid, now: now ? () => now : undefined });

async function clear() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('Firestore 에뮬레이터가 필요합니다 (pnpm --filter @qcard/functions test)');
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await bucket.deleteFiles();
}

const expectRule = async (p: Promise<unknown>, kind: MembershipError['kind'], text?: string) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(MembershipError);
  expect((e as MembershipError).kind).toBe(kind);
  if (text) expect((e as MembershipError).message).toContain(text);
};

beforeEach(async () => {
  await clear();
  for (const who of Object.keys(USERS) as Who[]) {
    const u = USERS[who];
    await h.registerProfile(ctx(who), { github: u.github, name: u.name }, { emulator: true });
  }
});

const input = { name: 'Demo App', appName: '데모', packageName: 'com.demo.app', dataNoticeAck: true };

describe('프로젝트', () => {
  it('만든 사람이 Admin이 되고, 같은 이름이면 id에 번호가 붙는다', async () => {
    const p1 = await h.createProject(ctx('lead'), input);
    const p2 = await h.createProject(ctx('qa'), input);
    expect([p1.id, p2.id]).toEqual(['demo-app', 'demo-app-2']);
    const m = (await db.doc(`projects/demo-app/members/${USERS.lead.uid}`).get()).data();
    expect(m).toMatchObject({ role: 'admin', github: 'jaesung-lee', user: '이재성' });
  });

  it('프로필이 없거나 입력이 잘못되면 거부한다', async () => {
    await expectRule(h.createProject({ db, uid: 'nobody' }, input), 'permission', '프로필');
    await expectRule(h.createProject(ctx('lead'), { ...input, dataNoticeAck: false }), 'rule', '데이터 처리 안내');
    await expectRule(h.createProject(ctx('lead'), { name: 1 }), 'rule', '요청 형식');
  });

  it('삭제는 30일 유예 후 영구 삭제되고, 그 전에는 복구할 수 있다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    await expectRule(h.deleteProject(ctx('lead'), { projectId: p.id, confirmName: '틀림' }), 'rule');
    const t0 = '2026-10-22T00:00:00.000Z';
    const deleted = await h.deleteProject(ctx('lead', t0), { projectId: p.id, confirmName: 'Demo App' });
    expect(deleted.purgeAt).toBe('2026-11-21T00:00:00.000Z');
    expect((await h.restoreProject(ctx('lead'), { projectId: p.id })).deletedAt).toBeUndefined();

    await h.deleteProject(ctx('lead', t0), { projectId: p.id, confirmName: 'Demo App' });
    await h.createInvitation(ctx('lead'), { projectId: p.id, role: 'qa' });
    expect(await h.purgeDeletedProjects(db, '2026-11-20T00:00:00.000Z', removeFiles)).toEqual([]);
    expect(await h.purgeDeletedProjects(db, '2026-11-21T00:00:00.000Z', removeFiles)).toEqual([p.id]);
    expect((await db.doc(`projects/${p.id}`).get()).exists).toBe(false);
    expect((await db.collection(`projects/${p.id}/members`).get()).size).toBe(0);
    expect((await db.collection('invitationTokens').get()).size).toBe(0);
  });

  it('영구 삭제는 Storage 파일과 테스트 계정 비밀값까지 지우고, 이름이 겹치는 다른 프로젝트는 남긴다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    const other = await h.createProject(ctx('qa'), input); // demo-app-2 — 접두어가 겹친다
    const files = [
      `projects/${p.id}/specBundles/b1/onboarding/spec.md`,
      `projects/${p.id}/builds/b1/app.apk`,
      `projects/${p.id}/cycles/c1/runs/r1/TC-001/obs-01.png`,
    ];
    const kept = `projects/${other.id}/specBundles/b1/onboarding/spec.md`;
    for (const f of [...files, kept]) await bucket.file(f).save('x');
    for (const sub of ['accounts', 'accountSecrets', 'secretAccessLog'])
      await db.doc(`projects/${p.id}/${sub}/a1`).set({ at: 'x' });

    await h.deleteProject(ctx('lead', '2026-10-22T00:00:00.000Z'), { projectId: p.id, confirmName: 'Demo App' });
    expect(await h.purgeDeletedProjects(db, '2026-11-21T00:00:00.000Z', removeFiles)).toEqual([p.id]);

    for (const f of files) expect((await bucket.file(f).exists())[0]).toBe(false);
    expect((await bucket.file(kept).exists())[0]).toBe(true);
    for (const sub of ['accounts', 'accountSecrets', 'secretAccessLog'])
      expect((await db.collection(`projects/${p.id}/${sub}`).get()).size).toBe(0);
    expect((await db.doc(`projects/${other.id}`).get()).exists).toBe(true);
  });

  it('Storage 삭제가 실패하면 문서를 남겨 다음 실행에서 다시 지운다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    await h.deleteProject(ctx('lead', '2026-10-22T00:00:00.000Z'), { projectId: p.id, confirmName: 'Demo App' });
    const broken = async () => {
      throw new Error('storage down');
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await h.purgeDeletedProjects(db, '2026-11-21T00:00:00.000Z', broken)).toEqual([]);
    quiet.mockRestore();
    expect((await db.doc(`projects/${p.id}`).get()).exists).toBe(true);
    expect(await h.purgeDeletedProjects(db, '2026-11-22T00:00:00.000Z', removeFiles)).toEqual([p.id]);
  });
});

describe('사이클 삭제', () => {
  const T0 = '2026-10-28T10:00:00.000Z';
  const NAME = '1.0.0 (7) 통합테스트';
  /** 사이클 c1(하위 문서·증거 포함)과, 지우면 안 되는 사이클 c10·빌드 */
  async function seed(p: string) {
    const c = (id: string) => ({
      id,
      projectId: p,
      name: NAME,
      docId: 'd',
      buildId: 'b',
      targets: [],
      period: { start: T0 },
    });
    await db.doc(`projects/${p}/cycles/c1`).set(c('c1'));
    await db.doc(`projects/${p}/cycles/c10`).set(c('c10'));
    for (const sub of ['cases/TC-1', 'results/TC-1__d', 'runs/r1', 'attempts/a1', 'defects/D-1', 'verdictLog/l1'])
      await db.doc(`projects/${p}/cycles/c1/${sub}`).set({ at: T0 });
    await db.doc(`projects/${p}/builds/b`).set({ id: 'b' });
    const files = [
      `projects/${p}/cycles/c1/runs/r1/TC-1/obs-01.png`,
      `projects/${p}/cycles/c10/runs/r1/TC-1/obs-01.png`,
    ];
    for (const f of files) await bucket.file(f).save('x');
    return files;
  }
  const del = (who: Who, p: string, confirmName = NAME, files = removeFiles) =>
    h.deleteCycle(ctx(who, T0), { projectId: p, cycleId: 'c1', confirmName }, files);

  it('사이클과 하위 문서·증거를 지우고, 접두어가 겹치는 다른 사이클·빌드는 남긴다', async () => {
    const p = (await h.createProject(ctx('lead'), input)).id;
    const [mine, other] = await seed(p);
    await del('lead', p);
    expect((await db.doc(`projects/${p}/cycles/c1`).get()).exists).toBe(false);
    expect((await db.doc(`projects/${p}/cycles/c1`).listCollections()).length).toBe(0);
    expect((await bucket.file(mine!).exists())[0]).toBe(false);
    expect((await bucket.file(other!).exists())[0]).toBe(true);
    expect((await db.doc(`projects/${p}/cycles/c10`).get()).exists).toBe(true);
    expect((await db.doc(`projects/${p}/builds/b`).get()).exists).toBe(true);
  });

  it('이름이 다르거나, 멤버가 아니거나, 신호가 살아 있는 Run이 있으면 거부한다', async () => {
    const p = (await h.createProject(ctx('lead'), input)).id;
    await seed(p);
    await expectRule(del('lead', p, '틀림'), 'rule', '이름');
    await expectRule(del('guest', p), 'permission');
    await db.doc(`projects/${p}/cycles/c1/runs/r1`).set({ status: 'running', heartbeatAt: T0 });
    await expectRule(del('lead', p), 'rule', '실행 중인 Run 1개');
    expect((await db.doc(`projects/${p}/cycles/c1`).get()).data()?.deletingAt).toBeUndefined();
  });

  it('Storage 삭제가 실패하면 삭제 중 표시를 남기고, 다시 삭제하면 이어서 지운다', async () => {
    const p = (await h.createProject(ctx('lead'), input)).id;
    await seed(p);
    await expect(
      del('lead', p, NAME, async () => {
        throw new Error('storage down');
      }),
    ).rejects.toThrow('storage down');
    expect((await db.doc(`projects/${p}/cycles/c1`).get()).data()?.deletingAt).toBe(T0);
    await del('lead', p);
    expect((await db.doc(`projects/${p}/cycles/c1`).get()).exists).toBe(false);
  });
});

describe('멤버·초대', () => {
  it('링크 초대: 토큰으로 찾아 수락하면 멤버가 되고, 링크는 계속 쓸 수 있다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    // callable SDK는 비운 github를 null로 보낸다
    const inv = await h.createInvitation(ctx('lead'), { projectId: p.id, role: 'viewer', github: null });
    expect(inv.github).toBeUndefined();
    expect((await h.getInvitation(ctx('guest'), { token: inv.token })).state).toBe('pending');
    await expectRule(h.acceptInvitation(ctx('guest'), { token: inv.token, dataNoticeAck: false }), 'rule');
    await h.acceptInvitation(ctx('guest'), { token: inv.token, dataNoticeAck: true });
    expect((await db.doc(`projects/${p.id}/members/${USERS.guest.uid}`).get()).data()?.role).toBe('viewer');
    expect((await h.getInvitation(ctx('guest'), { token: inv.token })).state).toBe('member');
    expect((await h.getInvitation(ctx('qa'), { token: inv.token })).state).toBe('pending');
  });

  it('사용자명 초대는 그 사람만, 한 번만 수락한다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    const inv = await h.createInvitation(ctx('lead'), { projectId: p.id, role: 'qa', github: '@minji-kim' });
    await expectRule(h.acceptInvitation(ctx('guest'), { token: inv.token, dataNoticeAck: true }), 'rule', '@minji-kim');
    await h.acceptInvitation(ctx('qa'), { token: inv.token, dataNoticeAck: true });
    const stored = (await db.doc(`projects/${p.id}/invitations/${inv.id}`).get()).data();
    expect(stored?.status).toBe('accepted');
  });

  it('Admin이 아니면 초대·역할 변경을 못 하고, 마지막 Admin은 남는다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    const inv = await h.createInvitation(ctx('lead'), { projectId: p.id, role: 'qa' });
    await h.acceptInvitation(ctx('qa'), { token: inv.token, dataNoticeAck: true });
    await expectRule(h.createInvitation(ctx('qa'), { projectId: p.id, role: 'qa' }), 'permission');
    await expectRule(h.setMemberRole(ctx('qa'), { projectId: p.id, uid: USERS.qa.uid, role: 'admin' }), 'permission');
    await expectRule(h.leaveProject(ctx('lead'), { projectId: p.id }), 'rule', '마지막 Admin');
    await h.setMemberRole(ctx('lead'), { projectId: p.id, uid: USERS.qa.uid, role: 'admin' });
    await h.leaveProject(ctx('lead'), { projectId: p.id });
    expect((await db.collection(`projects/${p.id}/members`).get()).docs.map((d) => d.id)).toEqual([USERS.qa.uid]);
  });

  it('만료·취소된 초대는 수락할 수 없다', async () => {
    const p = await h.createProject(ctx('lead'), input);
    const t0 = '2026-10-22T00:00:00.000Z';
    const inv = await h.createInvitation(ctx('lead', t0), { projectId: p.id, role: 'qa' });
    await expectRule(
      h.acceptInvitation(ctx('guest', '2026-10-30T00:00:00.000Z'), { token: inv.token, dataNoticeAck: true }),
      'rule',
      '만료',
    );
    await h.revokeInvitation(ctx('lead'), { projectId: p.id, invitationId: inv.id });
    expect((await h.getInvitation(ctx('guest', t0), { token: inv.token })).state).toBe('revoked');
    await expectRule(h.getInvitation(ctx('guest'), { token: 'no-such-token' }), 'not_found');
  });
});

describe('프로필', () => {
  it('에뮬레이터가 아니면 GitHub 토큰으로 확인한 사용자명만 쓴다', async () => {
    await expectRule(h.registerProfile(ctx('lead'), { github: 'someone-else' }, { emulator: false }), 'permission');
    const p = await h.registerProfile(
      ctx('lead'),
      { githubAccessToken: 't', github: 'someone-else' },
      { emulator: false, fetchGithub: async () => ({ login: 'jaesung-lee', name: null }) },
    );
    expect(p).toEqual({ github: 'jaesung-lee', name: 'jaesung-lee' });
  });
});

describe('호스트 연결', () => {
  const mint = async (uid: string, claims: { host: string }) => `token:${uid}:${claims.host}`;

  it('연결하면 비밀값은 해시로만 남고, 그 비밀값으로 호스트 토큰을 받는다', async () => {
    const cred = await h.pairHost(ctx('lead', '2026-10-24T00:00:00.000Z'), { name: '  MacBook Pro  ' });
    expect(cred.uid).toBe(USERS.lead.uid);
    const stored = (await db.doc(`hostConnections/${cred.hostId}`).get()).data()!;
    expect(stored).toMatchObject({ uid: USERS.lead.uid, name: 'MacBook Pro', connectedAt: '2026-10-24T00:00:00.000Z' });
    expect(JSON.stringify(stored)).not.toContain(cred.secret);

    const t = await h.hostToken(db, { hostId: cred.hostId, secret: cred.secret }, mint, () => '2026-10-24T01:00:00Z');
    expect(t.token).toBe(`token:${USERS.lead.uid}:${cred.hostId}`);
    expect((await db.doc(`hostConnections/${cred.hostId}`).get()).data()!.lastTokenAt).toBe('2026-10-24T01:00:00Z');
  });

  it('비밀값이 틀리거나 연결을 해제했으면 토큰을 주지 않는다', async () => {
    const cred = await h.pairHost(ctx('lead'), { name: 'mbp' });
    await expectRule(h.hostToken(db, { hostId: cred.hostId, secret: 'wrong' }, mint), 'permission');
    await db.doc(`users/${USERS.lead.uid}/hosts/${cred.hostId}`).set({ id: cred.hostId, lastSeen: 'x' });

    await h.revokeHost(ctx('lead'), { hostId: cred.hostId });
    await expectRule(h.hostToken(db, cred, mint), 'permission', '다시 연결');
    expect((await db.doc(`users/${USERS.lead.uid}/hosts/${cred.hostId}`).get()).exists).toBe(false);
  });

  it('다른 사람의 PC는 해제할 수 없고, 호스트는 자기 연결만 해제하며 새 PC를 연결하지 못한다', async () => {
    const mine = await h.pairHost(ctx('lead'), { name: 'mbp' });
    const other = await h.pairHost(ctx('lead'), { name: 'imac' });
    await expectRule(h.revokeHost(ctx('qa'), { hostId: mine.hostId }), 'not_found');
    const asHost = { ...ctx('lead'), host: mine.hostId };
    await expectRule(h.revokeHost(asHost, { hostId: other.hostId }), 'permission');
    await expectRule(h.pairHost(asHost, { name: 'x' }), 'permission');
    await h.revokeHost(asHost, { hostId: mine.hostId });
    expect((await db.doc(`hostConnections/${mine.hostId}`).get()).exists).toBe(false);
  });
});
