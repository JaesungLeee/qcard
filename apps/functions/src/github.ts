import { createHmac, createSign, timingSafeEqual } from 'node:crypto';
import { isIssueTemplateFile, ISSUE_TEMPLATE_DIR } from '@qcard/shared';

/*
 * GitHub 호출 (docs/product/issues.md, docs/security.md#github-이슈). Functions만 GitHub를 부른다.
 * 저장소 일은 qcard GitHub App 설치 토큰으로, 저장소 연결 확인만 그 자리에서 받은 사용자 인가로 한다.
 * 설치 토큰·사용자 토큰은 호출할 때마다 받아 쓰고 저장하지 않는다.
 * 테스트·에뮬레이터는 `FakeGitHub`(githubFake.ts)을 쓴다.
 */

export type RepoRef = { installationId: number; repoId: number };
export type RepoInfo = RepoRef & { owner: string; name: string; private: boolean };
export type IssueState = { number: number; url: string; state: 'open' | 'closed' };

export interface GitHub {
  /** App 설치 화면. 설치를 마치면 `state`와 함께 qcard로 돌아온다 */
  installUrl(state: string): string;
  /** 이미 설치한 사람이 저장소만 고를 때: 사용자 인가 화면 */
  authorizeUrl(state: string): string;
  /**
   * 돌아올 때 받은 인가 코드로, 그 사람이 접근할 수 있는 이 App 설치의 저장소. 설치 ID가 없으면 그 사람이 볼 수 있는 모든 설치.
   * 사용자 토큰은 여기서만 쓰고 버린다
   */
  userRepos(code: string, installationId?: number): Promise<{ login: string; repos: RepoInfo[] }>;
  /** 저장소 정보 (이름이 바뀌었을 수 있다). 설치에서 빠졌으면 `GitHubError('not_found')` */
  repo(r: RepoRef): Promise<RepoInfo & { defaultBranch: string }>;
  /** 기본 브랜치의 `.github/ISSUE_TEMPLATE/` 템플릿 파일 */
  templateFiles(r: RepoRef, ref: string): Promise<{ path: string; content: string }[]>;
  labels(r: RepoRef): Promise<string[]>;
  /** 지정 가능한 사람 (assignable users) */
  assignees(r: RepoRef): Promise<string[]>;
  createIssue(
    r: RepoRef,
    issue: { title: string; body: string; labels: string[]; assignees: string[] },
  ): Promise<IssueState>;
  setIssueState(r: RepoRef, number: number, to: 'open' | 'closed', reason?: 'completed'): Promise<void>;
  comment(r: RepoRef, number: number, body: string): Promise<void>;
  /** 웹훅 `X-Hub-Signature-256` 확인 */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
}

export class GitHubError extends Error {
  override name = 'GitHubError';
  constructor(
    readonly kind: 'not_found' | 'forbidden' | 'invalid' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

/** App 등록값. 비밀값(비밀 키·클라이언트 비밀값·웹훅 비밀값)은 Secret Manager에서 받는다 (docs/dev/deploy.md) */
export type GitHubAppConfig = {
  appId: string;
  slug: string;
  clientId: string;
  privateKey: string;
  clientSecret: string;
  webhookSecret: string;
};

const API = 'https://api.github.com';
const MAX_PAGES = 5;
const MAX_TEMPLATES = 30;

export function signWebhook(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifySignature(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const want = Buffer.from(signWebhook(secret, body));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** App JWT (RS256, 10분 미만). 설치 토큰을 받을 때만 쓴다 */
function appJwt(cfg: GitHubAppConfig, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: cfg.appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(cfg.privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

type Fetch = typeof fetch;

export function githubApp(cfg: GitHubAppConfig, fetchFn: Fetch = fetch): GitHub {
  async function call<T>(path: string, token: string, init: { method?: string; body?: unknown; raw?: boolean } = {}) {
    const res = await fetchFn(path.startsWith('https://') ? path : `${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qcard',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const msg = (() => {
        try {
          return (JSON.parse(text) as { message?: string }).message ?? text;
        } catch {
          return text;
        }
      })();
      const kind =
        res.status === 404 || res.status === 410
          ? 'not_found'
          : res.status === 401 || res.status === 403
            ? 'forbidden'
            : res.status === 422
              ? 'invalid'
              : 'failed';
      throw new GitHubError(kind, `GitHub ${res.status}: ${msg.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (init.raw ? await res.text() : await res.json()) as T;
  }

  async function installToken(installationId: number): Promise<string> {
    const jwt = appJwt(cfg, Math.floor(Date.now() / 1000));
    const r = await call<{ token: string }>(`/app/installations/${installationId}/access_tokens`, jwt, {
      method: 'POST',
    });
    return r.token;
  }

  async function pages<T>(path: string, token: string, pick: (page: unknown) => T[]): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = pick(
        await call<unknown>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token),
      );
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  type ApiRepo = { id: number; name: string; private: boolean; owner: { login: string }; default_branch: string };
  const repoPath = (r: RepoRef) => `/repositories/${r.repoId}`;

  return {
    installUrl: (state) => `https://github.com/apps/${cfg.slug}/installations/new?state=${encodeURIComponent(state)}`,
    authorizeUrl: (state) =>
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(cfg.clientId)}&state=${encodeURIComponent(state)}`,

    async userRepos(code, installationId) {
      const res = await fetchFn('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'qcard' },
        body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
      });
      const auth = (await res.json()) as { access_token?: string; error_description?: string };
      if (!auth.access_token)
        throw new GitHubError(
          'forbidden',
          `GitHub 인가를 확인하지 못했습니다: ${auth.error_description ?? res.status}`,
        );
      const token = auth.access_token;
      const { login } = await call<{ login: string }>('/user', token);
      const ids =
        installationId !== undefined
          ? [installationId]
          : await pages('/user/installations', token, (p) =>
              (p as { installations: { id: number }[] }).installations.map((i) => i.id),
            );
      const repos: RepoInfo[] = [];
      for (const id of ids) {
        const list = await pages(
          `/user/installations/${id}/repositories`,
          token,
          (p) => (p as { repositories: ApiRepo[] }).repositories,
        );
        repos.push(
          ...list.map((r) => ({
            installationId: id,
            repoId: r.id,
            owner: r.owner.login,
            name: r.name,
            private: r.private,
          })),
        );
      }
      return { login, repos };
    },

    async repo(r) {
      const a = await call<ApiRepo>(repoPath(r), await installToken(r.installationId));
      return { ...r, owner: a.owner.login, name: a.name, private: a.private, defaultBranch: a.default_branch };
    },

    async templateFiles(r, ref) {
      const token = await installToken(r.installationId);
      const dir = `${repoPath(r)}/contents/${ISSUE_TEMPLATE_DIR.replace(/\/$/, '')}?ref=${encodeURIComponent(ref)}`;
      const list = await call<{ type: string; path: string }[]>(dir, token).catch((e: unknown) => {
        if (e instanceof GitHubError && e.kind === 'not_found') return [];
        throw e;
      });
      if (!Array.isArray(list)) return [];
      const files = list.filter((f) => f.type === 'file' && isIssueTemplateFile(f.path)).slice(0, MAX_TEMPLATES);
      return Promise.all(
        files.map(async (f) => ({
          path: f.path,
          content: await call<string>(`${repoPath(r)}/contents/${f.path}?ref=${encodeURIComponent(ref)}`, token, {
            raw: true,
          }),
        })),
      );
    },

    async labels(r) {
      const token = await installToken(r.installationId);
      return pages(`${repoPath(r)}/labels`, token, (p) => (p as { name: string }[]).map((l) => l.name));
    },

    async assignees(r) {
      const token = await installToken(r.installationId);
      return pages(`${repoPath(r)}/assignees`, token, (p) => (p as { login: string }[]).map((u) => u.login));
    },

    async createIssue(r, issue) {
      const a = await call<{ number: number; html_url: string; state: 'open' | 'closed' }>(
        `${repoPath(r)}/issues`,
        await installToken(r.installationId),
        { method: 'POST', body: issue },
      );
      return { number: a.number, url: a.html_url, state: a.state };
    },

    async setIssueState(r, number, to, reason) {
      await call(`${repoPath(r)}/issues/${number}`, await installToken(r.installationId), {
        method: 'PATCH',
        body: { state: to, ...(reason ? { state_reason: reason } : {}) },
      });
    },

    async comment(r, number, body) {
      await call(`${repoPath(r)}/issues/${number}/comments`, await installToken(r.installationId), {
        method: 'POST',
        body: { body },
      });
    },

    verifyWebhook: (raw, sig) => verifySignature(cfg.webhookSecret, raw, sig),
  };
}
