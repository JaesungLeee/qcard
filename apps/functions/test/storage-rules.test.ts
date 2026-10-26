import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel } from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/*
 * Storage 보안 규칙 (firebase/storage.rules): 멤버만 읽고 Admin·QA만 쓴다, 빌드·스펙 스냅샷은 덮어쓰지 않는다,
 * Run 스크린샷은 그 Run을 실행한 사용자의 호스트만 올린다. 규칙이 Firestore 멤버 문서를 보므로 함께 시드한다.
 */

let env: RulesTestEnvironment;
setLogLevel('silent');

const rules = (name: string) => readFileSync(resolve(import.meta.dirname, '../../../firebase', name), 'utf8');

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: rules('firestore.rules') },
    storage: { rules: rules('storage.rules') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'projects/haru/members/u-admin'), { role: 'admin' });
    await setDoc(doc(db, 'projects/haru/members/u-qa'), { role: 'qa' });
    await setDoc(doc(db, 'projects/haru/members/u-viewer'), { role: 'viewer' });
    await setDoc(doc(db, 'projects/haru/cycles/c1/runs/r1'), { executorUid: 'u-qa' });
    await setDoc(doc(db, 'hostConnections/h-qa'), { id: 'h-qa', uid: 'u-qa' });
    await setDoc(doc(db, 'hostConnections/h-admin'), { id: 'h-admin', uid: 'u-admin' });
  });
});

const storage = (uid: string | null, claims?: Record<string, unknown>) =>
  (uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext()).storage();
const put = (uid: string | null, path: string, claims?: Record<string, unknown>) =>
  uploadString(ref(storage(uid, claims), path), 'x');

const SPEC = 'projects/haru/specBundles/bundle-1.3.0-abc/onboarding/spec.md';
const BUILD = 'projects/haru/builds/b1/app.apk';
const SHOT = 'projects/haru/cycles/c1/runs/r1/TC-001/obs-01.png';

describe('스펙 스냅샷 (F-IN-03)', () => {
  it('Admin·QA가 올리고, 올린 뒤에는 아무도 덮어쓰지 못한다', async () => {
    await assertSucceeds(put('u-qa', SPEC));
    await assertFails(put('u-qa', SPEC));
    await assertFails(put('u-admin', SPEC));
    await assertFails(put('u-viewer', 'projects/haru/specBundles/bundle-x/onboarding/spec.md'));
  });

  it('멤버만 읽는다', async () => {
    const path = 'projects/haru/specBundles/bundle-read/onboarding/spec.md';
    await env.withSecurityRulesDisabled(async (c) => {
      await uploadString(ref(c.storage(), path), 'x');
    });
    await assertSucceeds(getBytes(ref(storage('u-viewer'), path)));
    await assertFails(getBytes(ref(storage('u-outsider'), path)));
    await assertFails(getBytes(ref(storage(null), path)));
  });
});

describe('빌드 (F-DV-05)', () => {
  it('한 번 올린 APK는 덮어쓰지 못한다', async () => {
    await assertSucceeds(put('u-admin', BUILD));
    await assertFails(put('u-admin', BUILD));
    await assertFails(put('u-viewer', 'projects/haru/builds/b2/app.apk'));
  });
});

describe('Run 스크린샷', () => {
  it('그 Run 실행자의 호스트만 올리고, 재시도로 다시 쓸 수 있다', async () => {
    await assertSucceeds(put('u-qa', SHOT, { host: 'h-qa' }));
    await assertSucceeds(put('u-qa', SHOT, { host: 'h-qa' }));
    await assertFails(put('u-qa', SHOT)); // 사람(웹)은 못 쓴다
    await assertFails(put('u-admin', SHOT, { host: 'h-admin' })); // 다른 사용자의 Run
  });
});
