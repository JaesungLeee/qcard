import { DELETE_GRACE_DAYS, INVITE_TTL_DAYS, type Invitation, type Member, type Project, type Role } from './domain';

/*
 * 프로젝트·멤버·초대 규칙. 메모리 구현과 Cloud Functions가 같은 함수를 쓴다.
 * 함수는 상태를 바꾸지 않고, 규칙을 검사한 뒤 저장할 값을 돌려준다. 저장은 호출하는 쪽(트랜잭션)이 한다.
 */

export type MembershipErrorKind = 'permission' | 'rule' | 'not_found';

/** 규칙 위반. message는 그대로 화면에 보여 준다 */
export class MembershipError extends Error {
  override name = 'MembershipError';
  constructor(
    readonly kind: MembershipErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const permission = (m: string) => new MembershipError('permission', m);
const rule = (m: string) => new MembershipError('rule', m);
const notFound = (m: string) => new MembershipError('not_found', m);

/** 요청한 사람 */
export type Actor = { uid: string; name: string; github: string };

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString();

export function requireMember(members: Member[], uid: string): Member {
  const m = members.find((x) => x.uid === uid);
  if (!m) throw permission('이 프로젝트의 멤버가 아닙니다. 초대를 받아야 볼 수 있습니다.');
  return m;
}

export function requireAdmin(members: Member[], uid: string): Member {
  const m = requireMember(members, uid);
  if (m.role !== 'admin') throw permission('Admin만 할 수 있습니다.');
  return m;
}

/** QA 데이터 쓰기: Admin·QA만. Viewer는 조회만 */
export function requireEditor(members: Member[], uid: string): Member {
  const m = requireMember(members, uid);
  if (m.role === 'viewer') throw permission('Viewer는 조회만 할 수 있습니다. Admin·QA에게 요청하세요.');
  return m;
}

const adminCount = (members: Member[]) => members.filter((m) => m.role === 'admin').length;

const PACKAGE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;
const GITHUB_NAME = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;

export type NewProjectInput = { name: string; appName: string; packageName: string; dataNoticeAck: boolean };

/** 이름으로 만든 id 후보. 겹치면 `-2`, `-3`을 붙인다 */
export function projectIdFor(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

/** 프로젝트 생성: 누구나, 만든 사람이 Admin. 데이터 처리 안내 확인 필수 */
export function newProject(input: NewProjectInput, actor: Actor, id: string, now: string) {
  if (!input.dataNoticeAck) throw rule('데이터 처리 안내를 확인해야 프로젝트를 만들 수 있습니다.');
  const name = input.name.trim();
  const appName = input.appName.trim();
  const packageName = input.packageName.trim();
  if (!name || !appName || !packageName) throw rule('프로젝트 이름, 앱 이름, 패키지명을 모두 입력하세요.');
  if (!PACKAGE.test(packageName)) throw rule('패키지명은 com.example.app 형식이어야 합니다.');
  const project: Project = { id, name, appName, packageName, createdBy: actor.name, createdAt: now };
  return { project, member: memberFor(id, actor, 'admin', now) };
}

function memberFor(projectId: string, actor: Actor, role: Role, now: string): Member {
  return {
    projectId,
    uid: actor.uid,
    user: actor.name,
    github: actor.github,
    role,
    joinedAt: now,
    dataNoticeAckAt: now,
  };
}

/** 역할 변경: Admin만, Admin이 0명이 되면 안 된다 */
export function changeRole(members: Member[], actor: Actor, uid: string, role: Role): Member {
  requireAdmin(members, actor.uid);
  const m = members.find((x) => x.uid === uid);
  if (!m) throw notFound('멤버를 찾을 수 없습니다.');
  if (m.role === 'admin' && role !== 'admin' && adminCount(members) === 1) {
    throw rule('프로젝트에는 Admin이 1명 이상 있어야 합니다. 다른 멤버를 먼저 Admin으로 지정하세요.');
  }
  return { ...m, role };
}

/** 내보내기: Admin만, 본인은 탈퇴로 */
export function removal(members: Member[], actor: Actor, uid: string): Member {
  requireAdmin(members, actor.uid);
  if (uid === actor.uid) throw rule('본인은 내보낼 수 없습니다. 탈퇴를 사용하세요.');
  const m = members.find((x) => x.uid === uid);
  if (!m) throw notFound('멤버를 찾을 수 없습니다.');
  if (m.role === 'admin' && adminCount(members) === 1) throw rule('프로젝트에는 Admin이 1명 이상 있어야 합니다.');
  return m;
}

/** 탈퇴: 마지막 Admin은 넘긴 뒤에만, 혼자면 삭제 */
export function leaving(members: Member[], actor: Actor): Member {
  const m = requireMember(members, actor.uid);
  if (members.length === 1) throw rule('혼자 남은 멤버는 탈퇴할 수 없습니다. 프로젝트를 삭제하세요.');
  if (m.role === 'admin' && adminCount(members) === 1) {
    throw rule('마지막 Admin입니다. 다른 멤버를 Admin으로 지정한 뒤 탈퇴하세요.');
  }
  return m;
}

export const isExpired = (inv: Invitation, now: string) => inv.expiresAt < now;

/** 초대 만들기: Admin만. github가 없으면 링크 초대. 7일 뒤 만료 */
export function newInvitation(
  members: Member[],
  invitations: Invitation[],
  actor: Actor,
  input: { role: Role; github?: string },
  ids: { id: string; token: string },
  now: string,
): Invitation {
  const projectId = requireAdmin(members, actor.uid).projectId;
  const gh = input.github?.trim().replace(/^@/, '') || undefined;
  if (gh && !GITHUB_NAME.test(gh)) throw rule('GitHub 사용자명 형식이 아닙니다.');
  if (gh && members.some((m) => m.github.toLowerCase() === gh.toLowerCase())) throw rule(`@${gh}은 이미 멤버입니다.`);
  if (gh && invitations.some((i) => i.github === gh && i.status === 'pending' && !isExpired(i, now))) {
    throw rule(`@${gh}에게 보낸 초대가 이미 대기 중입니다.`);
  }
  return {
    id: ids.id,
    projectId,
    role: input.role,
    invitedBy: actor.name,
    ...(gh ? { github: gh } : {}),
    token: ids.token,
    createdAt: now,
    expiresAt: addDays(now, INVITE_TTL_DAYS),
    status: 'pending',
  };
}

export type InvitationState = 'pending' | 'expired' | 'revoked' | 'accepted' | 'member' | 'other-user';

/** 초대 링크를 연 사람에게 보여 줄 상태 */
export function invitationState(inv: Invitation, actor: Actor, isMember: boolean, now: string): InvitationState {
  if (inv.status !== 'pending') return inv.status;
  if (isMember) return 'member';
  if (isExpired(inv, now)) return 'expired';
  if (inv.github && inv.github.toLowerCase() !== actor.github.toLowerCase()) return 'other-user';
  return 'pending';
}

/**
 * 초대 수락: 데이터 처리 안내 확인 후 멤버가 된다. 사용자명 초대는 한 번 쓰면 끝,
 * 링크 초대는 만료·취소 전까지 여러 사람이 쓴다.
 */
export function accepting(
  inv: Invitation,
  actor: Actor,
  isMember: boolean,
  dataNoticeAck: boolean,
  now: string,
): { member: Member; invitationStatus: Invitation['status'] } {
  if (inv.status === 'revoked') throw rule('취소된 초대입니다.');
  if (inv.status === 'accepted') throw rule('이미 사용된 초대입니다.');
  if (isExpired(inv, now)) throw rule('만료된 초대입니다. 초대한 사람에게 새 초대를 요청하세요.');
  if (inv.github && inv.github.toLowerCase() !== actor.github.toLowerCase()) {
    throw rule(`@${inv.github}에게 보낸 초대입니다.`);
  }
  if (isMember) throw rule('이미 이 프로젝트의 멤버입니다.');
  if (!dataNoticeAck) throw rule('데이터 처리 안내를 확인해야 참여할 수 있습니다.');
  return {
    member: memberFor(inv.projectId, actor, inv.role, now),
    invitationStatus: inv.github ? 'accepted' : 'pending',
  };
}

/** 삭제: Admin만, 이름을 입력해 확인. 30일 유예 동안 복구할 수 있다 */
export function deletion(project: Project, members: Member[], actor: Actor, confirmName: string, now: string) {
  requireAdmin(members, actor.uid);
  if (confirmName.trim() !== project.name) throw rule('프로젝트 이름이 일치하지 않습니다.');
  return { deletedAt: now, purgeAt: addDays(now, DELETE_GRACE_DAYS) };
}

export function restoration(members: Member[], actor: Actor) {
  requireAdmin(members, actor.uid);
}
