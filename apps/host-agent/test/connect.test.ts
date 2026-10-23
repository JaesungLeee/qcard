import { request } from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileStore, pairInBrowser, targetFromEnv } from '../src/connect';

/*
 * 호스트 연결 (F-TM-14): 웹의 연결 화면이 127.0.0.1의 임시 서버로 호스트 자격을 POST한다.
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

  it('설정이 없으면 개발용 에뮬레이터, 있으면 그 프로젝트와 웹 주소', () => {
    expect(targetFromEnv({})).toMatchObject({ emulator: true, webUrl: 'http://localhost:5173' });
    const real = targetFromEnv({
      QCARD_FIREBASE_CONFIG: JSON.stringify({ projectId: 'qcard-prod', apiKey: 'k' }),
      QCARD_WEB_URL: 'https://qcard.example',
    });
    expect(real).toMatchObject({ emulator: false, webUrl: 'https://qcard.example' });
    expect(() => targetFromEnv({ QCARD_FIREBASE_CONFIG: JSON.stringify({ projectId: 'p', apiKey: 'k' }) })).toThrow(
      'QCARD_WEB_URL',
    );
  });
});
