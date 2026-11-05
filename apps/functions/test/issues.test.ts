import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HARUKONG_PUBLIC_REPO, HARUKONG_REPO } from '@qcard/fixtures/github';
import { MembershipError, type Defect, type Project } from '@qcard/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubError } from '../src/github';
import { FakeGitHub } from '../src/githubFake';
import * as h from '../src/handlers';
import * as iss from '../src/issues';

/*
 * GitHub 이슈 발행·상태 동기화 핸들러 (docs/product/issues.md). Firestore 에뮬레이터 + 가짜 GitHub.
 */

const PROJECT = 'demo-qcard-test';
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();

const USERS = {
  lead: { uid: 'u-lead', name: '이재성', github: 'jaesung-lee', role: 'admin' },
  qa: { uid: 'u-qa', name: '김민지', github: 'minji-kim', role: 'qa' },
  viewer: { uid: 'u-viewer', name: '박도윤', github: 'doyoon-park', role: 'viewer' },
} as const;
type Who = keyof typeof USERS;

let fake: FakeGitHub;
const NOW = '2026-11-04T10:00:00.000Z';
const ctx = (who: Who, now = NOW): iss.IssueCtx => ({ db, uid: USERS[who].uid, now: () => now, gh: fake });
const P = 'haru';
const C = 'c1';
const REF = { projectId: P, cycleId: C, defectId: 'D-1' };

const expectRule = async (p: Promise<unknown>, kind: MembershipError['kind'], text?: string) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(MembershipError);
  expect((e as MembershipError).kind).toBe(kind);
  if (text) expect((e as MembershipError).message).toContain(text);
};

const defectDoc = () => db.doc(`projects/${P}/cycles/${C}/defects/D-1`);
const defect = async () => (await defectDoc().get()).data() as Defect;
const project = async () => (await db.doc(`projects/${P}`).get()).data() as Project;

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('Firestore 에뮬레이터가 필요합니다 (pnpm --filter @qcard/functions test)');
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  fake = new FakeGitHub([{ ...HARUKONG_REPO, issues: [] }, HARUKONG_PUBLIC_REPO]);
  fake.users.set('code-lead', { login: 'jaesung-lee', repoIds: [HARUKONG_REPO.repoId, HARUKONG_PUBLIC_REPO.repoId] });
  fake.users.set('code-outsider', { login: 'outsider', repoIds: [] });
  await db.doc(`projects/${P}`).set({ id: P, name: '하루콩', appName: '하루콩', packageName: 'com.harukong' });
  for (const u of Object.values(USERS)) {
    await h.registerProfile({ db, uid: u.uid }, { github: u.github, name: u.name }, { emulator: true });
    await db.doc(`projects/${P}/members/${u.uid}`).set({
      projectId: P,
      uid: u.uid,
      user: u.name,
      github: u.github,
      role: u.role,
      joinedAt: NOW,
      dataNoticeAckAt: NOW,
    });
  }
  await db.doc(`projects/${P}/cycles/${C}`).set({ id: C, projectId: P, name: '1.2.0 회귀', defectSeq: 1 });
  await defectDoc().set({
    id: 'D-1',
    title: '시작하기 버튼이 안 보인다',
    severity: 'major',
    tcId: 'TC-ONBOARDING-001',
    deviceId: 'galaxy-s24-14',
    repro: ['앱을 처음 연다'],
    expected: '시작하기가 보인다',
    actual: '빈 화면',
    status: 'open',
  } satisfies Defect);
});

/** Admin이 하루콩 비공개 저장소를 연결한다 */
async function connect(repoId = HARUKONG_REPO.repoId) {
  await iss.startRepoConnect(ctx('lead'), { projectId: P });
  const state = (await db.collection('githubConnects').get()).docs[0]!.id;
  await iss.listConnectableRepos(ctx('lead'), { state, code: 'code-lead', installationId: 77 });
  return iss.connectRepo(ctx('lead'), { state, repoId, confirmPublic: true });
}

const publishInput = {
  ...REF,
  title: '[Bug] 시작하기 버튼 없음',
  body: '### 무슨 일이 있었나요?\n\n빈 화면',
  labels: ['bug', 'nope'],
  assignees: ['minji-kim', 'stranger'],
};

describe('저장소 연결', () => {
  it('Admin만 시작하고, 인가한 사람이 접근할 수 있는 저장소만 고른다', async () => {
    await expectRule(iss.startRepoConnect(ctx('qa'), { projectId: P }), 'permission');
    const { installUrl } = await iss.startRepoConnect(ctx('lead'), { projectId: P });
    const state = new URL(installUrl).searchParams.get('state')!;
    const list = await iss.listConnectableRepos(ctx('lead'), { state, code: 'code-lead', installationId: '77' });
    expect(list.repos.map((r) => r.name)).toEqual(['harukong-android', 'harukong-feedback']);
    // 인가 코드는 한 번만 쓸 수 있다 — 다시 부르면 남긴 목록을 준다
    expect((await iss.listConnectableRepos(ctx('lead'), { state })).repos).toHaveLength(2);
    // 다른 사람은 남의 연결 진행을 쓰지 못한다
    await expectRule(iss.listConnectableRepos(ctx('qa'), { state }), 'rule', '만료');
  });

  it('확인하지 않은 저장소는 연결하지 않는다 (설치 ID만으로 연결하지 않는다)', async () => {
    const { installUrl } = await iss.startRepoConnect(ctx('lead'), { projectId: P });
    const state = new URL(installUrl).searchParams.get('state')!;
    await iss.listConnectableRepos(ctx('lead'), { state, code: 'code-outsider', installationId: 77 });
    await expectRule(iss.connectRepo(ctx('lead'), { state, repoId: HARUKONG_REPO.repoId }), 'permission');
  });

  it('공개 저장소는 확인을 받아야 연결한다', async () => {
    const { installUrl } = await iss.startRepoConnect(ctx('lead'), { projectId: P });
    const state = new URL(installUrl).searchParams.get('state')!;
    await iss.listConnectableRepos(ctx('lead'), { state, code: 'code-lead' });
    await expectRule(iss.connectRepo(ctx('lead'), { state, repoId: HARUKONG_PUBLIC_REPO.repoId }), 'rule', '공개');
    const p = await iss.connectRepo(ctx('lead'), { state, repoId: HARUKONG_PUBLIC_REPO.repoId, confirmPublic: true });
    expect(p.repo).toMatchObject({
      name: 'harukong-feedback',
      private: false,
      status: 'active',
      connectedBy: '이재성',
    });
    expect((await db.collection('githubConnects').get()).size).toBe(0);
  });

  it('만료된 연결 진행은 쓰지 못한다', async () => {
    await iss.startRepoConnect(ctx('lead'), { projectId: P });
    const state = (await db.collection('githubConnects').get()).docs[0]!.id;
    await expectRule(
      iss.listConnectableRepos(ctx('lead', '2026-11-04T11:00:00.000Z'), { state, code: 'code-lead' }),
      'rule',
      '만료',
    );
  });

  it('해제와 담당자 매핑은 Admin만', async () => {
    await connect();
    await expectRule(iss.disconnectRepo(ctx('qa'), { projectId: P }), 'permission');
    await iss.disconnectRepo(ctx('lead'), { projectId: P });
    expect((await project()).repo).toBeUndefined();
    await expectRule(iss.setAssigneeMap(ctx('qa'), { projectId: P, map: { onboarding: ['kim'] } }), 'permission');
    await expectRule(iss.setAssigneeMap(ctx('lead'), { projectId: P, map: { onboarding: ['bad name'] } }), 'rule');
    await iss.setAssigneeMap(ctx('lead'), { projectId: P, map: { onboarding: ['@minji-kim'], empty: [] } });
    expect((await project()).assigneeMap).toEqual({ onboarding: ['minji-kim'] });
  });
});

describe('발행', () => {
  it('저장소가 없으면 발행할 수 없다', async () => {
    await expectRule(iss.getIssueContext(ctx('qa'), { projectId: P }), 'rule', 'Admin이 GitHub 저장소를 연결');
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule');
  });

  it('템플릿·라벨·지정 가능한 사람을 읽는다 (config.yml 제외, 해석할 수 없으면 이유)', async () => {
    await connect();
    await expectRule(iss.getIssueContext(ctx('viewer'), { projectId: P }), 'permission');
    const c = await iss.getIssueContext(ctx('qa'), { projectId: P });
    expect(c.repo).toMatchObject({ owner: 'harukong', name: 'harukong-android', private: true });
    expect(c.templates.map((t) => t.file)).toEqual([
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/feature.md',
      '.github/ISSUE_TEMPLATE/old.yml',
    ]);
    expect(c.templates[2]).toMatchObject({ error: expect.stringContaining('rating') });
    expect(c.assignees).toContain('minji-kim');
  });

  it('App 설치에서 저장소가 빠졌으면 연결을 끊김으로 표시한다', async () => {
    await connect();
    fake.failNext.set('repo', new GitHubError('not_found', 'GitHub 404'));
    await expectRule(iss.getIssueContext(ctx('qa'), { projectId: P }), 'not_found');
    expect((await project()).repo?.status).toBe('broken');
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule', '끊겼');
  });

  it('끝줄을 붙여 발행하고, 없는 라벨·지정할 수 없는 사람은 뺀다', async () => {
    await connect();
    const d = await iss.publishIssue(ctx('qa'), publishInput);
    expect(d.issue).toMatchObject({
      repoId: HARUKONG_REPO.repoId,
      repo: 'harukong/harukong-android',
      number: 1,
      state: 'open',
      link: 'linked',
      publishedBy: '김민지',
    });
    const issue = fake.issue(HARUKONG_REPO.repoId, 1);
    expect(issue.labels).toEqual(['bug']);
    expect(issue.assignees).toEqual(['minji-kim']);
    expect(issue.body).toContain(
      '빈 화면\n\n---\nqcard 결함 D-1 · 사이클 "1.2.0 회귀" · 판정 추적: https://qcard.dev/p/haru/cycles/c1/results/TC-ONBOARDING-001/galaxy-s24-14',
    );
    expect(issue.body).toContain('reported by @minji-kim via qcard');
    expect((await db.doc(`issueLinks/${HARUKONG_REPO.repoId}_1`).get()).data()).toMatchObject({
      projectId: P,
      cycleId: C,
      defectId: 'D-1',
    });
    expect((await defect()).publishing).toBeUndefined();
  });

  it('결함 하나에 이슈 하나 — 두 번 발행하지 않는다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await expectRule(iss.publishIssue(ctx('lead'), publishInput), 'rule', '이미 이슈 #1');
    await defectDoc().update({ 'issue.link': 'deleted' });
    expect((await iss.publishIssue(ctx('qa'), publishInput)).issue?.number).toBe(2);
  });

  it('발행 중이면 다른 사람은 기다리고, 실패하면 발행 중 표시를 지운다', async () => {
    await connect();
    await defectDoc().update({ publishing: { by: '이재성', at: NOW } });
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule', '발행하고 있습니다');
    // 오래된 표시는 실패한 것으로 본다
    await defectDoc().update({ publishing: { by: '이재성', at: '2026-11-04T09:00:00.000Z' } });
    fake.failNext.set('createIssue', new GitHubError('failed', 'GitHub 502'));
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule', 'GitHub 502');
    const d = await defect();
    expect(d.publishing).toBeUndefined();
    expect(d.issue).toBeUndefined();
  });

  it('공개 저장소는 확인을 받아야 발행한다 (발행할 때의 공개 여부로)', async () => {
    await connect();
    fake.repos.get(HARUKONG_REPO.repoId)!.private = false;
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule', '공개 저장소');
    expect((await iss.publishIssue(ctx('qa'), { ...publishInput, confirmPublic: true })).issue?.number).toBe(1);
  });

  it('삭제 예정 프로젝트는 발행하지 않는다', async () => {
    await connect();
    await db.doc(`projects/${P}`).update({ deletedAt: NOW });
    await expectRule(iss.publishIssue(ctx('qa'), publishInput), 'rule', '삭제 예정');
  });
});

describe('qcard → GitHub 상태', () => {
  it('closed는 이슈를 닫고, open은 다시 열고, fixed는 코멘트만', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    const issue = () => fake.issue(HARUKONG_REPO.repoId, 1);

    let d = await iss.setDefectStatus(ctx('qa'), { ...REF, status: 'fixed' });
    expect([d.status, issue().state, issue().comments.at(-1)]).toEqual([
      'fixed',
      'open',
      'qcard에서 fixed로 표시 (@minji-kim)',
    ]);

    d = await iss.setDefectStatus(ctx('qa'), { ...REF, status: 'closed' });
    expect([d.status, d.issue?.state, issue().state, issue().stateReason]).toEqual([
      'closed',
      'closed',
      'closed',
      'completed',
    ]);
    expect(issue().comments.at(-1)).toBe('QA 확인 완료 (@minji-kim)');

    d = await iss.setDefectStatus(ctx('lead'), { ...REF, status: 'open' });
    expect([d.status, d.issue?.state, issue().state]).toEqual(['open', 'open', 'open']);
    expect(issue().comments.at(-1)).toBe('QA에서 다시 열림 (@jaesung-lee)');
    expect(d.statusLog?.map((s) => [s.to, s.by, s.via])).toEqual([
      ['fixed', '김민지', 'qcard'],
      ['closed', '김민지', 'qcard'],
      ['open', '이재성', 'qcard'],
    ]);
  });

  it('GitHub 호출이 실패하면 qcard 상태도 바꾸지 않는다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    fake.failNext.set('setIssueState', new GitHubError('forbidden', 'GitHub 403'));
    await expectRule(iss.setDefectStatus(ctx('qa'), { ...REF, status: 'closed' }), 'permission');
    fake.failNext.set('comment', new GitHubError('failed', 'GitHub 500'));
    await expectRule(iss.setDefectStatus(ctx('qa'), { ...REF, status: 'fixed' }), 'rule');
    expect((await defect()).status).toBe('open');
  });

  it('연결을 해제했으면 qcard만 바꾼다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await iss.disconnectRepo(ctx('lead'), { projectId: P });
    const d = await iss.setDefectStatus(ctx('qa'), { ...REF, status: 'closed' });
    expect(d.status).toBe('closed');
    expect(fake.issue(HARUKONG_REPO.repoId, 1).state).toBe('open');
  });

  it('Viewer는 바꾸지 못한다', async () => {
    await expectRule(iss.setDefectStatus(ctx('viewer'), { ...REF, status: 'closed' }), 'permission');
  });
});

describe('GitHub → qcard 웹훅', () => {
  const event = (action: string, extra: Record<string, unknown> = {}) => ({
    action,
    repository: { id: HARUKONG_REPO.repoId },
    issue: { number: 1, ...extra },
    sender: { login: 'dev-hana' },
  });
  const hook = (name: string, payload: unknown) => iss.handleWebhook(db, name, payload, NOW);

  it('닫힘(completed)은 fixed, 다시 열림은 open, not planned는 closed', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await hook('issues', event('closed', { state_reason: 'completed' }));
    expect((await defect()).status).toBe('fixed');
    await hook('issues', event('reopened'));
    expect((await defect()).status).toBe('open');
    await hook('issues', event('closed', { state_reason: 'not_planned' }));
    const d = await defect();
    expect([d.status, d.issue?.state, d.issue?.closeReason]).toEqual(['closed', 'closed', 'not_planned']);
    expect(d.statusLog?.map((s) => [s.to, s.by, s.via])).toEqual([
      ['fixed', 'dev-hana', 'github'],
      ['open', 'dev-hana', 'github'],
      ['closed', 'dev-hana', 'github'],
    ]);
  });

  it('qcard가 바꾼 상태가 돌아와도 되돌아가지 않는다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await iss.setDefectStatus(ctx('qa'), { ...REF, status: 'closed' });
    await hook('issues', event('closed', { state_reason: 'completed' }));
    const d = await defect();
    expect(d.status).toBe('closed');
    expect(d.statusLog).toHaveLength(1);
  });

  it('삭제·이전은 연결 표시만 바꾸고, 그 뒤 이벤트는 받지 않는다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await hook('issues', {
      ...event('transferred'),
      changes: { new_issue: { html_url: 'https://github.com/x/y/issues/9' } },
    });
    let d = await defect();
    expect([d.issue?.link, d.issue?.url, d.status]).toEqual(['transferred', 'https://github.com/x/y/issues/9', 'open']);
    expect(await hook('issues', event('closed', { state_reason: 'completed' }))).toContain('qcard 이슈 아님');

    await defectDoc().update({ 'issue.link': 'deleted' });
    await iss.publishIssue(ctx('qa'), publishInput);
    await hook('issues', event('deleted', { number: 2 }) as never);
    d = await defect();
    expect(d.issue?.link).toBe('deleted');
  });

  it('연결 해제·삭제 예정·다른 프로젝트의 저장소면 무시한다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    await iss.disconnectRepo(ctx('lead'), { projectId: P });
    expect(await hook('issues', event('closed', { state_reason: 'completed' }))).toContain('동기화 안 함');
    expect((await defect()).status).toBe('open');
  });

  it('App 삭제·저장소 제외는 연결을 끊김으로, 공개 전환은 공개 여부로', async () => {
    await connect();
    await hook('repository', { action: 'publicized', repository: { id: HARUKONG_REPO.repoId } });
    expect((await project()).repo?.private).toBe(false);
    await hook('installation_repositories', {
      action: 'removed',
      installation: { id: 77 },
      repositories_removed: [{ id: 999 }],
    });
    expect((await project()).repo?.status).toBe('active');
    await hook('installation', { action: 'deleted', installation: { id: 77 } });
    expect((await project()).repo?.status).toBe('broken');
  });

  it('서명이 맞는 요청만 받는다', () => {
    const body = JSON.stringify({ action: 'closed' });
    expect(fake.verifyWebhook(Buffer.from(body), fake.sign(body))).toBe(true);
    expect(fake.verifyWebhook(Buffer.from(body), fake.sign('{}'))).toBe(false);
    expect(fake.verifyWebhook(Buffer.from(body), undefined)).toBe(false);
  });
});

describe('삭제', () => {
  it('사이클을 지우면 이슈 색인도 지우고, GitHub 이슈는 남긴다', async () => {
    await connect();
    await iss.publishIssue(ctx('qa'), publishInput);
    expect(await h.removeIssueLinks(db, P, 'other-cycle')).toBe(0);
    expect(await h.removeIssueLinks(db, P, C)).toBe(1);
    expect((await db.collection('issueLinks').get()).size).toBe(0);
    expect(fake.issue(HARUKONG_REPO.repoId, 1).state).toBe('open');
  });
});
