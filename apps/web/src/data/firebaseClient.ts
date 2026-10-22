import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GithubAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { createFirebaseApi } from '@qcard/data/firebase';
import { SEED_PASSWORD, SEED_USERS } from '@qcard/data/seed';

/*
 * 브라우저용 Firebase 연결. `VITE_DATA=firebase`일 때 ApiProvider가 쓴다.
 * - 에뮬레이터(`VITE_FIREBASE_EMULATOR=true`): 프로젝트 `demo-qcard`, 시드 사용자로 로그인 (pnpm emu)
 * - 실제 프로젝트: VITE_FIREBASE_API_KEY·AUTH_DOMAIN·PROJECT_ID·APP_ID, GitHub 로그인
 */

const env = import.meta.env;
export const usingEmulator = env.VITE_FIREBASE_EMULATOR === 'true';

/** 에뮬레이터 시드 사용자 (pnpm emu가 만든다) */
export const TEST_USERS = SEED_USERS;
export const TEST_PASSWORD = SEED_PASSWORD;

export type SignedIn = { uid: string; name: string } | null;

export function createFirebaseClient() {
  const app = initializeApp(
    usingEmulator
      ? {
          projectId: 'demo-qcard',
          apiKey: 'demo-key',
          authDomain: 'demo-qcard.firebaseapp.com',
          storageBucket: 'demo-qcard.appspot.com',
        }
      : {
          apiKey: env.VITE_FIREBASE_API_KEY,
          authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
          appId: env.VITE_FIREBASE_APP_ID,
        },
  );
  const auth = getAuth(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const functions = getFunctions(app, 'asia-northeast3');
  const storage = getStorage(app);
  if (usingEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }
  const call = async <T>(name: string, data: unknown) => (await httpsCallable<unknown, T>(functions, name)(data)).data;

  let user: SignedIn = null;
  const api = createFirebaseApi({ db, storage, user: () => user, call });

  return {
    api,
    /** 로그인 상태가 바뀔 때. 표시 이름은 프로필(users/{uid})에서 읽는다 */
    onUser(cb: (u: SignedIn) => void) {
      return onAuthStateChanged(auth, async (u) => {
        if (!u) {
          user = null;
        } else {
          const profile = await getDoc(doc(db, 'users', u.uid)).catch(() => undefined);
          user = { uid: u.uid, name: (profile?.data()?.name as string | undefined) ?? u.displayName ?? u.uid };
        }
        cb(user);
      });
    },
    /** GitHub 로그인 후 GitHub 사용자명을 확인해 프로필에 쓴다 (초대 수락 기준) */
    async signInWithGithub() {
      const result = await signInWithPopup(auth, new GithubAuthProvider());
      const token = GithubAuthProvider.credentialFromResult(result)?.accessToken;
      await call('registerProfile', { githubAccessToken: token });
    },
    signInTestUser: (email: string) => signInWithEmailAndPassword(auth, email, TEST_PASSWORD),
    signOut: () => signOut(auth),
  };
}

export type FirebaseClient = ReturnType<typeof createFirebaseClient>;
