/**
 * 에뮬레이터에 fixture를 넣는다: Auth 시드 사용자(비밀번호 qcard-dev) + Firestore 문서 + 1.3.0 문서의 스펙 묶음(Storage).
 * `pnpm emu`가 에뮬레이터를 띄운 뒤 자동으로 부른다. 실제 Firebase에는 쓰지 않는다 (에뮬레이터 환경변수 필수).
 *
 *   --wait   시드 후 끝내지 않고 기다린다 (에뮬레이터를 계속 띄워 두기 위해)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { SEED_PASSWORD, seedDocs, SEED_USERS } from '@qcard/data/seed';
import { qaDocV130 } from '@qcard/fixtures';
import { hash, type SpecBundle } from '@qcard/shared';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!host || !authHost) {
  console.error('에뮬레이터에서만 실행합니다 (FIRESTORE_EMULATOR_HOST·FIREBASE_AUTH_EMULATOR_HOST 필요)');
  process.exit(1);
}

const PROJECT = 'demo-qcard';
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

for (const u of SEED_USERS) {
  await auth.createUser({ uid: u.uid, email: u.email, password: SEED_PASSWORD, displayName: u.name });
}
// 개발 시드에는 연결된 실기기(SM-S711N) 대상 사이클도 넣는다
const docs = seedDocs({ deviceCycle: true });
for (let i = 0; i < docs.length; i += 450) {
  const batch = db.batch();
  for (const [path, data] of docs.slice(i, i + 450)) batch.set(db.doc(path), data);
  await batch.commit();
}
// 1.3.0 문서의 스펙 묶음: 호스트가 출처 스펙 행을 읽는 작업(케이스 수정안)을 에뮬레이터에서 해 볼 수 있게
const bucket = getStorage().bucket(`${PROJECT}.appspot.com`);
const bundle: SpecBundle = {
  id: qaDocV130.specBundleId,
  projectId: qaDocV130.projectId,
  appVersion: qaDocV130.appVersion,
  uploadedBy: 'seed',
  uploadedAt: qaDocV130.createdAt,
  specs: [],
  ignored: 0,
};
for (const s of qaDocV130.specs) {
  const content = readFileSync(
    resolve(import.meta.dirname, `../../../packages/fixtures/spec/${s.name}/spec.md`),
    'utf8',
  );
  const path = `projects/${bundle.projectId}/specBundles/${bundle.id}/${s.name}/spec.md`;
  await bucket.file(path).save(content, { contentType: 'text/markdown; charset=utf-8' });
  bundle.specs.push({ name: s.name, title: s.feature, path, contentHash: hash(content) });
}
await db.doc(`projects/${bundle.projectId}/specBundles/${bundle.id}`).set(bundle);
console.log(`시드 완료: 사용자 ${SEED_USERS.length}명, 문서 ${docs.length}개 (비밀번호 qcard-dev)`);

if (process.argv.includes('--wait')) {
  console.log('에뮬레이터 실행 중 — 끝내려면 Ctrl+C. 웹: pnpm dev:firebase');
  // 타이머가 있어야 프로세스가 끝나지 않는다 (Ctrl+C까지 에뮬레이터 유지)
  setInterval(() => {}, 60_000);
}
