import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  accepting,
  changeRole,
  cycleDeletion,
  cycleUsesFlows,
  deletion,
  invitationState,
  leaving,
  MembershipError,
  newInvitation,
  newProject,
  prepFlowDeletion,
  prepFlowUses,
  projectIdFor,
  removal,
  requireAdmin,
  restoration,
  Role,
  runLimitsChange,
  type Actor,
  type HostConnection,
  type HostCredential,
  type Invitation,
  type InvitationState,
  type Member,
  type NewProjectInput,
  type Project,
  type QADocument,
  type Run,
  type RunLimits,
  type TestCase,
  type TestCycle,
} from '@qcard/shared';
import { z } from 'zod';
import type { SecretBox } from './secretBox';

/*
 * 프로젝트·멤버·초대 쓰기. 클라이언트는 이 문서들을 직접 쓰지 못하고(보안 규칙),
 * callable 함수가 트랜잭션 안에서 @qcard/shared membership 규칙을 검사한 뒤 쓴다.
 *
 * Firestore 구조
 *   users/{uid}                              표시 이름·GitHub 사용자명 (registerProfile만 씀)
 *   projects/{p}                             Project
 *   projects/{p}/members/{uid}               Member
 *   projects/{p}/invitations/{id}            Invitation
 *   invitationTokens/{token}                 { projectId, invitationId } — 토큰으로 초대를 찾는 색인
 *   hostConnections/{hostId}                 HostConnection + secretHash — 호스트 연결
 *   users/{uid}/hosts/{hostId}               호스트 연결 신호 (호스트가 씀, 연결 해제 때 여기서 지움)
 *   projects/{p}/accounts/{id}               테스트 계정 (accounts.ts)
 *   projects/{p}/accountSecrets/{id}         테스트 계정 비밀값 (암호화, Functions만 읽는다)
 *   projects/{p}/secretAccessLog/{id}        비밀값 전달 기록 (감사 로그)
 *   issueLinks/{id} · githubConnects/{state}  GitHub 이슈 색인·저장소 연결 진행 (issues.ts)
 */

/**
 * `host`: 호스트 토큰으로 부른 경우 그 호스트 id (사람이 부르면 없음).
 * `box`: 테스트 계정 비밀값 암호화 (계정 함수만 쓴다)
 */
export type Ctx = { db: Firestore; uid: string; host?: string; now?: () => string; box?: SecretBox };

export const nowOf = (ctx: Ctx) => (ctx.now ?? (() => new Date().toISOString()))();
export const fail = (kind: MembershipError['kind'], message: string) => new MembershipError(kind, message);

const projectRef = (db: Firestore, p: string) => db.doc(`projects/${p}`);
const membersCol = (db: Firestore, p: string) => db.collection(`projects/${p}/members`);
const invitationsCol = (db: Firestore, p: string) => db.collection(`projects/${p}/invitations`);
const tokenRef = (db: Firestore, token: string) => db.doc(`invitationTokens/${token}`);

export async function actorOf(ctx: Ctx, tx?: Transaction): Promise<Actor> {
  const ref = ctx.db.doc(`users/${ctx.uid}`);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const u = snap.data() as { name?: string; github?: string } | undefined;
  if (!u?.github) throw fail('permission', '사용자 프로필이 없습니다. 다시 로그인하세요.');
  return { uid: ctx.uid, name: u.name ?? u.github, github: u.github };
}

export async function read<T>(tx: Transaction, ref: DocumentReference, what: string): Promise<T> {
  const snap = await tx.get(ref);
  if (!snap.exists) throw fail('not_found', `${what}을(를) 찾을 수 없습니다.`);
  return snap.data() as T;
}

export const membersIn = async (tx: Transaction, db: Firestore, p: string) =>
  (await tx.get(membersCol(db, p))).docs.map((d) => d.data() as Member);

/** 입력 검증 실패는 규칙 위반으로 돌려준다 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw fail('rule', `요청 형식이 잘못되었습니다: ${r.error.issues.map((i) => i.message).join(', ')}`);
  return r.data;
}

export const ProjectId = z.object({ projectId: z.string().min(1) });

// ------------------------------------------------------------------ 프로필

/**
 * GitHub 사용자명을 확인해 프로필에 쓴다. 초대(사용자명)를 받을 사람이 맞는지 이 값으로 판단하므로
 * 클라이언트가 보낸 이름을 믿지 않고, GitHub 액세스 토큰으로 GitHub API에 물어 본다.
 * 에뮬레이터에서는 테스트 사용자를 위해 보낸 값을 그대로 쓴다.
 */
export async function registerProfile(
  ctx: Ctx,
  data: unknown,
  opts: { emulator: boolean; fetchGithub?: (token: string) => Promise<{ login: string; name: string | null }> },
): Promise<{ name: string; github: string }> {
  const input = parse(
    z.object({
      githubAccessToken: z.string().nullish(),
      github: z.string().nullish(),
      name: z.string().nullish(),
    }),
    data,
  );
  let profile: { name: string; github: string };
  if (opts.emulator && input.github) {
    profile = { github: input.github, name: input.name || input.github };
  } else {
    if (!input.githubAccessToken) throw fail('permission', 'GitHub 로그인이 필요합니다.');
    const u = await (opts.fetchGithub ?? fetchGithubUser)(input.githubAccessToken);
    profile = { github: u.login, name: u.name || u.login };
  }
  await ctx.db.doc(`users/${ctx.uid}`).set({ ...profile, updatedAt: nowOf(ctx) }, { merge: true });
  return profile;
}

async function fetchGithubUser(token: string) {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw fail('permission', `GitHub 사용자를 확인하지 못했습니다 (${res.status}).`);
  return (await res.json()) as { login: string; name: string | null };
}

// ------------------------------------------------------------------ 프로젝트

export async function createProject(ctx: Ctx, data: unknown): Promise<Project> {
  const input = parse(
    z.object({ name: z.string(), appName: z.string(), packageName: z.string(), dataNoticeAck: z.boolean() }),
    data,
  ) satisfies NewProjectInput;
  return ctx.db.runTransaction(async (tx) => {
    const actor = await actorOf(ctx, tx);
    // 이름으로 만든 id가 겹치면 -2, -3 … (트랜잭션 안에서 확인)
    const taken = new Set<string>();
    let id = projectIdFor(input.name, (x) => taken.has(x));
    while ((await tx.get(projectRef(ctx.db, id))).exists) {
      taken.add(id);
      id = projectIdFor(input.name, (x) => taken.has(x));
    }
    const { project, member } = newProject(input, actor, id, nowOf(ctx));
    tx.create(projectRef(ctx.db, id), project);
    tx.create(membersCol(ctx.db, id).doc(actor.uid), member);
    return project;
  });
}

export async function deleteProject(ctx: Ctx, data: unknown): Promise<Project> {
  const { projectId, confirmName } = parse(ProjectId.extend({ confirmName: z.string() }), data);
  return ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    const members = await membersIn(tx, ctx.db, projectId);
    const actor = await actorOf(ctx, tx);
    const patch = deletion(project, members, actor, confirmName, nowOf(ctx));
    tx.update(projectRef(ctx.db, projectId), patch);
    return { ...project, ...patch };
  });
}

export async function restoreProject(ctx: Ctx, data: unknown): Promise<Project> {
  const { projectId } = parse(ProjectId, data);
  return ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    restoration(await membersIn(tx, ctx.db, projectId), await actorOf(ctx, tx));
    tx.update(projectRef(ctx.db, projectId), { deletedAt: FieldValue.delete(), purgeAt: FieldValue.delete() });
    const { deletedAt: _d, purgeAt: _p, ...rest } = project;
    return rest;
  });
}

/** Storage에서 접두어 아래 파일을 모두 지운다 (Functions는 기본 버킷, 테스트는 에뮬레이터) */
export type RemoveFiles = (prefix: string) => Promise<void>;

/**
 * 삭제 유예가 지난 프로젝트를 영구 삭제한다 (예약 실행) — Storage 파일(스펙·빌드·스크린샷), 초대 토큰,
 * 프로젝트 문서와 하위 문서(테스트 계정 비밀값·감사 로그 포함). Storage를 먼저 지워, 중간에 실패해도 `purgeAt`이
 * 남은 프로젝트를 다음 실행이 처음부터 다시 지운다. 한 프로젝트가 실패해도 나머지는 계속한다.
 * 지운 프로젝트 id를 돌려준다
 */
export async function purgeDeletedProjects(db: Firestore, now: string, removeFiles: RemoveFiles): Promise<string[]> {
  const due = await db.collection('projects').where('purgeAt', '<=', now).get();
  const purged: string[] = [];
  for (const doc of due.docs) {
    try {
      // 끝의 '/'가 없으면 `demo-app`이 `demo-app-2`의 파일까지 지운다
      await removeFiles(`projects/${doc.id}/`);
      const tokens = await db.collection('invitationTokens').where('projectId', '==', doc.id).get();
      await Promise.all(tokens.docs.map((t) => t.ref.delete()));
      await removeIssueLinks(db, doc.id);
      await db.recursiveDelete(doc.ref);
      purged.push(doc.id);
    } catch (e) {
      console.error(`프로젝트 영구 삭제 실패, 다음 실행에서 다시 지운다: ${doc.id}`, e);
    }
  }
  return purged;
}

const CycleId = ProjectId.extend({ cycleId: z.string().min(1), confirmName: z.string() });

/**
 * 사이클 삭제: 유예 없이 사이클 문서·하위 문서(케이스 사본·결과·Run·이전 시도·결함·판정 이력)와
 * Storage 증거를 지운다. 빌드·QA 문서는 남는다. 먼저 트랜잭션에서 규칙을 보고 삭제 중 표시를 남겨(새 Run을 막는다)
 * 그 뒤에 지운다 — 중간에 실패하면 표시가 남은 사이클을 다시 삭제해 이어서 지운다
 */
export async function deleteCycle(ctx: Ctx, data: unknown, removeFiles: RemoveFiles): Promise<void> {
  const { projectId, cycleId, confirmName } = parse(CycleId, data);
  const ref = ctx.db.doc(`projects/${projectId}/cycles/${cycleId}`);
  const now = nowOf(ctx);
  await ctx.db.runTransaction(async (tx) => {
    const cycle = await read<TestCycle>(tx, ref, '사이클');
    const runs = (await tx.get(ref.collection('runs'))).docs.map((d) => d.data() as Run);
    const members = await membersIn(tx, ctx.db, projectId);
    cycleDeletion(members, await actorOf(ctx, tx), cycle, runs, confirmName, now);
    if (!cycle.deletingAt) tx.update(ref, { deletingAt: now });
  });
  await removeFiles(`projects/${projectId}/cycles/${cycleId}/`);
  await removeIssueLinks(ctx.db, projectId, cycleId);
  await ctx.db.recursiveDelete(ref);
}

/** 사이클·프로젝트를 지울 때 이슈 색인(`issueLinks`, issues.ts)도 지운다. GitHub 이슈는 지우지 않는다 */
export async function removeIssueLinks(db: Firestore, projectId: string, cycleId?: string): Promise<number> {
  let q = db.collection('issueLinks').where('projectId', '==', projectId);
  if (cycleId) q = q.where('cycleId', '==', cycleId);
  const snap = await q.get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}

const FlowId = ProjectId.extend({ docId: z.string().min(1), flowId: z.string().min(1) });

/**
 * 준비 플로우 삭제: 그 QA 문서 버전의 케이스나 그 버전으로 만든 완료되지 않은 사이클이 참조 중이면 막는다
 * (`prepFlowUses`). 보안 규칙으로는 참조를 질의할 수 없고 클라이언트 트랜잭션은 질의를 못 해서, 여기서 한 트랜잭션 안에
 * 참조를 읽고 지운다
 */
export async function deletePrepFlow(ctx: Ctx, data: unknown): Promise<void> {
  const { projectId, docId, flowId } = parse(FlowId, data);
  const project = projectRef(ctx.db, projectId);
  await ctx.db.runTransaction(async (tx) => {
    const qaDoc = project.collection('qaDocs').doc(docId);
    const ref = qaDoc.collection('prepFlows').doc(flowId);
    await read(tx, ref, '준비 플로우');
    const meta = await read<QADocument>(tx, qaDoc, 'QA 문서');
    const members = await membersIn(tx, ctx.db, projectId);
    const casesOf = async (ref: DocumentReference) =>
      (await tx.get(ref.collection('cases'))).docs.map((d) => d.data() as TestCase);
    const open = (await tx.get(project.collection('cycles').where('docId', '==', docId))).docs.filter((d) =>
      cycleUsesFlows(d.data() as TestCycle),
    );
    const cycles = await Promise.all(
      open.map(async (d) => ({ cycle: d.data() as TestCycle, cases: await casesOf(d.ref) })),
    );
    const doc = { ...meta, id: docId, cases: await casesOf(qaDoc) };
    prepFlowDeletion(members, await actorOf(ctx, tx), prepFlowUses(doc, cycles)[flowId] ?? []);
    tx.delete(ref);
  });
}

/** 실행 안전장치 저장. Admin만 */
export async function setRunLimits(ctx: Ctx, data: unknown): Promise<Project> {
  // 범위 검사는 runLimitsChange가 한다 (화면과 같은 문구로)
  const { projectId, limits } = parse(ProjectId.extend({ limits: z.record(z.string(), z.number()) }), data);
  return ctx.db.runTransaction(async (tx) => {
    const project = await read<Project>(tx, projectRef(ctx.db, projectId), '프로젝트');
    const members = await membersIn(tx, ctx.db, projectId);
    const runLimits = runLimitsChange(members, await actorOf(ctx, tx), limits as RunLimits);
    tx.update(projectRef(ctx.db, projectId), { runLimits });
    return { ...project, runLimits };
  });
}

// ------------------------------------------------------------------ 멤버

export async function setMemberRole(ctx: Ctx, data: unknown): Promise<void> {
  const { projectId, uid, role } = parse(ProjectId.extend({ uid: z.string(), role: Role }), data);
  await ctx.db.runTransaction(async (tx) => {
    const members = await membersIn(tx, ctx.db, projectId);
    const m = changeRole(members, await actorOf(ctx, tx), uid, role);
    tx.update(membersCol(ctx.db, projectId).doc(uid), { role: m.role });
  });
}

export async function removeMember(ctx: Ctx, data: unknown): Promise<void> {
  const { projectId, uid } = parse(ProjectId.extend({ uid: z.string() }), data);
  await ctx.db.runTransaction(async (tx) => {
    const members = await membersIn(tx, ctx.db, projectId);
    const m = removal(members, await actorOf(ctx, tx), uid);
    tx.delete(membersCol(ctx.db, projectId).doc(m.uid));
  });
}

export async function leaveProject(ctx: Ctx, data: unknown): Promise<void> {
  const { projectId } = parse(ProjectId, data);
  await ctx.db.runTransaction(async (tx) => {
    const members = await membersIn(tx, ctx.db, projectId);
    const m = leaving(members, await actorOf(ctx, tx));
    tx.delete(membersCol(ctx.db, projectId).doc(m.uid));
  });
}

// ------------------------------------------------------------------ 초대

export async function createInvitation(ctx: Ctx, data: unknown): Promise<Invitation> {
  // callable은 없는 값(undefined)을 null로 보낸다
  const input = parse(ProjectId.extend({ role: Role, github: z.string().nullish() }), data);
  return ctx.db.runTransaction(async (tx) => {
    const members = await membersIn(tx, ctx.db, input.projectId);
    const invitations = (await tx.get(invitationsCol(ctx.db, input.projectId))).docs.map((d) => d.data() as Invitation);
    const ref = invitationsCol(ctx.db, input.projectId).doc();
    const token = randomBytes(16).toString('base64url');
    const inv = newInvitation(
      members,
      invitations,
      await actorOf(ctx, tx),
      { role: input.role, github: input.github ?? undefined },
      { id: ref.id, token },
      nowOf(ctx),
    );
    tx.create(ref, inv);
    tx.create(tokenRef(ctx.db, token), { projectId: input.projectId, invitationId: ref.id });
    return inv;
  });
}

export async function revokeInvitation(ctx: Ctx, data: unknown): Promise<void> {
  const { projectId, invitationId } = parse(ProjectId.extend({ invitationId: z.string() }), data);
  await ctx.db.runTransaction(async (tx) => {
    const ref = invitationsCol(ctx.db, projectId).doc(invitationId);
    await read<Invitation>(tx, ref, '초대');
    requireAdmin(await membersIn(tx, ctx.db, projectId), ctx.uid);
    tx.update(ref, { status: 'revoked' });
  });
}

async function invitationByToken(tx: Transaction, db: Firestore, token: string) {
  const at = (await tx.get(tokenRef(db, token))).data() as { projectId: string; invitationId: string } | undefined;
  if (!at) throw fail('not_found', '초대를 찾을 수 없습니다. 링크를 다시 확인하세요.');
  const ref = invitationsCol(db, at.projectId).doc(at.invitationId);
  return { ref, inv: await read<Invitation>(tx, ref, '초대') };
}

/** 초대 링크를 연 사람에게 보여 줄 정보. 멤버가 아니어도 볼 수 있게 함수로 읽는다 */
export async function getInvitation(
  ctx: Ctx,
  data: unknown,
): Promise<{ invitation: Invitation; project: Project; state: InvitationState }> {
  const { token } = parse(z.object({ token: z.string().min(1) }), data);
  return ctx.db.runTransaction(async (tx) => {
    const { inv } = await invitationByToken(tx, ctx.db, token);
    const project = await read<Project>(tx, projectRef(ctx.db, inv.projectId), '프로젝트');
    const isMember = (await tx.get(membersCol(ctx.db, inv.projectId).doc(ctx.uid))).exists;
    const state = invitationState(inv, await actorOf(ctx, tx), isMember, nowOf(ctx));
    return { invitation: inv, project, state };
  });
}

export async function acceptInvitation(ctx: Ctx, data: unknown): Promise<Project> {
  const { token, dataNoticeAck } = parse(z.object({ token: z.string().min(1), dataNoticeAck: z.boolean() }), data);
  return ctx.db.runTransaction(async (tx) => {
    const { ref, inv } = await invitationByToken(tx, ctx.db, token);
    const project = await read<Project>(tx, projectRef(ctx.db, inv.projectId), '프로젝트');
    const memberRef = membersCol(ctx.db, inv.projectId).doc(ctx.uid);
    const isMember = (await tx.get(memberRef)).exists;
    const r = accepting(inv, await actorOf(ctx, tx), isMember, dataNoticeAck, nowOf(ctx));
    tx.create(memberRef, r.member);
    if (r.invitationStatus !== inv.status) tx.update(ref, { status: r.invitationStatus });
    return project;
  });
}

// ------------------------------------------------------------------ 호스트 연결

const connectionRef = (db: Firestore, hostId: string) => db.doc(`hostConnections/${hostId}`);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * [이 PC 연결]: 로그인한 사용자 이름으로 호스트 자격을 만든다. 비밀값은 응답으로 한 번만 돌려주고
 * (웹이 그 PC의 호스트 에이전트에 넘긴다) 해시만 저장한다. 호스트 토큰으로는 부를 수 없다
 */
export async function pairHost(ctx: Ctx, data: unknown): Promise<HostCredential> {
  if (ctx.host) throw fail('permission', '호스트는 다른 PC를 연결할 수 없습니다.');
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), data);
  await actorOf(ctx);
  const ref = ctx.db.collection('hostConnections').doc();
  const secret = randomBytes(32).toString('base64url');
  const conn: HostConnection = { id: ref.id, uid: ctx.uid, name, connectedAt: nowOf(ctx) };
  await ref.create({ ...conn, secretHash: sha256(secret) });
  return { uid: ctx.uid, hostId: ref.id, secret };
}

/** 연결 해제: 본인 웹 또는 그 호스트 자신. 연결 문서가 없어지면 그 호스트의 요청은 보안 규칙이 바로 막는다 */
export async function revokeHost(ctx: Ctx, data: unknown): Promise<void> {
  const { hostId } = parse(z.object({ hostId: z.string().min(1) }), data);
  if (ctx.host && ctx.host !== hostId) throw fail('permission', '다른 호스트의 연결은 해제할 수 없습니다.');
  const ref = connectionRef(ctx.db, hostId);
  const conn = (await ref.get()).data() as HostConnection | undefined;
  if (!conn || conn.uid !== ctx.uid) throw fail('not_found', '연결된 PC를 찾을 수 없습니다.');
  const batch = ctx.db.batch();
  batch.delete(ref);
  batch.delete(ctx.db.doc(`users/${ctx.uid}/hosts/${hostId}`));
  await batch.commit();
}

/**
 * 호스트 자격 → 짧은 수명의 로그인 토큰(`host` 클레임). 호스트는 켤 때마다 부른다. 로그인 없이 부르는 함수라
 * 자격이 맞지 않으면 이유를 구분하지 않고 거절한다. `mint`는 Admin SDK createCustomToken
 */
export async function hostToken(
  db: Firestore,
  data: unknown,
  mint: (uid: string, claims: { host: string }) => Promise<string>,
  now: () => string = () => new Date().toISOString(),
): Promise<{ token: string }> {
  const { hostId, secret } = parse(z.object({ hostId: z.string().min(1), secret: z.string().min(1) }), data);
  const ref = connectionRef(db, hostId);
  const conn = (await ref.get()).data() as (HostConnection & { secretHash: string }) | undefined;
  const ok = !!conn && timingSafeEqual(Buffer.from(sha256(secret), 'hex'), Buffer.from(conn.secretHash, 'hex'));
  if (!conn || !ok) throw fail('permission', '이 PC의 연결이 해제되었거나 자격이 맞지 않습니다. 다시 연결하세요.');
  await ref.update({ lastTokenAt: now() });
  return { token: await mint(conn.uid, { host: hostId }) };
}
