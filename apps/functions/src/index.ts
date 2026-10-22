import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { MembershipError } from '@qcard/shared';
import * as h from './handlers';

/*
 * qcard Cloud Functions. LLM을 부르는 함수는 없다 — LLM 작업은 요청자의 호스트 에이전트가 한다 (PRD §6.2).
 */

initializeApp();
setGlobalOptions({ region: 'asia-northeast3' });

const CODE = { permission: 'permission-denied', rule: 'failed-precondition', not_found: 'not-found' } as const;

/** 로그인 확인 + 규칙 위반을 HttpsError로 (메시지는 화면에 그대로 보인다) */
function call<T>(fn: (ctx: h.Ctx, data: unknown, req: CallableRequest) => Promise<T>) {
  return onCall(async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    try {
      return await fn({ db: getFirestore(), uid: req.auth.uid }, req.data, req);
    } catch (e) {
      if (e instanceof MembershipError) throw new HttpsError(CODE[e.kind], e.message);
      throw e;
    }
  });
}

export const registerProfile = call((ctx, data) =>
  h.registerProfile(ctx, data, { emulator: process.env.FUNCTIONS_EMULATOR === 'true' }),
);
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

/** 삭제 유예(30일)가 지난 프로젝트 영구 삭제 (F-TM-12) */
export const purgeDeletedProjects = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Seoul' }, async () => {
  await h.purgeDeletedProjects(getFirestore(), new Date().toISOString());
});
