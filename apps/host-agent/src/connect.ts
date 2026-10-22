import { createFirebaseApi } from '@qcard/data/firebase';
import { SEED_PASSWORD, SEED_USERS } from '@qcard/data/seed';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

/**
 * 호스트 에이전트의 Firebase 연결. 지금은 에뮬레이터(`pnpm emu`)에만 붙고, 시드 사용자(GitHub 사용자명)로 로그인한다.
 * 실제 Firebase·GitHub 로그인(디바이스 흐름)은 배포 준비 때 붙인다.
 */
export async function connectEmulator(github: string) {
  const app = initializeApp({ projectId: 'demo-qcard', apiKey: 'demo-key', storageBucket: 'demo-qcard.appspot.com' });
  const auth = getAuth(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const storage = getStorage(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  const user = SEED_USERS.find((u) => u.github === github);
  if (!user) throw new Error(`시드 사용자가 아닙니다: ${github} (${SEED_USERS.map((u) => u.github).join(', ')})`);
  await signInWithEmailAndPassword(auth, user.email, SEED_PASSWORD);
  const api = createFirebaseApi({
    db,
    storage,
    user: () => ({ uid: user.uid, name: user.name }),
    call: () => Promise.reject(new Error('호스트 에이전트는 callable을 쓰지 않는다')),
  });
  return { db, storage, api, user };
}
