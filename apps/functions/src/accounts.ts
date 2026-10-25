import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  AccountSecret,
  accountChange,
  accountDeletion,
  claiming,
  expiredLease,
  flagClearing,
  leaseLive,
  mergeSecret,
  newAccount,
  releasing,
  type Run,
  type TestAccount,
} from '@qcard/shared';
import { z } from 'zod';
import { actorOf, fail, membersIn, nowOf, parse, ProjectId, read, type Ctx } from './handlers';
import type { SecretBox } from './secretBox';

/*
 * 테스트 계정 풀 (F-PF-04·08·09, F-EX-09). 규칙은 @qcard/shared accounts — 메모리 구현도 같은 함수를 쓴다.
 * 계정 문서는 멤버가 읽고, 비밀값은 암호화해 따로 두며 클라이언트는 읽지 못한다(보안 규칙).
 * 비밀값은 배정(claimAccount) 응답으로만, 그 Run을 실행 중인 실행자의 호스트에 나간다. 나갈 때마다 기록을 남긴다.
 */

const accountsCol = (db: Firestore, p: string) => db.collection(`projects/${p}/accounts`);
const secretRef = (db: Firestore, p: string, id: string) => db.doc(`projects/${p}/accountSecrets/${id}`);
const runRef = (db: Firestore, p: string, c: string, r: string) => db.doc(`projects/${p}/cycles/${c}/runs/${r}`);

function boxOf(ctx: Ctx): SecretBox {
  if (!ctx.box) throw fail('rule', '테스트 계정 비밀값 암호화가 설정되지 않았습니다. 관리자에게 문의하세요.');
  return ctx.box;
}

const sealSecret = (box: SecretBox, s: AccountSecret) => box.seal(JSON.stringify(s));
const openSecret = async (box: SecretBox, tx: Transaction, ref: DocumentReference) => {
  const sealed = (await tx.get(ref)).data()?.sealed as string | undefined;
  if (!sealed) throw fail('not_found', '테스트 계정 비밀값이 없습니다. 비밀번호를 다시 입력하세요.');
  return AccountSecret.parse(JSON.parse(await box.open(sealed)));
};

const accountsIn = async (tx: Transaction, db: Firestore, p: string) =>
  (await tx.get(accountsCol(db, p))).docs.map((d) => d.data() as TestAccount);

/** 계정의 배정이 아직 유효한가 (그 Run의 상태·연결 신호로) */
async function liveLease(tx: Transaction, db: Firestore, a: TestAccount, now: string) {
  if (!a.lease) return false;
  const run = (await tx.get(runRef(db, a.projectId, a.lease.cycleId, a.lease.runId))).data() as Run | undefined;
  return leaseLive(run, now);
}

const AccountId = ProjectId.extend({ accountId: z.string().min(1) });
// callable은 없는 값(undefined)을 null로 보낸다
const opt = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined);

/** 계정 등록 (F-PF-08): Admin·QA */
export async function createAccount(ctx: Ctx, data: unknown): Promise<TestAccount> {
  const input = parse(
    ProjectId.extend({ kind: opt, loginId: z.string(), note: opt, password: z.string(), totp: opt }),
    data,
  );
  const box = boxOf(ctx);
  return ctx.db.runTransaction(async (tx) => {
    const members = await membersIn(tx, ctx.db, input.projectId);
    const accounts = await accountsIn(tx, ctx.db, input.projectId);
    const actor = await actorOf(ctx, tx);
    const ref = accountsCol(ctx.db, input.projectId).doc();
    const { account, secret } = newAccount(members, accounts, actor, input, ref.id, nowOf(ctx));
    tx.create(ref, account);
    tx.create(secretRef(ctx.db, input.projectId, ref.id), { sealed: await sealSecret(box, secret) });
    return account;
  });
}

/** 계정 수정. 비밀값을 바꾸면 저장된 값에 합쳐 다시 봉인한다 */
export async function updateAccount(ctx: Ctx, data: unknown): Promise<TestAccount> {
  const input = parse(
    AccountId.extend({ kind: opt, loginId: opt, note: opt, password: opt, totp: z.string().nullish() }),
    data,
  );
  return ctx.db.runTransaction(async (tx) => {
    const ref = accountsCol(ctx.db, input.projectId).doc(input.accountId);
    const account = await read<TestAccount>(tx, ref, '테스트 계정');
    const members = await membersIn(tx, ctx.db, input.projectId);
    const accounts = await accountsIn(tx, ctx.db, input.projectId);
    const actor = await actorOf(ctx, tx);
    // totp: undefined(그대로) · null(지우기) · 문자열(바꾸기). callable은 undefined를 보내지 않으므로 키로 구분한다
    const totp = data && typeof data === 'object' && 'totp' in data ? input.totp : undefined;
    const r = accountChange(members, accounts, actor, account, { ...input, totp }, nowOf(ctx));
    if (r.secret) {
      const box = boxOf(ctx);
      const sRef = secretRef(ctx.db, input.projectId, input.accountId);
      const merged = mergeSecret(await openSecret(box, tx, sRef), r.secret);
      tx.set(sRef, { sealed: await sealSecret(box, merged) });
    }
    tx.set(ref, r.account);
    return r.account;
  });
}

/** 계정 삭제: 배정 중이면 안 된다. 비밀값도 함께 지운다 */
export async function deleteAccount(ctx: Ctx, data: unknown): Promise<void> {
  const input = parse(AccountId, data);
  await ctx.db.runTransaction(async (tx) => {
    const ref = accountsCol(ctx.db, input.projectId).doc(input.accountId);
    const account = await read<TestAccount>(tx, ref, '테스트 계정');
    const members = await membersIn(tx, ctx.db, input.projectId);
    const live = await liveLease(tx, ctx.db, account, nowOf(ctx));
    accountDeletion(members, await actorOf(ctx, tx), account, live);
    tx.delete(ref);
    tx.delete(secretRef(ctx.db, input.projectId, input.accountId));
  });
}

/** 로그인 실패 표시 지우기·격리 해제 (F-PF-08·09) */
export async function clearAccountFlag(ctx: Ctx, data: unknown): Promise<TestAccount> {
  const input = parse(AccountId.extend({ flag: z.enum(['loginFailed', 'quarantine']) }), data);
  return ctx.db.runTransaction(async (tx) => {
    const ref = accountsCol(ctx.db, input.projectId).doc(input.accountId);
    const account = await read<TestAccount>(tx, ref, '테스트 계정');
    const next = flagClearing(await membersIn(tx, ctx.db, input.projectId), await actorOf(ctx, tx), account, input.flag);
    tx.set(ref, next);
    return next;
  });
}

const ClaimInput = ProjectId.extend({
  cycleId: z.string().min(1),
  runId: z.string().min(1),
  tcId: z.string().min(1),
  kind: z.string(),
  restoring: z.boolean(),
  accountId: opt,
});

/**
 * 케이스 단위 배정 (F-PF-04): 호스트만, 자기 사용자가 실행 중인 Run에 대해서만. 끊긴 배정은 먼저 풀고
 * (원복 중 끊긴 계정은 격리), 빈 계정 하나를 잠근 뒤 비밀값을 돌려준다. 빈 계정이 없으면 `account: null`.
 * `accountId`로 이미 받은 계정을 이어 쓰면 배정만 갱신하고 비밀값은 다시 보내지 않는다
 */
export async function claimAccount(
  ctx: Ctx,
  data: unknown,
): Promise<{ account: TestAccount; secret?: AccountSecret } | { account: null }> {
  if (!ctx.host) throw fail('permission', '테스트 계정은 실행 중인 호스트만 배정받을 수 있습니다.');
  const host = ctx.host;
  const input = parse(ClaimInput, data);
  const box = boxOf(ctx);
  const now = nowOf(ctx);
  return ctx.db.runTransaction(async (tx) => {
    const run = (await tx.get(runRef(ctx.db, input.projectId, input.cycleId, input.runId))).data() as Run | undefined;
    if (!run || run.executorUid !== ctx.uid || run.status !== 'running') {
      throw fail('permission', '내가 실행 중인 Run에서만 계정을 배정받을 수 있습니다.');
    }
    const members = await membersIn(tx, ctx.db, input.projectId);
    const actor = await actorOf(ctx, tx);
    const accounts = await accountsIn(tx, ctx.db, input.projectId);
    const lives = await Promise.all(accounts.map((a) => liveLease(tx, ctx.db, a, now)));
    const cleaned = accounts.map((a, i) => (a.lease && !lives[i] ? expiredLease(a, now) : a));
    const pick = claiming(members, cleaned, actor, host, input, now);
    const secret = pick && !input.accountId ? await openSecret(box, tx, secretRef(ctx.db, input.projectId, pick.id)) : undefined;

    cleaned.forEach((a, i) => {
      if (a !== accounts[i] && a.id !== pick?.id) tx.set(accountsCol(ctx.db, input.projectId).doc(a.id), a);
    });
    if (!pick) return { account: null };
    tx.set(accountsCol(ctx.db, input.projectId).doc(pick.id), pick);
    // 이미 받은 계정을 다음 케이스에 이어 쓰면 비밀값은 호스트 메모리에 있다
    if (!secret) return { account: pick };
    tx.create(ctx.db.collection(`projects/${input.projectId}/secretAccessLog`).doc(), {
      accountId: pick.id,
      loginId: pick.loginId,
      cycleId: input.cycleId,
      runId: input.runId,
      tcId: input.tcId,
      uid: ctx.uid,
      executor: actor.name,
      hostId: host,
      at: now,
    });
    return { account: pick, secret };
  });
}

/** 반납 (F-PF-04): 호스트만. 로그인 실패·원복 실패면 표시·격리한다. 이미 풀린 배정이면 아무것도 하지 않는다 */
export async function releaseAccount(ctx: Ctx, data: unknown): Promise<void> {
  if (!ctx.host) throw fail('permission', '테스트 계정은 배정받은 호스트만 반납할 수 있습니다.');
  const input = parse(
    AccountId.extend({
      runId: z.string().min(1),
      outcome: z.enum(['ok', 'login_failed', 'restore_failed']),
      detail: opt,
    }),
    data,
  );
  await ctx.db.runTransaction(async (tx) => {
    const ref = accountsCol(ctx.db, input.projectId).doc(input.accountId);
    const account = await read<TestAccount>(tx, ref, '테스트 계정');
    if (account.lease && account.lease.uid !== ctx.uid) throw fail('permission', '내가 배정받은 계정이 아닙니다.');
    const outcome =
      input.outcome === 'ok' ? { kind: 'ok' as const } : { kind: input.outcome, ...(input.detail ? { detail: input.detail } : {}) };
    const next = releasing(account, input.runId, outcome, nowOf(ctx));
    if (next) tx.set(ref, next);
  });
}
