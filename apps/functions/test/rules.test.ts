import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, setLogLevel } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/*
 * Firestore 보안 규칙 (firebase/firestore.rules): 프로젝트 격리, 역할별 쓰기,
 * 프로젝트·멤버·초대는 클라이언트가 직접 못 쓴다 (Functions만).
 */

let env: RulesTestEnvironment;
// assertFails가 기대하는 거부 로그는 숨긴다
setLogLevel('silent');

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../../firebase/firestore.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'projects/haru'), { id: 'haru', name: '하루콩' });
    await setDoc(doc(db, 'projects/haru/members/u-admin'), { role: 'admin' });
    await setDoc(doc(db, 'projects/haru/members/u-qa'), { role: 'qa' });
    await setDoc(doc(db, 'projects/haru/members/u-viewer'), { role: 'viewer' });
    await setDoc(doc(db, 'projects/haru/invitations/i1'), { token: 't1' });
    await setDoc(doc(db, 'projects/haru/qaDocs/doc-130'), { appVersion: '1.3.0' });
    await setDoc(doc(db, 'projects/other/qaDocs/d1'), { appVersion: '1.0.0' });
    await setDoc(doc(db, 'invitationTokens/t1'), { projectId: 'haru', invitationId: 'i1' });
    await setDoc(doc(db, 'users/u-qa'), { github: 'minji-kim' });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe('읽기', () => {
  it('멤버만 프로젝트와 하위 데이터를 읽는다 (프로젝트 격리)', async () => {
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru')));
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru/qaDocs/doc-130')));
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru/members/u-admin')));
    await assertFails(getDoc(doc(as('u-outsider'), 'projects/haru')));
    await assertFails(getDoc(doc(as('u-outsider'), 'projects/haru/qaDocs/doc-130')));
    await assertFails(getDoc(doc(as('u-admin'), 'projects/other/qaDocs/d1')));
    await assertFails(getDoc(doc(as(null), 'projects/haru')));
  });

  it('초대는 Admin만 보고, 초대 토큰 색인은 아무도 못 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('u-admin'), 'projects/haru/invitations/i1')));
    await assertFails(getDoc(doc(as('u-qa'), 'projects/haru/invitations/i1')));
    await assertFails(getDoc(doc(as('u-admin'), 'invitationTokens/t1')));
  });

  it('프로필은 본인만 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('u-qa'), 'users/u-qa')));
    await assertFails(getDoc(doc(as('u-admin'), 'users/u-qa')));
  });
});

describe('쓰기', () => {
  it('프로젝트·멤버·초대·프로필은 클라이언트가 직접 못 쓴다', async () => {
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru'), { name: 'X' }));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/members/u-qa'), { role: 'viewer' }));
    await assertFails(setDoc(doc(as('u-outsider'), 'projects/haru/members/u-outsider'), { role: 'admin' }));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/invitations/i2'), { token: 't2' }));
    await assertFails(setDoc(doc(as('u-qa'), 'users/u-qa'), { github: 'someone-else' }));
    await assertFails(setDoc(doc(as('u-new'), 'projects/new'), { name: 'New' }));
  });

  it('QA 데이터는 Admin·QA가 쓰고 Viewer·비멤버는 못 쓴다', async () => {
    await assertSucceeds(setDoc(doc(as('u-qa'), 'projects/haru/qaDocs/doc-130'), { appVersion: '1.3.1' }));
    await assertSucceeds(setDoc(doc(as('u-admin'), 'projects/haru/cycles/c1/results/r1'), { verdict: 'pass' }));
    await assertFails(setDoc(doc(as('u-viewer'), 'projects/haru/qaDocs/doc-130'), { appVersion: 'x' }));
    await assertFails(setDoc(doc(as('u-outsider'), 'projects/haru/cycles/c1'), { name: 'x' }));
  });

  it('작업(Job)은 본인 이름으로만 요청한다', async () => {
    await assertSucceeds(
      setDoc(doc(as('u-qa'), 'projects/haru/jobs/j1'), { kind: 'qa_doc_generate', requestedBy: 'u-qa' }),
    );
    await assertFails(
      setDoc(doc(as('u-qa'), 'projects/haru/jobs/j2'), { kind: 'qa_doc_generate', requestedBy: 'u-admin' }),
    );
    await assertFails(
      setDoc(doc(as('u-viewer'), 'projects/haru/jobs/j3'), { kind: 'qa_doc_generate', requestedBy: 'u-viewer' }),
    );
  });
});
