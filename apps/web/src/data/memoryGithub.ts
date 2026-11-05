import { SAMPLE_REPOS, type FixtureDb } from '@qcard/fixtures';
import {
  canPublishIssue,
  issueActionFor,
  issueDraftJobId,
  issueFieldLabel,
  issueSyncs,
  normalizeAssigneeMap,
  parseIssueTemplate,
  pickAssignees,
  pickLabels,
  requireAdmin,
  requireEditor,
  isIssueTemplateFile,
  SEVERITY_LABEL,
  type Actor,
  type Defect,
  type IssueDraftJob,
  type IssueField,
  type IssueTemplate,
  type IssueValues,
  type Member,
  type Project,
} from '@qcard/shared';
import { issueDraftRequest } from '@qcard/data';
import { NotFoundError, RuleError, type CycleRef, type DefectPatch, type QcardApi } from './api';

/*
 * 메모리 구현의 GitHub 이슈 (docs/product/issues.md). 하루콩 가상 저장소(fixtures/github.ts)로
 * 실제 GitHub·호스트 없이 연결·초안·발행·상태 동기화를 시연한다. 규칙은 Functions와 같은 @qcard/shared 함수를 쓴다.
 *   - 연결: GitHub에 가지 않고 `/github/callback`으로 바로 돌아온다
 *   - 초안: 시연 호스트가 켜진 사용자(이재성)만, 잠시 뒤 결함 필드로 채운 초안이 생긴다 (모델 대신 규칙으로 채움)
 */

type Deps = {
  db: FixtureDb;
  project: (id: string) => Project;
  membersOf: (projectId: string) => Member[];
  actor: () => Actor;
  now: () => string;
  /** 시연 호스트가 켜져 있는가 (myHosts와 같은 기준) */
  hostOnline: () => boolean;
  notify: (ref: CycleRef) => void;
  rules: <T>(fn: () => T) => Promise<T>;
};

type GithubApi = Pick<
  QcardApi,
  | 'startRepoConnect'
  | 'listConnectableRepos'
  | 'connectRepo'
  | 'disconnectRepo'
  | 'setAssigneeMap'
  | 'getIssueContext'
  | 'requestIssueDraft'
  | 'getIssueDraft'
  | 'publishIssue'
>;

/** 초안을 만드는 데 걸리는 척하는 시간 */
const DRAFT_DELAY_MS = 1200;

export function memoryGithub(deps: Deps) {
  const { db, project, membersOf, actor, now, rules } = deps;
  const repos = structuredClone(SAMPLE_REPOS);
  const nextNumber = new Map(repos.map((r) => [r.repoId, Math.max(0, ...(r.issues ?? []).map((i) => i.number)) + 1]));
  const connects = new Map<string, { projectId: string; uid: string }>();

  const repoOf = (repoId: number) => {
    const r = repos.find((x) => x.repoId === repoId);
    if (!r) throw new NotFoundError('GitHub에서 저장소를 찾을 수 없습니다.');
    return r;
  };
  const activeRepo = (p: Project) => {
    if (p.deletedAt) throw new RuleError('삭제 예정인 프로젝트에서는 GitHub 이슈를 쓸 수 없습니다.');
    if (!p.repo) throw new RuleError('Admin이 GitHub 저장소를 연결하면 발행할 수 있습니다.');
    if (p.repo.status !== 'active')
      throw new RuleError('GitHub 저장소 연결이 끊겼습니다. Admin이 프로젝트 설정에서 다시 연결해야 합니다.');
    return p.repo;
  };
  const defectIn = (ref: CycleRef, defectId: string) => {
    const list = db.defects[ref.cycleId] ?? [];
    const i = list.findIndex((d) => d.id === defectId);
    if (i < 0) throw new NotFoundError(`결함 없음: ${defectId}`);
    return { list, i, defect: list[i]! };
  };
  const connect = (state: string) => {
    // `demo`: 화면 스냅샷용 (설정에서 시작하지 않고 돌아온 화면을 바로 본다)
    if (state === 'demo' && !connects.has(state)) connects.set(state, { projectId: 'haru', uid: actor().uid });
    const c = connects.get(state);
    if (!c || c.uid !== actor().uid)
      throw new RuleError('저장소 연결 요청이 만료되었습니다. 프로젝트 설정에서 다시 시작하세요.');
    return c;
  };

  /** 시연 호스트의 초안: 결함 필드로 채울 수 있는 칸만 채운다 (나머지는 비운 칸) */
  function sampleDraft(ref: CycleRef, defect: Defect, t: IssueTemplate): IssueDraftJob['result'] {
    const cycle = db.cycles.find((c) => c.id === ref.cycleId);
    const build = db.builds.find((b) => b.id === cycle?.buildId);
    const device = cycle?.targets.find((d) => d.id === defect.deviceId)?.label ?? defect.deviceId;
    const steps = defect.repro.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const env = `- 앱 버전: ${build ? `${build.version} (${build.buildNumber})` : ''}\n- 디바이스 / OS: ${device}\n- QA 사이클: ${cycle?.name ?? ''}`;
    const textFor = (f: IssueField): string | string[] | undefined => {
      const label = issueFieldLabel(f);
      if (f.type === 'dropdown') {
        const hit = f.options.find((o) => o.toLowerCase() === SEVERITY_LABEL[defect.severity].toLowerCase());
        return /심각|severity/i.test(label) && hit ? [hit] : undefined;
      }
      if (f.type === 'checkboxes') return undefined;
      if (/재현|steps|reproduce/i.test(label)) return steps;
      if (/기대/.test(label)) return defect.expected;
      if (/실제/.test(label)) return defect.actual;
      if (/요약|무슨 일|what/i.test(label)) return `${defect.actual} (기대: ${defect.expected})`;
      if (/환경/.test(label)) return env;
      if (/버전|version/i.test(label)) return build ? `${build.version} (${build.buildNumber})` : undefined;
      if (/기기|디바이스|device/i.test(label)) return device;
      if (/심각/.test(label)) return SEVERITY_LABEL[defect.severity];
      if (/케이스/.test(label)) return `- TC ID / 출처 / 요구사항: ${defect.tcId}`;
      return undefined;
    };
    const values: IssueValues = {};
    for (const f of t.fields) {
      const v = textFor(f);
      if (v !== undefined) values[f.id] = v;
    }
    return {
      title: `${t.title}${defect.title}`,
      values,
      empty: t.fields.filter((f) => values[f.id] === undefined).map((f) => f.id),
      tokens: 0,
      costUsd: 0,
    };
  }

  /** 이슈가 연결된 결함의 상태 변경: 동기화 중이면 가짜 이슈 상태도 바꾼다 (setDefectStatus와 같은 규칙) */
  function changeLinkedStatus(ref: CycleRef, defectId: string, patch: DefectPatch): Defect | undefined {
    const { list, i, defect } = defectIn(ref, defectId);
    if (!defect.issue || !patch.status || patch.status === defect.status) return undefined;
    let issue = defect.issue;
    if (issueSyncs(project(ref.projectId), defect)) {
      const action = issueActionFor(patch.status, issue.state, actor().github);
      if (action.state) {
        const { closeReason: _c, ...rest } = issue;
        issue =
          action.state.to === 'closed'
            ? { ...rest, state: 'closed', closeReason: 'completed' }
            : { ...rest, state: 'open' };
      }
    }
    const next: Defect = {
      ...defect,
      ...(patch.severity ? { severity: patch.severity } : {}),
      status: patch.status,
      issue,
      statusLog: [...(defect.statusLog ?? []), { to: patch.status, by: actor().name, via: 'qcard', at: now() }],
    };
    list[i] = next;
    deps.notify(ref);
    return next;
  }

  const api: GithubApi = {
    async startRepoConnect(projectId) {
      return rules(() => {
        requireAdmin(membersOf(projectId), actor().uid);
        const state = `memory-${connects.size + 1}`;
        connects.set(state, { projectId, uid: actor().uid });
        const back = `/github/callback?code=memory&state=${state}`;
        return { installUrl: `${back}&installation_id=${repos[0]!.installationId}`, authorizeUrl: back };
      });
    },
    async listConnectableRepos(input) {
      return rules(() => {
        const c = connect(input.state);
        const list = repos.filter(
          (r) => input.installationId === undefined || r.installationId === input.installationId,
        );
        return {
          projectId: c.projectId,
          projectName: project(c.projectId).name,
          login: actor().github,
          repos: list.map((r) => ({
            installationId: r.installationId,
            repoId: r.repoId,
            owner: r.owner,
            name: r.name,
            private: r.private,
          })),
        };
      });
    },
    async connectRepo({ state, repoId, confirmPublic }) {
      return rules(() => {
        const c = connect(state);
        requireAdmin(membersOf(c.projectId), actor().uid);
        const r = repoOf(repoId);
        if (!r.private && !confirmPublic)
          throw new RuleError('공개 저장소입니다. 이슈는 누구나 볼 수 있다는 것을 확인해야 연결할 수 있습니다.');
        const p = project(c.projectId);
        p.repo = {
          installationId: r.installationId,
          repoId: r.repoId,
          owner: r.owner,
          name: r.name,
          private: r.private,
          status: 'active',
          connectedBy: actor().name,
          connectedAt: now(),
        };
        connects.delete(state);
        return structuredClone(p);
      });
    },
    async disconnectRepo(projectId) {
      return rules(() => {
        requireAdmin(membersOf(projectId), actor().uid);
        delete project(projectId).repo;
      });
    },
    async setAssigneeMap(projectId, map) {
      return rules(() => {
        requireAdmin(membersOf(projectId), actor().uid);
        const normalized = normalizeAssigneeMap(map);
        if (typeof normalized === 'string') throw new RuleError(normalized);
        project(projectId).assigneeMap = normalized;
        return normalized;
      });
    },
    async getIssueContext(projectId) {
      return rules(() => {
        requireEditor(membersOf(projectId), actor().uid);
        const r = repoOf(activeRepo(project(projectId)).repoId);
        return {
          repo: { owner: r.owner, name: r.name, private: r.private, url: `https://github.com/${r.owner}/${r.name}` },
          templates: Object.entries(r.files)
            .filter(([path]) => isIssueTemplateFile(path))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, content]) => parseIssueTemplate(path, content)),
          labels: [...r.labels],
          assignees: [...r.assignees],
        };
      });
    },
    async requestIssueDraft(ref, defectId, template) {
      return rules(() => {
        requireEditor(membersOf(ref.projectId), actor().uid);
        const { defect } = defectIn(ref, defectId);
        const job = issueDraftRequest(ref.projectId, ref, defect, template, actor(), now());
        db.jobs = [job, ...db.jobs.filter((j) => j.id !== job.id)];
        if (deps.hostOnline()) {
          setTimeout(() => {
            const i = db.jobs.findIndex((j) => j.id === job.id && j.createdAt === job.createdAt);
            if (i < 0) return;
            db.jobs[i] = {
              ...job,
              status: 'done',
              host: '이재성의 MacBook Pro',
              finishedAt: now(),
              result: sampleDraft(ref, defect, template),
            };
          }, DRAFT_DELAY_MS);
        }
        return job;
      });
    },
    async getIssueDraft(ref, defectId) {
      return rules(() => {
        const id = issueDraftJobId(ref.cycleId, defectId, actor().uid);
        return db.jobs.find((j): j is IssueDraftJob => j.id === id && j.kind === 'issue_draft');
      });
    },
    async publishIssue(input) {
      return rules(() => {
        requireEditor(membersOf(input.projectId), actor().uid);
        const repo = activeRepo(project(input.projectId));
        const r = repoOf(repo.repoId);
        const { list, i, defect } = defectIn(input, input.defectId);
        if (!canPublishIssue(defect))
          throw new RuleError(`${defect.id}은(는) 이미 이슈 #${defect.issue!.number}로 발행했습니다.`);
        if (!input.title.trim()) throw new RuleError('제목이 비어 있습니다.');
        if (!r.private && !input.confirmPublic)
          throw new RuleError('공개 저장소입니다. 이슈는 누구나 볼 수 있다는 것을 확인해야 발행할 수 있습니다.');
        // 라벨·담당자 거르기는 서버와 같다 (가짜 저장소에는 남기지 않는다)
        pickLabels(input.labels, r.labels);
        pickAssignees(input.assignees, r.assignees);
        const number = nextNumber.get(r.repoId)!;
        nextNumber.set(r.repoId, number + 1);
        const next: Defect = {
          ...defect,
          issue: {
            repoId: r.repoId,
            repo: `${r.owner}/${r.name}`,
            number,
            url: `https://github.com/${r.owner}/${r.name}/issues/${number}`,
            state: 'open',
            link: 'linked',
            publishedBy: actor().name,
            publishedAt: now(),
          },
        };
        list[i] = next;
        deps.notify(input);
        return structuredClone(next);
      });
    },
  };
  return { api, changeLinkedStatus };
}
