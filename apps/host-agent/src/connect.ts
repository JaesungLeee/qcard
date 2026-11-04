import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createFirebaseApi } from '@qcard/data/firebase';
import { SEED_PASSWORD, SEED_USERS } from '@qcard/data/seed';
import type { HostConnection, HostCredential } from '@qcard/shared';
import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { callableLeaser } from './accounts';
import { callableClaimer } from './cells';

/*
 * 호스트 에이전트의 Firebase 연결. 호스트는 GitHub로 따로 로그인하지 않는다.
 *
 *   1. connect: 호스트가 127.0.0.1에 잠깐 서버를 열고 브라우저로 웹의 연결 화면(/connect?port&nonce&name)을 연다.
 *      웹에 로그인한 사용자가 [이 PC 연결]을 누르면 Functions pairHost가 호스트 자격(비밀값)을 만들고,
 *      웹은 그 자격을 이 서버로 POST한다(같은 PC의 브라우저만 127.0.0.1에 닿는다). 자격은 macOS 키체인에 둔다.
 *   2. 켤 때마다: 자격으로 Functions hostToken을 불러 짧은 수명의 로그인 토큰(`host` 클레임)을 받아 로그인한다.
 *      보안 규칙은 이 클레임의 연결이 살아 있을 때만 통과시키므로, 웹에서 연결을 해제하면 바로 막힌다.
 *
 * 개발: 에뮬레이터에서는 `--user <시드 GitHub 사용자명>`으로 브라우저 없이 그 사용자 이름으로 연결한다.
 */

export type { HostCredential };

/** 붙을 Firebase와 웹 주소 */
export type FirebaseTarget = { config: FirebaseOptions; emulator: boolean; webUrl: string };

/** 운영 서비스. 웹 설정은 브라우저에 그대로 노출되는 공개값이다 (보호는 보안 규칙·승인된 도메인이 한다) */
export const PROD_TARGET: FirebaseTarget = {
  config: {
    apiKey: 'AIzaSyBn9Z9tJqfKiXPWYnNUX0flAFoP-OO4P6E',
    authDomain: 'qcard-d2ade.firebaseapp.com',
    projectId: 'qcard-d2ade',
    storageBucket: 'qcard-d2ade.firebasestorage.app',
    appId: '1:692024432834:web:bc0d61dc6eaa8676c2c35b',
  },
  emulator: false,
  webUrl: 'https://qcard.dev',
};

/**
 * 1. QCARD_FIREBASE_CONFIG(웹 설정 JSON) + QCARD_WEB_URL: 그 프로젝트
 * 2. QCARD_TARGET=prod: 운영 서비스 (배포한 `qcard` 명령의 기본값, `main.ts`)
 * 3. 그 밖: 개발용 에뮬레이터(`pnpm emu`)와 http://localhost:5173 — 저장소의 pnpm 스크립트
 */
export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): FirebaseTarget {
  const raw = env.QCARD_FIREBASE_CONFIG;
  if (raw) {
    const config = JSON.parse(raw) as FirebaseOptions;
    if (!config.projectId || !config.apiKey) throw new Error('QCARD_FIREBASE_CONFIG에 projectId·apiKey가 필요합니다');
    if (!env.QCARD_WEB_URL) throw new Error('QCARD_WEB_URL(웹 대시보드 주소)이 필요합니다');
    return { config, emulator: false, webUrl: env.QCARD_WEB_URL };
  }
  if (env.QCARD_TARGET === 'prod') return PROD_TARGET;
  return {
    config: { projectId: 'demo-qcard', apiKey: 'demo-key', storageBucket: 'demo-qcard.appspot.com' },
    emulator: true,
    webUrl: env.QCARD_WEB_URL ?? 'http://localhost:5173',
  };
}

/** 안내 문구에 넣을 호스트 명령: 배포한 `qcard` 명령이면 `qcard <명령>`, 저장소에서 돌리면 pnpm 스크립트 */
export const hostCommand = (sub: string) =>
  process.env.QCARD_CLI ? `qcard ${sub}` : `pnpm --filter @qcard/host ${sub}`;

// ---------------------------------------------------------------- 자격 보관

export interface CredentialStore {
  load(): Promise<HostCredential | undefined>;
  save(c: HostCredential): Promise<void>;
  clear(): Promise<void>;
}

const run = promisify(execFile);
const SERVICE = 'qcard-host';

const parseCredential = (raw: string): HostCredential | undefined => {
  try {
    const c = JSON.parse(raw) as Partial<HostCredential>;
    return c.uid && c.hostId && c.secret ? { uid: c.uid, hostId: c.hostId, secret: c.secret } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * macOS 키체인 (`security` 명령). 비밀값은 키체인에만 두고 파일로 쓰지 않는다.
 * `account`로 Firebase 프로젝트(와 개발용 시드 사용자)를 나눈다
 */
export function keychainStore(account: string): CredentialStore {
  return {
    async load() {
      try {
        const { stdout } = await run('security', ['find-generic-password', '-a', account, '-s', SERVICE, '-w']);
        return parseCredential(stdout.trim());
      } catch {
        return undefined; // 항목 없음
      }
    },
    async save(c) {
      await run('security', ['add-generic-password', '-U', '-a', account, '-s', SERVICE, '-w', JSON.stringify(c)]);
    },
    async clear() {
      await run('security', ['delete-generic-password', '-a', account, '-s', SERVICE]).catch(() => undefined);
    },
  };
}

/** 파일 (키체인이 없는 환경·테스트). 본인만 읽을 수 있게(0600) 쓴다 */
export function fileStore(path: string): CredentialStore {
  return {
    async load() {
      return parseCredential(await readFile(path, 'utf8').catch(() => ''));
    },
    async save(c) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(c), { mode: 0o600 });
      await chmod(path, 0o600);
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

/** 이 PC의 자격 보관소: macOS는 키체인, 그 밖은 ~/.qcard/host-<계정>.json */
export function credentialStore(target: FirebaseTarget, seedUser?: string): CredentialStore {
  const account = `${target.config.projectId}${seedUser ? `:${seedUser}` : ''}`;
  return process.platform === 'darwin'
    ? keychainStore(account)
    : fileStore(join(homedir(), '.qcard', `host-${account.replace(/[^\w.-]+/g, '_')}.json`));
}

// ---------------------------------------------------------------- 연결 (브라우저)

/** 웹 연결 화면에 보여 줄 이 PC 이름 (macOS 컴퓨터 이름, 없으면 호스트 이름) */
export async function machineName(): Promise<string> {
  if (process.platform === 'darwin') {
    const name = await run('scutil', ['--get', 'ComputerName'])
      .then((r) => r.stdout.trim())
      .catch(() => '');
    if (name) return name.slice(0, 60);
  }
  return hostname()
    .replace(/\.local$/, '')
    .slice(0, 60);
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;line-height:1.6">` +
  `<h1 style="font-size:20px">${title}</h1><p>${body}</p></body></html>`;

/**
 * 브라우저로 웹의 연결 화면을 열고, 웹이 돌려준 호스트 자격을 받는다.
 * 127.0.0.1에만 열고, Host·Origin(웹 주소)·nonce가 맞는 POST 하나만 받는다. 받으면 서버를 닫는다
 */
export function pairInBrowser(opts: {
  webUrl: string;
  name: string;
  open: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<HostCredential> {
  const nonce = randomBytes(24).toString('base64url');
  const webOrigin = new URL(opts.webUrl).origin;
  return new Promise((resolve, reject) => {
    let port = 0;
    const finish = (err: Error | undefined, cred?: HostCredential) => {
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(cred!);
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reply = (status: number, title: string, body: string) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(PAGE(title, body));
      };
      if (req.method !== 'POST' || req.url !== '/pair') return reply(404, '찾을 수 없습니다', '');
      // 다른 사이트의 요청·DNS 리바인딩을 막는다
      if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin !== webOrigin) {
        return reply(403, '연결할 수 없습니다', 'qcard 웹의 연결 화면에서만 연결할 수 있습니다.');
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 4096) req.destroy();
      });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const got = Buffer.from(f.get('nonce') ?? '');
        const want = Buffer.from(nonce);
        const uid = f.get('uid');
        const hostId = f.get('hostId');
        const secret = f.get('secret');
        if (got.length !== want.length || !timingSafeEqual(got, want) || !uid || !hostId || !secret) {
          return reply(400, '연결할 수 없습니다', '연결 정보가 맞지 않습니다. 터미널에서 다시 시작하세요.');
        }
        reply(200, '이 PC를 연결했습니다', '이 탭을 닫고 터미널로 돌아가세요.');
        finish(undefined, { uid, hostId, secret });
      });
    });
    const timer = setTimeout(
      () => finish(new Error('연결 시간이 지났습니다. 다시 시작하세요.')),
      opts.timeoutMs ?? 10 * 60_000,
    );
    server.on('error', (e) => finish(e));
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      const url = `${opts.webUrl}/connect?${new URLSearchParams({ port: String(port), nonce, name: opts.name })}`;
      opts.log?.(`브라우저에서 연결 화면을 엽니다. 열리지 않으면 이 주소를 여세요:\n  ${url}`);
      void Promise.resolve(opts.open(url)).catch(() => undefined);
    });
  });
}

/** 기본 브라우저로 연다 (macOS `open`) */
export const openBrowser = (url: string) => run('open', [url]).then(() => undefined);

// ---------------------------------------------------------------- 로그인 (켤 때마다)

/** 웹에서 연결을 해제했거나 자격이 맞지 않음 — 다시 연결해야 한다 */
export class HostDisconnectedError extends Error {}

function firebaseOf(target: FirebaseTarget, appName: string) {
  const app = initializeApp(target.config, appName);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const storage = getStorage(app);
  const functions = getFunctions(app, 'asia-northeast3');
  if (target.emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  return { app, auth, db, storage, functions };
}

const callable =
  (functions: Functions) =>
  async <T>(name: string, data: unknown): Promise<T> =>
    (await httpsCallable<unknown, T>(functions, name)(data)).data;

const isPermission = (e: unknown) =>
  typeof e === 'object' && !!e && 'code' in e && String((e as { code: unknown }).code).endsWith('permission-denied');

/** 호스트 자격으로 로그인해 Firestore·Storage·QcardApi를 연다 */
export async function signInHost(target: FirebaseTarget, cred: HostCredential) {
  const { auth, db, storage, functions } = firebaseOf(target, `host-${cred.hostId}`);
  const call = callable(functions);
  let token: string;
  try {
    ({ token } = await call<{ token: string }>('hostToken', { hostId: cred.hostId, secret: cred.secret }));
  } catch (e) {
    if (isPermission(e)) throw new HostDisconnectedError(e instanceof Error ? e.message : String(e));
    throw e;
  }
  const { user: u } = await signInWithCustomToken(auth, token);
  const profile = (await getDoc(doc(db, 'users', u.uid))).data() as { name?: string; github?: string } | undefined;
  const conn = (await getDoc(doc(db, 'hostConnections', cred.hostId))).data() as HostConnection | undefined;
  const user = { uid: u.uid, name: profile?.name ?? u.uid, github: profile?.github ?? '' };
  const api = createFirebaseApi({ db, storage, user: () => ({ uid: user.uid, name: user.name }), call });
  return {
    db,
    storage,
    api,
    user,
    host: { id: cred.hostId, name: conn?.name ?? cred.hostId },
    /** Run 소유 (Run 문서에 남긴다) */
    account: { uid: user.uid, hostId: cred.hostId },
    /** 업로드 큐 폴더: 프로젝트·계정마다 따로 (다른 계정으로 다시 연결해도 남의 작업을 보내지 않는다) */
    queueDir: join(homedir(), '.qcard', 'upload-queue', target.config.projectId ?? 'default', user.uid),
    /** 이 PC의 연결을 해제한다 (호스트 토큰으로 자기 연결만) */
    disconnect: () => call<void>('revokeHost', { hostId: cred.hostId }),
    /** 테스트 계정 배정·반납 */
    accounts: callableLeaser(call),
    /** 칸 자동 선점 */
    cells: callableClaimer(call),
  };
}

/**
 * connect: 이미 연결된 PC면 그대로 둔다 (연결할 때마다 웹에 쓸 수 없는 연결이 쌓이지 않게).
 * `force`면 새로 연결해 자격을 저장한 뒤 예전 연결을 해제한다 — 브라우저에서 취소해도 예전 연결은 남는다
 */
export async function connectHost<S extends { host: { name: string }; disconnect(): Promise<void> }>(opts: {
  store: CredentialStore;
  pair: () => Promise<HostCredential>;
  signIn: (c: HostCredential) => Promise<S>;
  force?: boolean;
}): Promise<
  { status: 'already'; session: S } | { status: 'connected'; session: S; replaced?: { name: string; revoked: boolean } }
> {
  const saved = await opts.store.load();
  let old: S | undefined;
  if (saved) {
    try {
      old = await opts.signIn(saved);
    } catch (e) {
      if (!(e instanceof HostDisconnectedError)) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`이 PC의 연결 상태를 확인하지 못했습니다 (${msg}). 네트워크를 확인하고 다시 시도하세요.`);
      }
      await opts.store.clear(); // 웹에서 해제한 연결
    }
  }
  if (old && !opts.force) return { status: 'already', session: old };
  const cred = await opts.pair();
  await opts.store.save(cred);
  const session = await opts.signIn(cred);
  if (!old) return { status: 'connected', session };
  const revoked = await old.disconnect().then(
    () => true,
    () => false,
  );
  return { status: 'connected', session, replaced: { name: old.host.name, revoked } };
}

/** 개발용: 에뮬레이터 시드 사용자로 로그인해 그 이름으로 연결한다 (브라우저 없이) */
export async function pairAsSeedUser(target: FirebaseTarget, github: string, name: string): Promise<HostCredential> {
  if (!target.emulator) throw new Error('--user는 에뮬레이터에서만 씁니다. 실제 서비스는 connect로 연결하세요.');
  const seed = SEED_USERS.find((u) => u.github === github);
  if (!seed) throw new Error(`시드 사용자가 아닙니다: ${github} (${SEED_USERS.map((u) => u.github).join(', ')})`);
  const { app, auth, functions } = firebaseOf(target, `pair-${github}-${Date.now()}`);
  try {
    await signInWithEmailAndPassword(auth as Auth, seed.email, SEED_PASSWORD);
    return await callable(functions)<HostCredential>('pairHost', { name });
  } finally {
    await deleteApp(app as FirebaseApp);
  }
}

/**
 * 호스트 명령(serve·run-cycle)의 시작: 보관한 자격으로 로그인한다. 연결이 해제됐으면 자격을 지우고 알려 준다.
 * `seedUser`(에뮬레이터 개발용)면 자격이 없거나 해제됐을 때 그 사용자로 다시 연결한다
 */
export async function openHostSession(opts: { seedUser?: string; target?: FirebaseTarget; store?: CredentialStore }) {
  const target = opts.target ?? targetFromEnv();
  const store = opts.store ?? credentialStore(target, opts.seedUser);
  const pairSeed = async () => {
    const c = await pairAsSeedUser(target, opts.seedUser!, await machineName());
    await store.save(c);
    return c;
  };
  let cred = await store.load();
  if (!cred) {
    if (!opts.seedUser) {
      throw new HostDisconnectedError(
        `이 PC가 qcard 계정에 연결되지 않았습니다. 먼저 연결하세요: ${hostCommand('connect')}`,
      );
    }
    cred = await pairSeed();
  }
  try {
    return await signInHost(target, cred);
  } catch (e) {
    if (!(e instanceof HostDisconnectedError)) throw e;
    await store.clear();
    if (opts.seedUser) return signInHost(target, await pairSeed());
    throw new HostDisconnectedError(`이 PC의 연결이 해제되었습니다. 다시 연결하세요: ${hostCommand('connect')}`);
  }
}
