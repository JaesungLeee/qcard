import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubApp } from '../src/github';

/*
 * 실제 GitHub 클라이언트(githubApp)의 요청 모양. fetch를 대역으로 바꿔 GitHub에 가지 않는다.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cfg = {
  appId: '1',
  slug: 'qcard-bot',
  clientId: 'cid',
  clientSecret: 'secret',
  webhookSecret: 'hook',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

/** 경로(쿼리 제외) → 응답 본문. 부른 주소를 남긴다 */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const path = url.replace(/^https:\/\/(api\.)?github\.com/, '').split('?')[0]!;
    if (!(path in routes)) return new Response('{"message":"Not Found"}', { status: 404 });
    const body = routes[path];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const repo = (id: number, name: string, permissions?: Record<string, boolean>) => ({
  id,
  name,
  private: true,
  owner: { login: 'org' },
  default_branch: 'main',
  ...(permissions ? { permissions } : {}),
});

describe('githubApp', () => {
  it('연결 목록에는 인가한 사람이 triage 이상인 저장소만 넣는다', async () => {
    const { fn } = fakeFetch({
      '/login/oauth/access_token': { access_token: 'user-token' },
      '/user': { login: 'reader' },
      '/user/installations/7/repositories': {
        repositories: [
          repo(1, 'read-only', { pull: true }),
          repo(2, 'triage', { pull: true, triage: true }),
          repo(3, 'writer', { pull: true, triage: true, push: true }),
          repo(4, 'no-permissions-field'),
        ],
      },
    });
    const out = await githubApp(cfg, fn).userRepos('code', 7);
    expect(out.repos.map((r) => r.name)).toEqual(['triage', 'writer']);
  });

  it('템플릿 파일 이름은 경로 조각마다 인코딩해서 읽는다', async () => {
    const { fn, calls } = fakeFetch({
      '/app/installations/7/access_tokens': { token: 'install-token' },
      '/repositories/1/contents/.github/ISSUE_TEMPLATE': [{ type: 'file', path: '.github/ISSUE_TEMPLATE/bug #1.md' }],
      '/repositories/1/contents/.github/ISSUE_TEMPLATE/bug%20%231.md': '---\nname: 버그\n---\n본문',
    });
    const files = await githubApp(cfg, fn).templateFiles({ installationId: 7, repoId: 1 }, 'main');
    expect(files).toEqual([{ path: '.github/ISSUE_TEMPLATE/bug #1.md', content: '---\nname: 버그\n---\n본문' }]);
    expect(calls.at(-1)).toContain('/contents/.github/ISSUE_TEMPLATE/bug%20%231.md?ref=main');
  });
});
