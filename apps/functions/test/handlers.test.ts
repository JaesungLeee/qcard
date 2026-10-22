import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MembershipError } from '@qcard/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import * as h from '../src/handlers';

/*
 * Firestore 에뮬레이터 위에서 핸들러를 직접 부른다 (`pnpm --filter @qcard/functions test`가 에뮬레이터를 띄운다).
 * 규칙 자체는 @qcard/shared membership과 웹 메모리 구현 테스트가 다루고, 여기서는 Firestore에 맞게
 * 읽고 쓰는지(트랜잭션·색인·하위 문서)를 본다.
 */

const PROJECT = 'demo-qcard-test';
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();

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
    expect(await h.purgeDeletedProjects(db, '2026-11-20T00:00:00.000Z')).toEqual([]);
    expect(await h.purgeDeletedProjects(db, '2026-11-21T00:00:00.000Z')).toEqual([p.id]);
    expect((await db.doc(`projects/${p.id}`).get()).exists).toBe(false);
    expect((await db.collection(`projects/${p.id}/members`).get()).size).toBe(0);
    expect((await db.collection('invitationTokens').get()).size).toBe(0);
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
