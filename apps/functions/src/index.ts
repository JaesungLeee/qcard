import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { MembershipError } from '@qcard/shared';
import * as acc from './accounts';
import { SAMPLE_REPOS } from '@qcard/fixtures/github';
import * as cells from './cells';
import { githubApp, type GitHub } from './github';
import { FakeGitHub } from './githubFake';
import * as h from './handlers';
import * as iss from './issues';
import { kmsBox, localBox, type SecretBox } from './secretBox';

/*
 * qcard Cloud Functions. LLM을 부르는 함수는 없다 — LLM 작업은 요청자의 호스트 에이전트가 한다 (docs/architecture.md).
 */

initializeApp();
setGlobalOptions({ region: 'asia-northeast3' });

/**
 * 테스트 계정 비밀값을 봉인하는 Cloud KMS 키. 키 이름은 비밀이 아니라 코드에 둔다 — 배포 파라미터로 받으면
 * CI(비대화형) 배포가 값을 요구하며 멈춘다. 키를 만드는 법은 docs/dev/deploy.md
 */
const ACCOUNT_KMS_KEY = 'projects/qcard-d2ade/locations/asia-northeast3/keyRings/qcard/cryptoKeys/test-accounts';
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
let box: SecretBox | undefined;
const secretBox = () =>
  (box ??= emulator
    ? localBox('qcard-emulator')
    : kmsBox(ACCOUNT_KMS_KEY, async () => (await applicationDefault().getAccessToken()).access_token));

/**
 * qcard GitHub App (docs/product/issues.md). 등록값 중 비밀이 아닌 것은 코드에, 비밀 키·클라이언트 비밀값·웹훅 비밀값은
 * Secret Manager에 둔다. 등록 절차는 docs/dev/deploy.md. appId가 비어 있으면 GitHub 기능이 꺼진 것으로 본다
 */
const GITHUB_APP = { appId: '5619807', slug: 'qcard-bot', clientId: 'Iv23li7QSA6P0wpL3jnQ' };
const GITHUB_SECRETS = {
  privateKey: defineSecret('GITHUB_APP_PRIVATE_KEY'),
  clientSecret: defineSecret('GITHUB_APP_CLIENT_SECRET'),
  webhookSecret: defineSecret('GITHUB_WEBHOOK_SECRET'),
};
let github: GitHub | undefined;
/** 에뮬레이터는 하루콩 가짜 저장소로 GitHub 없이 연결·발행 흐름을 돌린다 (인가 코드 `fake-dev`) */
const githubOf = (): GitHub => {
  if (github) return github;
  if (emulator) {
    const fake = new FakeGitHub(SAMPLE_REPOS);
    fake.users.set('fake-dev', { login: 'fake-dev', repoIds: SAMPLE_REPOS.map((r) => r.repoId) });
    return (github = fake);
  }
  if (!GITHUB_APP.appId) throw new HttpsError('failed-precondition', 'GitHub App이 아직 설정되지 않았습니다.');
  return (github = githubApp({
    ...GITHUB_APP,
    privateKey: GITHUB_SECRETS.privateKey.value(),
    clientSecret: GITHUB_SECRETS.clientSecret.value(),
    webhookSecret: GITHUB_SECRETS.webhookSecret.value(),
  }));
};

const CODE = { permission: 'permission-denied', rule: 'failed-precondition', not_found: 'not-found' } as const;

const toHttps = (e: unknown) => (e instanceof MembershipError ? new HttpsError(CODE[e.kind], e.message) : e);

/**
 * 로그인 확인 + 규칙 위반을 HttpsError로 (메시지는 화면에 그대로 보인다).
 * 호스트 토큰(`host` 클레임)은 `allowHost`인 함수만 부를 수 있다 — 멤버·초대 같은 사람의 일은 호스트가 하지 않는다
 */
function call<T>(
  fn: (ctx: h.Ctx, data: unknown, req: CallableRequest) => Promise<T>,
  opts: { allowHost?: boolean; timeoutSeconds?: number; secrets?: ReturnType<typeof defineSecret>[] } = {},
) {
  const options = {
    ...(opts.timeoutSeconds ? { timeoutSeconds: opts.timeoutSeconds } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
  };
  return onCall(options, async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const host = typeof req.auth.token.host === 'string' ? req.auth.token.host : undefined;
    if (host && !opts.allowHost)
      throw new HttpsError('permission-denied', '호스트 에이전트는 이 작업을 할 수 없습니다.');
    try {
      return await fn(
        { db: getFirestore(), uid: req.auth.uid, ...(host ? { host } : {}), box: secretBox() },
        req.data,
        req,
      );
    } catch (e) {
      throw toHttps(e);
    }
  });
}

export const registerProfile = call((ctx, data) => h.registerProfile(ctx, data, { emulator }));
export const createProject = call(h.createProject);
export const deleteProject = call(h.deleteProject);
export const restoreProject = call(h.restoreProject);
export const setRunLimits = call(h.setRunLimits);
export const setMemberRole = call(h.setMemberRole);
export const removeMember = call(h.removeMember);
export const leaveProject = call(h.leaveProject);
export const createInvitation = call(h.createInvitation);
export const revokeInvitation = call(h.revokeInvitation);
export const getInvitation = call(h.getInvitation);
export const acceptInvitation = call(h.acceptInvitation);

// 사이클 삭제: 하위 문서와 Storage 증거까지 지운다. 스크린샷이 많으면 오래 걸려 제한 시간을 늘린다
export const deleteCycle = call(
  (ctx, data) => h.deleteCycle(ctx, data, (prefix) => getStorage().bucket().deleteFiles({ prefix })),
  { timeoutSeconds: 300 },
);

// 준비 플로우 삭제: 케이스 참조 확인은 질의가 필요해 Functions 트랜잭션에서 한다
export const deletePrepFlow = call(h.deletePrepFlow);

// 호스트 연결. hostToken은 로그인 전에 부른다 — 호스트 자격(비밀값)으로 확인한다
export const pairHost = call(h.pairHost);
export const revokeHost = call(h.revokeHost, { allowHost: true });
export const hostToken = onCall(async (req) => {
  try {
    return await h.hostToken(getFirestore(), req.data, (uid, claims) => getAuth().createCustomToken(uid, claims));
  } catch (e) {
    throw toHttps(e);
  }
});

// 테스트 계정. 배정·반납은 실행 중인 호스트만 (handlers가 host를 확인한다)
export const createAccount = call(acc.createAccount);
export const updateAccount = call(acc.updateAccount);
export const deleteAccount = call(acc.deleteAccount);
export const clearAccountFlag = call(acc.clearAccountFlag);
export const claimAccount = call(acc.claimAccount, { allowHost: true });
export const releaseAccount = call(acc.releaseAccount, { allowHost: true });

// 칸 자동 선점: 케이스를 시작하기 전에 실행 중인 호스트가 부른다
export const claimCell = call(cells.claimCell, { allowHost: true });

// GitHub 이슈 발행·상태 동기화 (issues.ts). 사람만 부른다
const withGithub =
  (fn: (ctx: iss.IssueCtx, data: unknown) => Promise<unknown>) =>
  (ctx: h.Ctx, data: unknown) =>
    fn({ ...ctx, gh: githubOf() }, data);
const ghSecrets = Object.values(GITHUB_SECRETS);
export const startRepoConnect = call(withGithub(iss.startRepoConnect), { secrets: ghSecrets });
export const listConnectableRepos = call(withGithub(iss.listConnectableRepos), { secrets: ghSecrets });
export const connectRepo = call(withGithub(iss.connectRepo), { secrets: ghSecrets });
export const disconnectRepo = call(withGithub(iss.disconnectRepo), { secrets: ghSecrets });
export const setAssigneeMap = call(withGithub(iss.setAssigneeMap), { secrets: ghSecrets });
export const getIssueContext = call(withGithub(iss.getIssueContext), { secrets: ghSecrets });
export const publishIssue = call(withGithub(iss.publishIssue), { secrets: ghSecrets });
export const setDefectStatus = call(withGithub(iss.setDefectStatus), { secrets: ghSecrets });

/** App 웹훅: 서명(X-Hub-Signature-256)을 확인한 요청만 처리한다. GitHub는 실패한 전달을 다시 보내지 않는다 */
export const githubWebhook = onRequest({ secrets: ghSecrets }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }
  const gh = githubOf();
  if (!gh.verifyWebhook(req.rawBody, req.get('x-hub-signature-256'))) {
    res.status(401).send('bad signature');
    return;
  }
  try {
    const out = await iss.handleWebhook(getFirestore(), req.get('x-github-event') ?? '', req.body, new Date().toISOString());
    console.log(`github webhook: ${out}`);
    res.status(200).send(out);
  } catch (e) {
    console.error('github webhook 실패', e);
    res.status(500).send('error');
  }
});

/**
 * 삭제 유예(30일)가 지난 프로젝트 영구 삭제. 스크린샷이 많으면 오래 걸려 제한 시간을 최대로 둔다 —
 * 그래도 넘기면 남은 것은 다음 날 이어서 지운다
 */
export const purgeDeletedProjects = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Asia/Seoul', timeoutSeconds: 540 },
  async () => {
    const bucket = getStorage().bucket();
    await h.purgeDeletedProjects(getFirestore(), new Date().toISOString(), (prefix) => bucket.deleteFiles({ prefix }));
  },
);
