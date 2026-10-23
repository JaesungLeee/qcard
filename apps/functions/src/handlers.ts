import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  accepting,
  changeRole,
  deletion,
  invitationState,
  leaving,
  MembershipError,
  newInvitation,
  newProject,
  projectIdFor,
  removal,
  requireAdmin,
  restoration,
  Role,
  type Actor,
  type HostConnection,
  type HostCredential,
  type Invitation,
  type InvitationState,
  type Member,
  type NewProjectInput,
  type Project,
} from '@qcard/shared';
import { z } from 'zod';

/*
 * 프로젝트·멤버·초대 쓰기 (F-TM-09~13). 클라이언트는 이 문서들을 직접 쓰지 못하고(보안 규칙),
 * callable 함수가 트랜잭션 안에서 @qcard/shared membership 규칙을 검사한 뒤 쓴다.
 *
 * Firestore 구조
 *   users/{uid}                              표시 이름·GitHub 사용자명 (registerProfile만 씀)
 *   projects/{p}                             Project
 *   projects/{p}/members/{uid}               Member
 *   projects/{p}/invitations/{id}            Invitation
 *   invitationTokens/{token}                 { projectId, invitationId } — 토큰으로 초대를 찾는 색인
 *   hostConnections/{hostId}                 HostConnection + secretHash — 호스트 연결 (F-TM-14)
 *   users/{uid}/hosts/{hostId}               호스트 연결 신호 (호스트가 씀, 연결 해제 때 여기서 지움)
 */

/** `host`: 호스트 토큰으로 부른 경우 그 호스트 id (사람이 부르면 없음) */
export type Ctx = { db: Firestore; uid: string; host?: string; now?: () => string };

const nowOf = (ctx: Ctx) => (ctx.now ?? (() => new Date().toISOString()))();
const fail = (kind: MembershipError['kind'], message: string) => new MembershipError(kind, message);

const projectRef = (db: Firestore, p: string) => db.doc(`projects/${p}`);
const membersCol = (db: Firestore, p: string) => db.collection(`projects/${p}/members`);
const invitationsCol = (db: Firestore, p: string) => db.collection(`projects/${p}/invitations`);
const tokenRef = (db: Firestore, token: string) => db.doc(`invitationTokens/${token}`);

async function actorOf(ctx: Ctx, tx?: Transaction): Promise<Actor> {
  const ref = ctx.db.doc(`users/${ctx.uid}`);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const u = snap.data() as { name?: string; github?: string } | undefined;
  if (!u?.github) throw fail('permission', '사용자 프로필이 없습니다. 다시 로그인하세요.');
  return { uid: ctx.uid, name: u.name ?? u.github, github: u.github };
}

async function read<T>(tx: Transaction, ref: DocumentReference, what: string): Promise<T> {
  const snap = await tx.get(ref);
  if (!snap.exists) throw fail('not_found', `${what}을(를) 찾을 수 없습니다.`);
  return snap.data() as T;
}

const membersIn = async (tx: Transaction, db: Firestore, p: string) =>
  (await tx.get(membersCol(db, p))).docs.map((d) => d.data() as Member);

/** 입력 검증 실패는 규칙 위반으로 돌려준다 */
function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw fail('rule', `요청 형식이 잘못되었습니다: ${r.error.issues.map((i) => i.message).join(', ')}`);
  return r.data;
}

const ProjectId = z.object({ projectId: z.string().min(1) });

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

/** 삭제 유예가 지난 프로젝트를 하위 문서·초대 토큰까지 영구 삭제한다 (예약 실행) */
export async function purgeDeletedProjects(db: Firestore, now: string): Promise<string[]> {
  const due = await db.collection('projects').where('purgeAt', '<=', now).get();
  for (const doc of due.docs) {
    const tokens = await db.collection('invitationTokens').where('projectId', '==', doc.id).get();
    await Promise.all(tokens.docs.map((t) => t.ref.delete()));
    await db.recursiveDelete(doc.ref);
  }
  return due.docs.map((d) => d.id);
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

// ------------------------------------------------------------------ 호스트 연결 (F-TM-14)

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
