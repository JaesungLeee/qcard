import { randomBytes } from 'node:crypto';
import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import {
  canPublishIssue,
  DefectStatus,
  issueFooter,
  issueLinkId,
  issueSyncs,
  linkedStatusChange,
  MAX_ISSUE_ASSIGNEES,
  normalizeAssigneeMap,
  parseIssueTemplate,
  pickAssignees,
  pickLabels,
  requireAdmin,
  requireEditor,
  statusOnIssueEvent,
  traceUrlOf,
  withIssueFooter,
  type Defect,
  type DefectIssue,
  type DefectStatusChange,
  type IssueCloseReason,
  type IssueContext,
  type IssueEvent,
  type Project,
  type ProjectRepo,
  type TestCycle,
} from '@qcard/shared';
import { z } from 'zod';
import { GitHubError, type GitHub, type RepoInfo } from './github';
import { actorOf, fail, membersIn, nowOf, parse, ProjectId, read, type Ctx } from './handlers';

/*
 * GitHub 이슈 발행·상태 동기화 (docs/product/issues.md). GitHub 호출은 `GitHub` 인터페이스로만 한다.
 *
 * Firestore 구조
 *   projects/{p}.repo · assigneeMap              연결한 저장소·담당자 매핑 (Functions만 씀)
 *   projects/{p}/cycles/{c}/defects/{d}.issue      결함의 이슈 연결 (Functions만 씀)
 *   issueLinks/{repoId}_{number}                   웹훅이 결함을 찾는 색인 (클라이언트 접근 금지)
 *   githubConnects/{state}                         저장소 연결 진행: 요청자·만료, 확인한 저장소 목록 (클라이언트 접근 금지)
 */

export type IssueCtx = Ctx & { gh: GitHub };

/** 저장소 연결 진행 문서가 유효한 시간 */
const CONNECT_TTL_MS = 30 * 60_000;
/** 발행 중 표시가 이보다 오래되면 실패한 것으로 보고 다시 발행을 허용한다 */
const PUBLISH_LOCK_MS = 2 * 60_000;
/** 만든 이슈를 결함에 기록하는 시도 횟수 */
const LINK_ATTEMPTS = 3;

type ConnectDoc = {
  projectId: string;
  uid: string;
  expiresAt: string;
  ticket?: { login: string; repos: RepoInfo[] };
};
export type IssueLinkDoc = { projectId: string; cycleId: string; defectId: string; repoId: number; number: number };

const projectRef = (db: Firestore, p: string) => db.doc(`projects/${p}`);
const defectRef = (db: Firestore, p: string, c: string, d: string) => db.doc(`projects/${p}/cycles/${c}/defects/${d}`);
const connectRef = (db: Firestore, state: string) => db.doc(`githubConnects/${state}`);
const linkRef = (db: Firestore, repoId: number, n: number) => db.doc(`issueLinks/${issueLinkId(repoId, n)}`);

/** GitHub 오류를 화면에 보일 규칙 오류로 */
async function gh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e;
    if (e.kind === 'not_found')
      throw fail('not_found', `GitHub에서 저장소나 이슈를 찾을 수 없습니다. 저장소 연결을 확인하세요. (${e.message})`);
    if (e.kind === 'forbidden') throw fail('permission', `qcard GitHub App에 권한이 없습니다. (${e.message})`);
    throw fail('rule', `GitHub 요청이 실패했습니다. (${e.message})`);
  }
}

const notDeleted = (p: Project) => {
  if (p.deletedAt) throw fail('rule', '삭제 예정인 프로젝트에서는 GitHub 이슈를 쓸 수 없습니다.');
};

function activeRepo(p: Project): ProjectRepo {
  notDeleted(p);
  if (!p.repo) throw fail('rule', 'Admin이 GitHub 저장소를 연결하면 발행할 수 있습니다.');
  if (p.repo.status !== 'active')
    throw fail('rule', 'GitHub 저장소 연결이 끊겼습니다. Admin이 프로젝트 설정에서 다시 연결해야 합니다.');
  return p.repo;
}

/** 저장소가 설치에서 빠졌으면(404) 연결을 끊김으로 표시한다 */
async function markBrokenOn404<T>(ctx: IssueCtx, projectId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'not_found')
      await projectRef(ctx.db, projectId).update({ 'repo.status': 'broken' });
    throw e;
  }
}

// ------------------------------------------------------------------ 저장소 연결

/** [GitHub 저장소 연결]: 연결 진행 문서를 만들고 App 설치 화면·사용자 인가 화면 주소를 준다. Admin만 */
export async function startRepoConnect(ctx: IssueCtx, data: unknown) {
  const { projectId } = parse(ProjectId, data);
  const state = randomBytes(16).toString('hex');
  await ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    requireAdmin(await membersIn(tx, ctx.db, projectId), ctx.uid);
    notDeleted(project);
    const expiresAt = new Date(Date.parse(nowOf(ctx)) + CONNECT_TTL_MS).toISOString();
    tx.set(connectRef(ctx.db, state), { projectId, uid: ctx.uid, expiresAt } satisfies ConnectDoc);
  });
  return { installUrl: ctx.gh.installUrl(state), authorizeUrl: ctx.gh.authorizeUrl(state) };
}

async function connectDoc(ctx: IssueCtx, state: string): Promise<ConnectDoc> {
  const snap = await connectRef(ctx.db, state).get();
  const doc = snap.data() as ConnectDoc | undefined;
  if (!doc || doc.uid !== ctx.uid || doc.expiresAt < nowOf(ctx))
    throw fail('rule', '저장소 연결 요청이 만료되었습니다. 프로젝트 설정에서 다시 시작하세요.');
  return doc;
}

const ListInput = z.object({
  state: z.string().min(1),
  code: z.string().min(1).optional(),
  installationId: z.coerce.number().int().positive().optional(),
});

/**
 * GitHub에서 돌아온 뒤: 인가 코드로 연결하는 사람이 접근할 수 있는 저장소만 고른다. 사용자 토큰은 저장하지 않고,
 * 확인한 저장소 목록만 연결 진행 문서에 남긴다 — 코드는 한 번만 쓸 수 있어서 다시 부르면 남긴 목록을 준다
 */
export async function listConnectableRepos(ctx: IssueCtx, data: unknown) {
  const input = parse(ListInput, data);
  const doc = await connectDoc(ctx, input.state);
  let ticket = doc.ticket;
  if (!ticket) {
    if (!input.code) throw fail('rule', 'GitHub 인가가 필요합니다. 다시 시도하세요.');
    const code = input.code;
    ticket = await gh(() => ctx.gh.userRepos(code, input.installationId));
    await connectRef(ctx.db, input.state).update({ ticket });
  }
  const project = (await projectRef(ctx.db, doc.projectId).get()).data() as Project | undefined;
  if (!project) throw fail('not_found', '프로젝트를 찾을 수 없습니다.');
  return { projectId: doc.projectId, projectName: project.name, login: ticket.login, repos: ticket.repos };
}

const ConnectInput = z.object({
  state: z.string().min(1),
  repoId: z.number().int(),
  confirmPublic: z.boolean().optional(),
});

/** 고른 저장소를 연결한다. 공개 저장소는 확인을 받아야 한다. Admin만 */
export async function connectRepo(ctx: IssueCtx, data: unknown): Promise<Project> {
  const input = parse(ConnectInput, data);
  const doc = await connectDoc(ctx, input.state);
  const repo = doc.ticket?.repos.find((r) => r.repoId === input.repoId);
  if (!repo) throw fail('permission', '이 저장소에 접근할 수 있는지 확인하지 못했습니다. 다시 시작하세요.');
  if (!repo.private && !input.confirmPublic)
    throw fail('rule', '공개 저장소입니다. 이슈는 누구나 볼 수 있다는 것을 확인해야 연결할 수 있습니다.');
  return ctx.db.runTransaction(async (tx) => {
    const ref = projectRef(ctx.db, doc.projectId);
    const project = await read<Project>(tx, ref, '프로젝트');
    const actor = await actorOf(ctx, tx);
    requireAdmin(await membersIn(tx, ctx.db, doc.projectId), ctx.uid);
    notDeleted(project);
    const next: ProjectRepo = {
      installationId: repo.installationId,
      repoId: repo.repoId,
      owner: repo.owner,
      name: repo.name,
      private: repo.private,
      status: 'active',
      connectedBy: actor.name,
      connectedAt: nowOf(ctx),
    };
    tx.update(ref, { repo: next });
    tx.delete(connectRef(ctx.db, input.state));
    return { ...project, repo: next };
  });
}

/** 연결 해제: 발행한 이슈와 결함의 연결은 남고 동기화만 멈춘다. Admin만 */
export async function disconnectRepo(ctx: IssueCtx, data: unknown): Promise<void> {
  const { projectId } = parse(ProjectId, data);
  await ctx.db.runTransaction(async (tx) => {
    await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    requireAdmin(await membersIn(tx, ctx.db, projectId), ctx.uid);
    tx.update(projectRef(ctx.db, projectId), { repo: FieldValue.delete() });
  });
}

const MapInput = ProjectId.extend({ map: z.record(z.string().min(1), z.array(z.string())) });

/** 담당자 매핑 저장 (표 전체를 바꾼다). Admin만 */
export async function setAssigneeMap(ctx: IssueCtx, data: unknown): Promise<Record<string, string[]>> {
  const { projectId, map } = parse(MapInput, data);
  const normalized = normalizeAssigneeMap(map);
  if (typeof normalized === 'string') throw fail('rule', normalized);
  await ctx.db.runTransaction(async (tx) => {
    await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    requireAdmin(await membersIn(tx, ctx.db, projectId), ctx.uid);
    tx.update(projectRef(ctx.db, projectId), { assigneeMap: normalized });
  });
  return normalized;
}

// ------------------------------------------------------------------ 발행

/** 발행 팝업을 열 때: 저장소 템플릿·라벨·지정 가능한 사람·지금 공개 여부. Admin·QA만 */
export async function getIssueContext(ctx: IssueCtx, data: unknown): Promise<IssueContext> {
  const { projectId } = parse(ProjectId, data);
  const { project } = await editorProject(ctx, projectId);
  const repo = activeRepo(project);
  const info = await gh(() => markBrokenOn404(ctx, projectId, () => ctx.gh.repo(repo)));
  const [files, labels, assignees] = await gh(() =>
    Promise.all([ctx.gh.templateFiles(repo, info.defaultBranch), ctx.gh.labels(repo), ctx.gh.assignees(repo)]),
  );
  if (info.private !== repo.private || info.owner !== repo.owner || info.name !== repo.name)
    await projectRef(ctx.db, projectId).update({
      'repo.private': info.private,
      'repo.owner': info.owner,
      'repo.name': info.name,
    });
  return {
    repo: {
      owner: info.owner,
      name: info.name,
      private: info.private,
      url: `https://github.com/${info.owner}/${info.name}`,
    },
    templates: files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => parseIssueTemplate(f.path, f.content)),
    labels,
    assignees,
  };
}

async function editorProject(ctx: IssueCtx, projectId: string) {
  return ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    const member = requireEditor(await membersIn(tx, ctx.db, projectId), ctx.uid);
    return { project, member };
  });
}

const PublishInput = z.object({
  projectId: z.string().min(1),
  cycleId: z.string().min(1),
  defectId: z.string().min(1),
  title: z.string().trim().min(1, '제목이 비어 있습니다.').max(256),
  body: z.string().max(60_000),
  labels: z.array(z.string().min(1)).max(50),
  assignees: z.array(z.string().min(1)).max(MAX_ISSUE_ASSIGNEES),
  /** 공개 저장소 경고를 확인했다 */
  confirmPublic: z.boolean().optional(),
});

/**
 * [발행]: App 설치 토큰으로 이슈를 만들고 결함에 연결한다. 결함 하나에 이슈 하나 — 발행 중 표시를 트랜잭션으로 잡아
 * 두 번 발행하지 않는다. 본문 끝줄은 여기서 붙인다. 저장소에 없는 라벨·지정할 수 없는 사람은 빼고 발행한다. Admin·QA만
 */
export async function publishIssue(ctx: IssueCtx, data: unknown): Promise<Defect> {
  const input = parse(PublishInput, data);
  const now = nowOf(ctx);
  const dRef = defectRef(ctx.db, input.projectId, input.cycleId, input.defectId);
  const cRef = ctx.db.doc(`projects/${input.projectId}/cycles/${input.cycleId}`);
  const { project, cycle, defect, actor } = await ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, input.projectId), '프로젝트');
    const cycle = await read<TestCycle>(tx, cRef, '사이클');
    const defect = await read<Defect>(tx, dRef, '결함');
    const actor = await actorOf(ctx, tx);
    requireEditor(await membersIn(tx, ctx.db, input.projectId), ctx.uid);
    activeRepo(project);
    if (!canPublishIssue(defect))
      throw fail('rule', `${defect.id}은(는) 이미 이슈 #${defect.issue!.number}로 발행했습니다.`);
    if (defect.publishing && Date.parse(now) - Date.parse(defect.publishing.at) < PUBLISH_LOCK_MS)
      throw fail('rule', `${defect.publishing.by}님이 이 결함을 발행하고 있습니다.`);
    tx.update(dRef, { publishing: { by: actor.name, at: now } });
    return { project, cycle, defect, actor };
  });
  const repo = project.repo!;
  let created: DefectIssue | undefined;
  try {
    const info = await gh(() => markBrokenOn404(ctx, input.projectId, () => ctx.gh.repo(repo)));
    if (!info.private && !input.confirmPublic)
      throw fail('rule', '공개 저장소입니다. 이슈는 누구나 볼 수 있다는 것을 확인해야 발행할 수 있습니다.');
    const [repoLabels, assignable] = await gh(() => Promise.all([ctx.gh.labels(repo), ctx.gh.assignees(repo)]));
    const footer = issueFooter({
      defectId: defect.id,
      cycleName: cycle.name,
      traceUrl: traceUrlOf({
        projectId: input.projectId,
        cycleId: input.cycleId,
        tcId: defect.tcId,
        deviceId: defect.deviceId,
      }),
      requester: actor.github,
    });
    const made = await gh(() =>
      ctx.gh.createIssue(repo, {
        title: input.title.trim(),
        body: withIssueFooter(input.body, footer),
        labels: pickLabels(input.labels, repoLabels).ok,
        assignees: pickAssignees(input.assignees, assignable).ok,
      }),
    );
    const issue: DefectIssue = {
      repoId: repo.repoId,
      repo: `${info.owner}/${info.name}`,
      number: made.number,
      url: made.url,
      state: made.state,
      link: 'linked',
      publishedBy: actor.name,
      publishedAt: now,
    };
    created = issue;
    await linkIssue(ctx.db, dRef, issue, {
      projectId: input.projectId,
      cycleId: input.cycleId,
      defectId: defect.id,
      repoId: repo.repoId,
      number: issue.number,
    });
    const { publishing: _p, ...rest } = defect;
    return { ...rest, issue };
  } catch (e) {
    // 이슈를 만든 뒤에는 발행 중 표시를 풀지 않는다 — 풀면 다시 발행해 이슈가 둘 생긴다
    if (!created) await dRef.update({ publishing: FieldValue.delete() }).catch(() => undefined);
    throw e;
  }
}

/** 만든 이슈를 결함에 연결하고 웹훅 색인을 남긴다. 일시적인 Firestore 오류는 몇 번 다시 시도한다 */
async function linkIssue(
  db: Firestore,
  dRef: DocumentReference,
  issue: DefectIssue,
  link: IssueLinkDoc,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const batch = db.batch();
      batch.update(dRef, { issue, publishing: FieldValue.delete() });
      batch.set(linkRef(db, link.repoId, link.number), link);
      await batch.commit();
      return;
    } catch (e) {
      if (attempt >= LINK_ATTEMPTS) {
        console.error(`이슈 연결 기록 실패: ${issue.repo}#${issue.number}`, e);
        throw fail(
          'rule',
          `이슈 #${issue.number}을(를) 만들었지만 결함에 연결하지 못했습니다. 다시 발행하지 말고 ${issue.url}을 확인하세요.`,
        );
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

// ------------------------------------------------------------------ 상태

const StatusInput = z.object({
  projectId: z.string().min(1),
  cycleId: z.string().min(1),
  defectId: z.string().min(1),
  status: DefectStatus,
});

/**
 * 이슈가 연결된 결함의 상태 변경 (보안 규칙상 클라이언트가 직접 바꾸지 못한다). 동기화 중이면 이슈에 먼저 반영하고,
 * GitHub 호출이 실패하면 상태를 바꾸지 않는다. 연결이 해제·끊김이거나 이슈가 삭제·이전됐으면 qcard만 바꾼다. Admin·QA만
 */
export async function setDefectStatus(ctx: IssueCtx, data: unknown): Promise<Defect> {
  const input = parse(StatusInput, data);
  const dRef = defectRef(ctx.db, input.projectId, input.cycleId, input.defectId);
  const { project, defect, actor } = await ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, input.projectId), '프로젝트');
    const defect = await read<Defect>(tx, dRef, '결함');
    const actor = await actorOf(ctx, tx);
    requireEditor(await membersIn(tx, ctx.db, input.projectId), ctx.uid);
    return { project, defect, actor };
  });
  if (defect.status === input.status) return defect;
  const patch: Record<string, unknown> = { status: input.status };
  if (defect.issue) {
    const { action, issue, change } = linkedStatusChange({
      project,
      defect: { ...defect, issue: defect.issue },
      to: input.status,
      by: actor,
      at: nowOf(ctx),
    });
    if (action) {
      const repo = project.repo!;
      const number = defect.issue.number;
      if (action.state) {
        const { to, reason } = action.state;
        await gh(() => ctx.gh.setIssueState(repo, number, to, reason));
      }
      // 이슈 상태를 이미 바꿨으면 코멘트 실패로 되돌리지 않는다 (qcard도 같은 상태로 맞춘다)
      await gh(() => ctx.gh.comment(repo, number, action.comment)).catch((e: unknown) => {
        if (!action.state) throw e;
        console.warn(`이슈 코멘트 실패 (상태는 반영함): ${repo.repoId}#${number}`, e);
      });
    }
    patch.statusLog = FieldValue.arrayUnion(change);
    if (issue.state !== defect.issue.state) {
      patch['issue.state'] = issue.state;
      patch['issue.closeReason'] = issue.closeReason ?? FieldValue.delete();
    }
  }
  await dRef.update(patch);
  return (await dRef.get()).data() as Defect;
}

// ------------------------------------------------------------------ 웹훅

type Payload = {
  action?: string;
  installation?: { id: number };
  repository?: { id: number; private?: boolean; name?: string; owner?: { login: string } };
  issue?: { number: number; state_reason?: string | null; html_url?: string };
  sender?: { login: string };
  changes?: { new_issue?: { html_url: string } };
  repositories_removed?: { id: number }[];
};

/**
 * App 웹훅 (서명은 index.ts에서 확인한다). 처리한 내용을 한 줄로 돌려준다 (로그용).
 *   issues closed·reopened → 결함 상태 (statusOnIssueEvent), deleted·transferred → 연결 표시
 *   installation deleted·suspend, installation_repositories removed → 저장소 연결 끊김
 *   repository privatized·publicized → 공개 여부
 */
export async function handleWebhook(
  db: Firestore,
  event: string,
  payload: unknown,
  now: string,
  botLogin: string,
): Promise<string> {
  const p = payload as Payload;
  if (event === 'issues' && p.repository && p.issue) {
    // qcard가 바꾼 이슈 상태의 메아리: setDefectStatus가 결함에 이미 반영했다. 받아들이면 결함을 쓰기 전에 도착한
    // closed 이벤트가 open 결함을 fixed로 바꾸는 등 상태 기록이 꼬인다
    if (p.sender?.login === botLogin) return `${p.repository.id}#${p.issue.number} ${p.action}: qcard가 한 변경`;
    return issueEvent(db, p, now);
  }
  if (event === 'installation' && p.installation && (p.action === 'deleted' || p.action === 'suspend')) {
    const n = await markBroken(db, p.installation.id, () => true);
    return `installation ${p.action}: 끊김 ${n}`;
  }
  if (event === 'installation_repositories' && p.action === 'removed' && p.installation) {
    const removed = new Set((p.repositories_removed ?? []).map((r) => r.id));
    const n = await markBroken(db, p.installation.id, (r) => removed.has(r.repoId));
    return `repositories removed: 끊김 ${n}`;
  }
  if (event === 'repository' && p.repository && (p.action === 'privatized' || p.action === 'publicized')) {
    const snap = await db.collection('projects').where('repo.repoId', '==', p.repository.id).get();
    await Promise.all(snap.docs.map((d) => d.ref.update({ 'repo.private': p.action === 'privatized' })));
    return `repository ${p.action}: ${snap.size}`;
  }
  return `무시: ${event}.${p.action ?? ''}`;
}

/** 그 설치로 연결한 프로젝트만 읽어 끊김으로 표시한다 */
async function markBroken(
  db: Firestore,
  installationId: number,
  match: (r: ProjectRepo) => boolean,
): Promise<number> {
  const snap = await db.collection('projects').where('repo.installationId', '==', installationId).get();
  const hits = snap.docs.filter((d) => {
    const repo = (d.data() as Project).repo;
    return repo?.status === 'active' && match(repo);
  });
  await Promise.all(hits.map((d) => d.ref.update({ 'repo.status': 'broken' })));
  return hits.length;
}

const CLOSE_REASONS: readonly string[] = ['completed', 'not_planned', 'duplicate'];

async function issueEvent(db: Firestore, p: Payload, now: string): Promise<string> {
  const repoId = p.repository!.id;
  const number = p.issue!.number;
  const tag = `${repoId}#${number} ${p.action}`;
  const linkSnap = await linkRef(db, repoId, number).get();
  const link = linkSnap.data() as IssueLinkDoc | undefined;
  if (!link) return `${tag}: qcard 이슈 아님`;
  const dRef = defectRef(db, link.projectId, link.cycleId, link.defectId);
  return db.runTransaction(async (tx) => {
    const project = (await tx.get(projectRef(db, link.projectId))).data() as Project | undefined;
    const defect = (await tx.get(dRef)).data() as Defect | undefined;
    if (!project || !defect?.issue) return `${tag}: 결함 없음`;
    if (!issueSyncs(project, defect)) return `${tag}: 동기화 안 함`;
    if (p.action === 'deleted') {
      tx.update(dRef, { 'issue.link': 'deleted' });
      tx.delete(linkRef(db, repoId, number));
      return `${tag}: 삭제됨`;
    }
    if (p.action === 'transferred') {
      const url = p.changes?.new_issue?.html_url ?? defect.issue.url;
      tx.update(dRef, { 'issue.link': 'transferred', 'issue.url': url });
      tx.delete(linkRef(db, repoId, number));
      return `${tag}: 옮겨짐`;
    }
    let e: IssueEvent;
    if (p.action === 'reopened') e = { kind: 'reopened' };
    else if (p.action === 'closed') {
      const reason = (
        CLOSE_REASONS.includes(p.issue!.state_reason ?? '') ? p.issue!.state_reason : 'completed'
      ) as IssueCloseReason;
      e = { kind: 'closed', reason };
    } else return `${tag}: 무시`;
    const next = statusOnIssueEvent(defect.status, e);
    const patch: Record<string, unknown> = {
      'issue.state': e.kind === 'closed' ? 'closed' : 'open',
      'issue.closeReason': e.kind === 'closed' ? e.reason : FieldValue.delete(),
    };
    if (next) {
      patch.status = next;
      patch.statusLog = FieldValue.arrayUnion({
        to: next,
        by: p.sender?.login ?? 'GitHub',
        via: 'github',
        at: now,
      } satisfies DefectStatusChange);
    }
    tx.update(dRef, patch);
    return `${tag}: ${defect.status} → ${next ?? '그대로'}`;
  });
}
