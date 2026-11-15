import { isIssueTemplateFile } from '@qcard/shared';
import type { SampleRepo } from '@qcard/fixtures/github';
import { GitHubError, signWebhook, verifySignature, type GitHub, type RepoRef } from './github';

/*
 * 메모리 GitHub (테스트·에뮬레이터). 실제 GitHub 없이 연결·발행·상태 변경·웹훅 흐름을 돌린다.
 * 인가 코드는 `users`에 등록한 것만 통하고, 그 사용자가 접근할 수 있는 저장소만 보인다.
 */

export type FakeIssue = {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  state: 'open' | 'closed';
  stateReason?: string;
  comments: string[];
};

export class FakeGitHub implements GitHub {
  readonly repos = new Map<number, Omit<SampleRepo, 'issues'> & { issues: Map<number, FakeIssue> }>();
  /** 인가 코드 → 사용자명과 접근할 수 있는 저장소 id (readOnly: 읽기 권한만 있는 저장소) */
  readonly users = new Map<string, { login: string; repoIds: number[]; readOnly?: number[] }>();
  /** 다음 호출에서 던질 오류 (메서드 이름 → 오류) */
  readonly failNext = new Map<keyof GitHub, Error>();
  readonly webhookSecret = 'fake-webhook-secret';

  constructor(
    repos: SampleRepo[],
    private readonly origin = 'http://localhost:5173',
  ) {
    for (const r of repos) {
      const issues = new Map<number, FakeIssue>(
        (r.issues ?? []).map((i) => [
          i.number,
          { title: i.title, body: '', labels: [], assignees: [], state: i.state, comments: [] },
        ]),
      );
      this.repos.set(r.repoId, { ...r, issues });
    }
  }

  private check(method: keyof GitHub) {
    const e = this.failNext.get(method);
    if (e) {
      this.failNext.delete(method);
      throw e;
    }
  }

  private find(r: RepoRef) {
    const repo = this.repos.get(r.repoId);
    if (!repo || repo.installationId !== r.installationId) throw new GitHubError('not_found', 'GitHub 404: Not Found');
    return repo;
  }

  issue(repoId: number, number: number): FakeIssue {
    const i = this.repos.get(repoId)?.issues.get(number);
    if (!i) throw new Error(`이슈 없음: ${repoId}#${number}`);
    return i;
  }

  /** 에뮬레이터에서는 GitHub에 가지 않고 바로 돌아오는 주소 */
  installUrl(state: string) {
    const first = [...this.repos.values()][0];
    return `${this.origin}/github/callback?code=fake-dev&installation_id=${first?.installationId ?? 0}&state=${encodeURIComponent(state)}`;
  }

  authorizeUrl(state: string) {
    return `${this.origin}/github/callback?code=fake-dev&state=${encodeURIComponent(state)}`;
  }

  async userRepos(code: string, installationId?: number) {
    this.check('userRepos');
    const user = this.users.get(code);
    if (!user) throw new GitHubError('forbidden', 'GitHub 인가를 확인하지 못했습니다: bad_verification_code');
    const repos = user.repoIds
      .map((id) => this.repos.get(id))
      .filter((r) => !!r && (installationId === undefined || r.installationId === installationId))
      .filter((r) => !user.readOnly?.includes(r!.repoId))
      .map((r) => ({
        installationId: r!.installationId,
        repoId: r!.repoId,
        owner: r!.owner,
        name: r!.name,
        private: r!.private,
      }));
    return { login: user.login, repos };
  }

  async repo(r: RepoRef) {
    this.check('repo');
    const repo = this.find(r);
    return { ...r, owner: repo.owner, name: repo.name, private: repo.private, defaultBranch: repo.defaultBranch };
  }

  async templateFiles(r: RepoRef) {
    this.check('templateFiles');
    const repo = this.find(r);
    return Object.entries(repo.files)
      .filter(([path]) => isIssueTemplateFile(path))
      .map(([path, content]) => ({ path, content }));
  }

  async labels(r: RepoRef) {
    this.check('labels');
    return [...this.find(r).labels];
  }

  async assignees(r: RepoRef) {
    this.check('assignees');
    return [...this.find(r).assignees];
  }

  async createIssue(r: RepoRef, issue: { title: string; body: string; labels: string[]; assignees: string[] }) {
    this.check('createIssue');
    const repo = this.find(r);
    const number = Math.max(0, ...repo.issues.keys()) + 1;
    repo.issues.set(number, { ...issue, state: 'open', comments: [] });
    return { number, url: `https://github.com/${repo.owner}/${repo.name}/issues/${number}`, state: 'open' as const };
  }

  async setIssueState(r: RepoRef, number: number, to: 'open' | 'closed', reason?: 'completed') {
    this.check('setIssueState');
    const issue = this.find(r).issues.get(number);
    if (!issue) throw new GitHubError('not_found', 'GitHub 404: Not Found');
    issue.state = to;
    issue.stateReason = to === 'closed' ? (reason ?? 'completed') : 'reopened';
  }

  async comment(r: RepoRef, number: number, body: string) {
    this.check('comment');
    const issue = this.find(r).issues.get(number);
    if (!issue) throw new GitHubError('not_found', 'GitHub 404: Not Found');
    issue.comments.push(body);
  }

  verifyWebhook(raw: Buffer, signature: string | undefined) {
    return verifySignature(this.webhookSecret, raw, signature);
  }

  sign(body: string) {
    return signWebhook(this.webhookSecret, body);
  }
}
