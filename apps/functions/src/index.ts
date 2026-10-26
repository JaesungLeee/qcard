import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { MembershipError } from '@qcard/shared';
import * as acc from './accounts';
import * as h from './handlers';
import { kmsBox, localBox, type SecretBox } from './secretBox';

/*
 * qcard Cloud Functions. LLM을 부르는 함수는 없다 — LLM 작업은 요청자의 호스트 에이전트가 한다 (PRD §6.2).
 */

initializeApp();
setGlobalOptions({ region: 'asia-northeast3' });

/**
 * 테스트 계정 비밀값을 봉인하는 Cloud KMS 키 (F-EX-09). 키 이름은 비밀이 아니라 코드에 둔다 — 배포 파라미터로 받으면
 * CI(비대화형) 배포가 값을 요구하며 멈춘다. 키를 만드는 법은 docs/dev/deploy.md
 */
const ACCOUNT_KMS_KEY = 'projects/qcard-d2ade/locations/asia-northeast3/keyRings/qcard/cryptoKeys/test-accounts';
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
let box: SecretBox | undefined;
const secretBox = () =>
  (box ??= emulator
    ? localBox('qcard-emulator')
    : kmsBox(ACCOUNT_KMS_KEY, async () => (await applicationDefault().getAccessToken()).access_token));

const CODE = { permission: 'permission-denied', rule: 'failed-precondition', not_found: 'not-found' } as const;

const toHttps = (e: unknown) => (e instanceof MembershipError ? new HttpsError(CODE[e.kind], e.message) : e);

/**
 * 로그인 확인 + 규칙 위반을 HttpsError로 (메시지는 화면에 그대로 보인다).
 * 호스트 토큰(`host` 클레임)은 `allowHost`인 함수만 부를 수 있다 — 멤버·초대 같은 사람의 일은 호스트가 하지 않는다
 */
function call<T>(
  fn: (ctx: h.Ctx, data: unknown, req: CallableRequest) => Promise<T>,
  opts: { allowHost?: boolean } = {},
) {
  return onCall(async (req) => {
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
export const setMemberRole = call(h.setMemberRole);
export const removeMember = call(h.removeMember);
export const leaveProject = call(h.leaveProject);
export const createInvitation = call(h.createInvitation);
export const revokeInvitation = call(h.revokeInvitation);
export const getInvitation = call(h.getInvitation);
export const acceptInvitation = call(h.acceptInvitation);

// 호스트 연결 (F-TM-14). hostToken은 로그인 전에 부른다 — 호스트 자격(비밀값)으로 확인한다
export const pairHost = call(h.pairHost);
export const revokeHost = call(h.revokeHost, { allowHost: true });
export const hostToken = onCall(async (req) => {
  try {
    return await h.hostToken(getFirestore(), req.data, (uid, claims) => getAuth().createCustomToken(uid, claims));
  } catch (e) {
    throw toHttps(e);
  }
});

// 테스트 계정 (F-PF-04·08·09). 배정·반납은 실행 중인 호스트만 (handlers가 host를 확인한다)
export const createAccount = call(acc.createAccount);
export const updateAccount = call(acc.updateAccount);
export const deleteAccount = call(acc.deleteAccount);
export const clearAccountFlag = call(acc.clearAccountFlag);
export const claimAccount = call(acc.claimAccount, { allowHost: true });
export const releaseAccount = call(acc.releaseAccount, { allowHost: true });

/** 삭제 유예(30일)가 지난 프로젝트 영구 삭제 (F-TM-12) */
export const purgeDeletedProjects = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Seoul' }, async () => {
  await h.purgeDeletedProjects(getFirestore(), new Date().toISOString());
});
