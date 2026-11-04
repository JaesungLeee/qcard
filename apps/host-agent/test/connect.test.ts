import { request } from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostCredential } from '@qcard/shared';
import {
  connectHost,
  fileStore,
  HostDisconnectedError,
  pairInBrowser,
  targetFromEnv,
  type CredentialStore,
} from '../src/connect';

/*
 * 호스트 연결: 웹의 연결 화면이 127.0.0.1의 임시 서버로 호스트 자격을 POST한다.
 * 브라우저 대신 같은 요청을 직접 보낸다.
 */

const WEB = 'https://qcard.example';

/** 웹 연결 화면이 보내는 것과 같은 폼 POST */
function post(url: string, form: Record<string, string>, headers: Record<string, string> = { origin: WEB }) {
  return new Promise<number>((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** 연결 화면 주소에서 POST 대상과 nonce를 꺼낸다 */
const opened = (url: string) => {
  const u = new URL(url);
  return { pairUrl: `http://127.0.0.1:${u.searchParams.get('port')}/pair`, nonce: u.searchParams.get('nonce')!, u };
};

describe('pairInBrowser', () => {
  it('웹 연결 화면을 PC 이름과 함께 열고, 그 화면이 보낸 자격을 받는다', async () => {
    let seen: ReturnType<typeof opened> | undefined;
    const cred = await pairInBrowser({
      webUrl: WEB,
      name: 'MacBook Pro',
      open: async (url) => {
        seen = opened(url);
        const form = { nonce: seen.nonce, uid: 'u-lead', hostId: 'h1', secret: 's3cret' };
        expect(await post(seen.pairUrl, form)).toBe(200);
      },
    });
    expect(seen!.u.origin + seen!.u.pathname).toBe(`${WEB}/connect`);
    expect(seen!.u.searchParams.get('name')).toBe('MacBook Pro');
    expect(cred).toEqual({ uid: 'u-lead', hostId: 'h1', secret: 's3cret' });
  });

  it('다른 사이트에서 보냈거나 nonce가 틀리면 받지 않는다', async () => {
    const cred = await pairInBrowser({
      webUrl: WEB,
      name: 'mbp',
      open: async (url) => {
        const { pairUrl, nonce } = opened(url);
        const form = { nonce, uid: 'u', hostId: 'h', secret: 's' };
        expect(await post(pairUrl, form, { origin: 'https://evil.example' })).toBe(403);
        expect(await post(pairUrl, form, {})).toBe(403);
        expect(await post(pairUrl, { ...form, nonce: 'wrong' })).toBe(400);
        expect(await post(pairUrl, { ...form, secret: '' })).toBe(400);
        expect(await post(pairUrl, { ...form, uid: 'u-ok' })).toBe(200);
      },
    });
    expect(cred.uid).toBe('u-ok');
  });

  it('시간 안에 연결하지 않으면 실패한다', async () => {
    await expect(pairInBrowser({ webUrl: WEB, name: 'mbp', open: () => {}, timeoutMs: 50 })).rejects.toThrow(
      '연결 시간이 지났습니다',
    );
  });
});

describe('자격 보관·연결 대상', () => {
  it('파일 보관소는 본인만 읽게 쓰고, 지우면 없다', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'qcard-cred-')), 'host.json');
    const store = fileStore(path);
    expect(await store.load()).toBeUndefined();
    await store.save({ uid: 'u', hostId: 'h', secret: 's' });
    expect(await store.load()).toEqual({ uid: 'u', hostId: 'h', secret: 's' });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('설정이 없으면 개발용 에뮬레이터, 있으면 그 프로젝트와 웹 주소, QCARD_TARGET=prod면 운영', () => {
    expect(targetFromEnv({})).toMatchObject({ emulator: true, webUrl: 'http://localhost:5173' });
    const real = targetFromEnv({
      QCARD_FIREBASE_CONFIG: JSON.stringify({ projectId: 'qcard-prod', apiKey: 'k' }),
      QCARD_WEB_URL: 'https://qcard.example',
    });
    expect(real).toMatchObject({ emulator: false, webUrl: 'https://qcard.example' });
    expect(targetFromEnv({ QCARD_TARGET: 'prod' })).toMatchObject({
      emulator: false,
      config: { projectId: 'qcard-d2ade' },
      webUrl: 'https://qcard.dev',
    });
    expect(() => targetFromEnv({ QCARD_FIREBASE_CONFIG: JSON.stringify({ projectId: 'p', apiKey: 'k' }) })).toThrow(
      'QCARD_WEB_URL',
    );
  });
});

describe('connectHost', () => {
  const OLD = { uid: 'u', hostId: 'h-old', secret: 's-old' };
  const NEW = { uid: 'u', hostId: 'h-new', secret: 's-new' };

  /** 메모리 보관소 + 가짜 로그인(해제됐거나 네트워크가 끊긴 자격을 고른다)·브라우저 연결 */
  function setup(opts: { saved?: HostCredential; gone?: string[]; offline?: boolean; revokeFails?: boolean } = {}) {
    let saved = opts.saved;
    const store: CredentialStore = {
      load: async () => saved,
      save: async (c) => void (saved = c),
      clear: async () => void (saved = undefined),
    };
    const revoked: string[] = [];
    let paired = 0;
    const signIn = async (c: HostCredential) => {
      if (opts.offline) throw new Error('network-request-failed');
      if (opts.gone?.includes(c.hostId)) throw new HostDisconnectedError('해제됨');
      return {
        host: { name: `PC ${c.hostId}` },
        disconnect: async () => {
          if (opts.revokeFails) throw new Error('unavailable');
          revoked.push(c.hostId);
        },
      };
    };
    const pair = async () => (paired++, NEW);
    return { store, signIn, pair, revoked, paired: () => paired, saved: () => saved };
  }

  it('자격이 없으면 브라우저로 연결해 저장한다', async () => {
    const t = setup();
    const r = await connectHost(t);
    expect(r.status).toBe('connected');
    expect(t.saved()).toEqual(NEW);
  });

  it('이미 연결돼 있으면 새로 연결하지 않는다', async () => {
    const t = setup({ saved: OLD });
    const r = await connectHost(t);
    expect(r).toMatchObject({ status: 'already', session: { host: { name: 'PC h-old' } } });
    expect(t.paired()).toBe(0);
    expect(t.saved()).toEqual(OLD);
  });

  it('웹에서 해제된 자격이면 지우고 새로 연결한다', async () => {
    const t = setup({ saved: OLD, gone: ['h-old'] });
    const r = await connectHost(t);
    expect(r).toMatchObject({ status: 'connected' });
    expect(r.status === 'connected' && r.replaced).toBeFalsy();
    expect(t.saved()).toEqual(NEW);
  });

  it('연결 상태를 확인하지 못하면 새로 연결하지 않고 실패한다', async () => {
    const t = setup({ saved: OLD, offline: true });
    await expect(connectHost(t)).rejects.toThrow('연결 상태를 확인하지 못했습니다');
    expect(t.paired()).toBe(0);
    expect(t.saved()).toEqual(OLD);
  });

  it('--force면 새로 연결해 저장한 뒤 예전 연결을 해제한다', async () => {
    const t = setup({ saved: OLD });
    const r = await connectHost({ ...t, force: true });
    expect(r).toMatchObject({ status: 'connected', replaced: { name: 'PC h-old', revoked: true } });
    expect(t.revoked).toEqual(['h-old']);
    expect(t.saved()).toEqual(NEW);
  });

  it('--force에서 브라우저 연결이 실패하면 예전 연결을 그대로 둔다', async () => {
    const t = setup({ saved: OLD });
    const pair = () => Promise.reject(new Error('연결 시간이 지났습니다'));
    await expect(connectHost({ ...t, pair, force: true })).rejects.toThrow('연결 시간이 지났습니다');
    expect(t.revoked).toEqual([]);
    expect(t.saved()).toEqual(OLD);
  });

  it('예전 연결을 해제하지 못해도 새 연결은 유지한다', async () => {
    const t = setup({ saved: OLD, revokeFails: true });
    const r = await connectHost({ ...t, force: true });
    expect(r).toMatchObject({ status: 'connected', replaced: { revoked: false } });
    expect(t.saved()).toEqual(NEW);
  });
});
