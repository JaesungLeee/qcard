import { DEFAULT_ACCOUNT_KIND, RUN_STALE_MS, type AccountSecret, type Member, type Run, type TestAccount } from './domain';
import { MembershipError, requireEditor, type Actor } from './membership';

/*
 * 테스트 계정 풀 규칙. 메모리 구현과 Cloud Functions가 같은 함수를 쓴다.
 * membership과 같이 상태를 바꾸지 않고 규칙을 검사한 뒤 저장할 값을 돌려준다.
 * 비밀값(비밀번호·TOTP 시드)은 여기서 평문으로 다루고, 암호화·저장은 호출하는 쪽이 한다.
 */

const rule = (m: string) => new MembershipError('rule', m);
const notFound = (m: string) => new MembershipError('not_found', m);

export type AccountInput = { kind?: string; loginId: string; note?: string; password: string; totp?: string };
/** 비어 있는 필드는 그대로 둔다. `totp: null`은 TOTP 시드를 지운다 */
export type AccountPatch = { kind?: string; loginId?: string; note?: string; password?: string; totp?: string | null };
/** 비밀값 바꾸기: 없는 필드는 그대로, `totpSeed: null`은 지운다 */
export type SecretPatch = { password?: string; totpSeed?: string | null };

const BASE32 = /^[A-Z2-7]+=*$/;

/** `otpauth://totp/…?secret=…` 또는 base32 키 → 공백 없는 대문자 base32 */
export function normalizeTotpSeed(raw: string): string {
  let v = raw.trim();
  if (/^otpauth:\/\//i.test(v)) {
    let secret: string | null = null;
    try {
      const url = new URL(v);
      if (url.host.toLowerCase() !== 'totp') throw rule('TOTP(시간 기반) 인증 앱 주소만 쓸 수 있습니다.');
      secret = url.searchParams.get('secret');
    } catch (e) {
      if (e instanceof MembershipError) throw e;
    }
    if (!secret) throw rule('otpauth 주소에 secret이 없습니다.');
    v = secret;
  }
  v = v.replace(/[\s-]/g, '').toUpperCase();
  if (!BASE32.test(v) || v.replace(/=+$/, '').length < 16) throw rule('TOTP 시드는 base32 키(16자 이상)여야 합니다.');
  return v;
}

const kindOf = (raw: string | undefined) => {
  const k = raw?.trim() || DEFAULT_ACCOUNT_KIND;
  if (k.length > 40) throw rule('계정 종류는 40자 이내로 입력하세요.');
  return k;
};

function loginIdOf(raw: string, accounts: TestAccount[], self?: string) {
  const id = raw.trim();
  if (!id) throw rule('로그인 ID를 입력하세요.');
  if (accounts.some((a) => a.id !== self && a.loginId.toLowerCase() === id.toLowerCase())) {
    throw rule(`${id}은(는) 이미 등록된 계정입니다.`);
  }
  return id;
}

const noteOf = (raw: string | undefined) => raw?.trim() || undefined;

/** 계정 등록: Admin·QA만. 비밀번호는 필수 */
export function newAccount(
  members: Member[],
  accounts: TestAccount[],
  actor: Actor,
  input: AccountInput,
  id: string,
  now: string,
): { account: TestAccount; secret: AccountSecret } {
  const projectId = requireEditor(members, actor.uid).projectId;
  const loginId = loginIdOf(input.loginId, accounts);
  if (!input.password) throw rule('비밀번호를 입력하세요.');
  const totpSeed = input.totp?.trim() ? normalizeTotpSeed(input.totp) : undefined;
  const note = noteOf(input.note);
  const account: TestAccount = {
    id,
    projectId,
    kind: kindOf(input.kind),
    loginId,
    usesTotp: !!totpSeed,
    ...(note ? { note } : {}),
    createdAt: now,
    createdBy: actor.name,
    secretUpdated: { by: actor.name, at: now },
  };
  return { account, secret: { password: input.password, ...(totpSeed ? { totpSeed } : {}) } };
}

/**
 * 계정 수정: Admin·QA만. 비밀값을 바꾸면 로그인 실패 표시를 지운다(고친 비밀번호로 다시 배정).
 * 돌려준 `secret`이 있으면 호출하는 쪽이 기존 비밀값에 합쳐 저장한다
 */
export function accountChange(
  members: Member[],
  accounts: TestAccount[],
  actor: Actor,
  account: TestAccount,
  patch: AccountPatch,
  now: string,
): { account: TestAccount; secret?: SecretPatch } {
  requireEditor(members, actor.uid);
  const next: TestAccount = { ...account };
  if (patch.kind !== undefined) next.kind = kindOf(patch.kind);
  if (patch.loginId !== undefined) next.loginId = loginIdOf(patch.loginId, accounts, account.id);
  if (patch.note !== undefined) {
    const note = noteOf(patch.note);
    if (note) next.note = note;
    else delete next.note;
  }
  const secret: SecretPatch = {};
  if (patch.password !== undefined) {
    if (!patch.password) throw rule('비밀번호를 입력하세요.');
    secret.password = patch.password;
  }
  if (patch.totp === null) secret.totpSeed = null;
  else if (patch.totp?.trim()) secret.totpSeed = normalizeTotpSeed(patch.totp);
  if (Object.keys(secret).length === 0) return { account: next };
  if (secret.totpSeed !== undefined) next.usesTotp = secret.totpSeed !== null;
  next.secretUpdated = { by: actor.name, at: now };
  delete next.loginFailed;
  return { account: next, secret };
}

/** 저장된 비밀값에 바꿀 값을 합친다 */
export function mergeSecret(current: AccountSecret, patch: SecretPatch): AccountSecret {
  const password = patch.password ?? current.password;
  const totpSeed = patch.totpSeed === undefined ? current.totpSeed : (patch.totpSeed ?? undefined);
  return { password, ...(totpSeed ? { totpSeed } : {}) };
}

/** 계정 삭제: Admin·QA만. 배정 중이면 안 된다 */
export function accountDeletion(members: Member[], actor: Actor, account: TestAccount, leaseLive: boolean) {
  requireEditor(members, actor.uid);
  if (account.lease && leaseLive) throw rule('실행 중인 Run이 쓰고 있는 계정은 삭제할 수 없습니다.');
}

/** 로그인 실패 표시·격리 해제: Admin·QA만 */
export function flagClearing(members: Member[], actor: Actor, account: TestAccount, flag: 'loginFailed' | 'quarantine') {
  requireEditor(members, actor.uid);
  if (!account[flag]) throw rule(flag === 'quarantine' ? '격리된 계정이 아닙니다.' : '로그인 실패 표시가 없습니다.');
  const next = { ...account };
  delete next[flag];
  return next;
}

/**
 * 배정이 아직 유효한가: 그 Run이 실행 중이거나 일시정지 중이고, 연결 신호가 RUN_STALE_MS 안에 있다.
 * 끝났거나 신호가 끊긴 Run의 배정은 다음 배정 때 풀린다
 */
export function leaseLive(run: Pick<Run, 'status' | 'heartbeatAt'> | undefined, now: string): boolean {
  if (!run || (run.status !== 'running' && run.status !== 'paused') || !run.heartbeatAt) return false;
  return Date.parse(now) - Date.parse(run.heartbeatAt) <= RUN_STALE_MS;
}

/** 끊긴 배정을 푼다. 원복 플로우가 있는 케이스 중에 끊겼으면 상태를 알 수 없어 격리한다 */
export function expiredLease(account: TestAccount, now: string): TestAccount {
  const { lease, ...rest } = account;
  if (!lease?.restoring) return rest;
  return {
    ...rest,
    quarantine: { reason: 'interrupted', at: now, cycleId: lease.cycleId, runId: lease.runId, tcId: lease.tcId },
  };
}

export type ClaimRequest = {
  cycleId: string;
  runId: string;
  tcId: string;
  kind: string;
  /** 이 케이스에 원복 플로우가 있다 */
  restoring: boolean;
  /** 같은 Run이 이미 배정받은 계정을 다음 케이스에도 쓴다 (종류가 같을 때) */
  accountId?: string;
};

/**
 * 케이스 단위 배정. `accounts`는 끊긴 배정을 이미 푼(expiredLease) 상태여야 한다.
 * 빈 계정이 없으면 undefined — 그 케이스는 Blocked("계정 없음")
 */
export function claiming(
  members: Member[],
  accounts: TestAccount[],
  actor: Actor,
  host: string,
  req: ClaimRequest,
  now: string,
): TestAccount | undefined {
  requireEditor(members, actor.uid);
  const lease = {
    cycleId: req.cycleId,
    runId: req.runId,
    tcId: req.tcId,
    uid: actor.uid,
    executor: actor.name,
    hostId: host,
    at: now,
    restoring: req.restoring,
  };
  if (req.accountId) {
    const a = accounts.find((x) => x.id === req.accountId);
    if (!a) throw notFound('테스트 계정을 찾을 수 없습니다.');
    if (a.lease?.runId !== req.runId) throw rule('이 Run이 배정받은 계정이 아닙니다.');
    if (a.kind !== req.kind) throw rule(`이 계정은 ${a.kind} 종류입니다.`);
    return { ...a, lease };
  }
  const kind = req.kind.trim() || DEFAULT_ACCOUNT_KIND;
  const pick = accounts
    .filter((a) => a.kind === kind && !a.lease && !a.loginFailed && !a.quarantine)
    .sort((a, b) => a.loginId.localeCompare(b.loginId))[0];
  return pick && { ...pick, lease };
}

export type ReleaseOutcome =
  | { kind: 'ok' }
  | { kind: 'login_failed'; detail?: string }
  | { kind: 'restore_failed'; detail?: string };

/**
 * 반납: 종류 전환·Run 종료, 로그인 실패 표시, 원복 실패 격리.
 * 이 Run의 배정이 아니면(신호가 끊겨 이미 풀렸으면) 바꿀 것이 없어 undefined
 */
export function releasing(
  account: TestAccount,
  runId: string,
  outcome: ReleaseOutcome,
  now: string,
): TestAccount | undefined {
  const { lease, ...rest } = account;
  if (!lease || lease.runId !== runId) return undefined;
  const at = { at: now, cycleId: lease.cycleId, runId: lease.runId, tcId: lease.tcId };
  const detail = 'detail' in outcome && outcome.detail ? { detail: outcome.detail } : {};
  if (outcome.kind === 'login_failed') return { ...rest, loginFailed: { ...at, ...detail } };
  if (outcome.kind === 'restore_failed') return { ...rest, quarantine: { reason: 'restore_failed', ...at, ...detail } };
  return rest;
}

export type AccountState = 'free' | 'busy' | 'login_failed' | 'quarantined';
export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  free: '사용 가능',
  busy: '사용 중',
  login_failed: '로그인 실패',
  quarantined: '격리',
};

/** 화면 표시용 상태. 격리 > 로그인 실패 > 사용 중 순 */
export function accountState(account: TestAccount, leaseIsLive: boolean): AccountState {
  if (account.quarantine) return 'quarantined';
  if (account.loginFailed) return 'login_failed';
  if (account.lease && leaseIsLive) return 'busy';
  return 'free';
}
