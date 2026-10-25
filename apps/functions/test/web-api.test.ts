import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirebaseError } from 'firebase/app';
import { setLogLevel, type Firestore } from 'firebase/firestore';
import { GITHUB, PEOPLE } from '@qcard/fixtures';
import { MembershipError } from '@qcard/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, PermissionError, RuleError } from '@qcard/data';
import { createFirebaseApi, writeAll } from '@qcard/data/firebase';
import { createMemoryApi } from '../../web/src/data/memory';
import * as acc from '../src/accounts';
import * as h from '../src/handlers';
import { localBox } from '../src/secretBox';
import { seedDocs, SEED_USERS } from '@qcard/data/seed';

/*
 * 웹 Firestore 구현(apps/web/src/data/firebase.ts)을 에뮬레이터·보안 규칙 위에서 돌린다.
 * 같은 fixture를 넣은 메모리 구현과 결과가 같아야 한다. callable 함수는 핸들러를 직접 부르고,
 * 오류는 실제 callable처럼 FirebaseError(functions/…)로 바꿔 넘긴다.
 */

setLogLevel('silent');
let env: RulesTestEnvironment;
if (!getApps().length) initializeApp({ projectId: 'demo-qcard-test' });
const admin = getFirestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../../firebase/firestore.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((c) => writeAll(c.firestore() as unknown as Firestore, seedDocs()));
});

const CODE = { permission: 'permission-denied', rule: 'failed-precondition', not_found: 'not-found' } as const;

const handlers = { ...h, ...acc };
const box = localBox('test');

/** 사람 이름(PEOPLE)으로 로그인한 Firestore 구현 */
function apiAs(name: string) {
  const uid = GITHUB[name]!;
  return createFirebaseApi({
    db: env.authenticatedContext(uid).firestore() as unknown as Firestore,
    user: () => ({ uid, name }),
    call: async <T>(fn: string, data: unknown) => {
      try {
        const handler = handlers[fn as keyof typeof handlers] as (ctx: h.Ctx, data: unknown) => Promise<T>;
        return await handler({ db: admin, uid, box }, data);
      } catch (e) {
        if (e instanceof MembershipError) throw new FirebaseError(`functions/${CODE[e.kind]}`, e.message);
        throw e;
      }
    },
  });
}

const memory = () => createMemoryApi();
const byId = <T extends { cycle: { id: string } }>(xs: T[]) =>
  [...xs].sort((a, b) => a.cycle.id.localeCompare(b.cycle.id));

describe('메모리 구현과 같은 결과', () => {
  it('내 프로젝트 목록 (멤버인 것만)', async () => {
    const fb = await apiAs(PEOPLE.lead).listMyProjects();
    const mem = await memory().listMyProjects();
    const pick = (xs: typeof fb) => xs.map((s) => [s.project.id, s.role, s.memberCount, s.activeCycles]).sort();
    expect(pick(fb)).toEqual(pick(mem));
    expect(fb.map((s) => s.project.id)).not.toContain('atlas');
  });

  it('QA 문서·사이클·준비 플로우', async () => {
    const fb = apiAs(PEOPLE.lead);
    const mem = memory();
    const ref = { projectId: 'haru', docId: 'doc-130' };
    expect(await fb.getQaDoc(ref)).toEqual(await mem.getQaDoc(ref));
    expect(await fb.listQaDocs('haru')).toEqual(expect.arrayContaining(await mem.listQaDocs('haru')));
    expect(await fb.listPrepFlows('haru')).toEqual(await mem.listPrepFlows('haru'));
    expect(byId(await fb.listCycles('haru'))).toEqual(byId(await mem.listCycles('haru')));
    const cref = { projectId: 'haru', cycleId: 'cycle-130-1' };
    expect(await fb.getCycle(cref)).toEqual(await mem.getCycle(cref));
  });

  it('QA 문서 생성 진행: 생성 계획·진행 기록·스펙별 초안 (다른 멤버도 읽는다)', async () => {
    const fb = apiAs(PEOPLE.planner);
    const mem = memory();
    expect(await fb.listJobs('haru')).toEqual(await mem.listJobs('haru'));
    for (const job of ['job-140', 'job-131', 'job-130']) {
      expect(await fb.listJobSpecs('haru', job)).toEqual(await mem.listJobSpecs('haru', job));
      expect(await fb.listJobEvents('haru', job)).toEqual(await mem.listJobEvents('haru', job));
      expect(await fb.listJobDrafts('haru', job, 'onboarding-flow')).toEqual(
        await mem.listJobDrafts('haru', job, 'onboarding-flow'),
      );
    }
    expect((await fb.listJobDrafts('haru', 'job-140', 'onboarding-flow')).length).toBe(16);
    expect(await fb.listJobDrafts('haru', 'job-140', 'other')).toEqual([]);
    // 작업을 처리하는 요청자가 아니면 진행을 쓸 수 없다
    const { doc, setDoc } = await import('firebase/firestore');
    const other = env.authenticatedContext(GITHUB[PEOPLE.qa]!).firestore() as unknown as Firestore;
    await expect(
      setDoc(doc(other, 'projects/haru/jobs/job-140/events/x'), { id: 'x', at: 'now', kind: 'warning', text: '' }),
    ).rejects.toThrow();
  });
});

describe('테스트 계정 (F-PF-08)', () => {
  it('등록·수정·표시 해제·삭제가 메모리 구현과 같고, 목록에 비밀값이 없다', async () => {
    const steps = async (api: ReturnType<typeof memory>) => {
      const a = await api.createAccount('haru', { loginId: 'qa02@haru.test', password: 'pw-2', note: '빈 계정' });
      const b = await api.createAccount('haru', { kind: '구독자', loginId: 'qa01@haru.test', password: 'pw-1' });
      await api.updateAccount('haru', a.id, { kind: '구독자', note: '' });
      await expect(api.clearAccountFlag('haru', b.id, 'quarantine')).rejects.toBeInstanceOf(RuleError);
      await api.deleteAccount('haru', b.id);
      return (await api.listAccounts('haru')).map(({ account: x, state }) => ({
        state,
        kind: x.kind,
        loginId: x.loginId,
        note: x.note,
        usesTotp: x.usesTotp,
        by: x.secretUpdated.by,
      }));
    };
    const fb = apiAs(PEOPLE.lead);
    const got = await steps(fb as unknown as ReturnType<typeof memory>);
    expect(got).toEqual(await steps(memory()));
    expect(got).toEqual([{ state: 'free', kind: '구독자', loginId: 'qa02@haru.test', note: undefined, usesTotp: false, by: PEOPLE.lead }]);
    expect(JSON.stringify(await fb.listAccounts('haru'))).not.toContain('pw-2');
  });

  it('Viewer는 계정을 등록할 수 없다', async () => {
    const input = { loginId: 'x@haru.test', password: 'pw' };
    await expect(apiAs(PEOPLE.planner).createAccount('haru', input)).rejects.toBeInstanceOf(PermissionError);
    await expect(createMemoryApi({ currentUser: PEOPLE.planner }).createAccount('haru', input)).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});

describe('권한 (보안 규칙)', () => {
  it('멤버가 아니면 프로젝트를 볼 수 없다', async () => {
    await expect(apiAs(PEOPLE.lead).getProject('atlas')).rejects.toBeInstanceOf(PermissionError);
    await expect(apiAs(PEOPLE.lead).getQaDoc({ projectId: 'atlas', docId: 'x' })).rejects.toBeInstanceOf(
      PermissionError,
    );
    expect(await apiAs(PEOPLE.lead).myRole('atlas')).toBeUndefined();
  });

  it('Viewer는 케이스를 고칠 수 없다', async () => {
    const viewer = apiAs(PEOPLE.planner);
    const ref = { projectId: 'haru', docId: 'doc-130' };
    const c = (await viewer.getQaDoc(ref)).cases[0]!;
    await expect(viewer.updateCase(ref, c.tcId, { ...c, title: 'x' }, c.rev)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('QA 데이터 쓰기', () => {
  const ref = { projectId: 'haru', docId: 'doc-130' };

  it('낙관적 잠금: 먼저 저장한 사람이 이기고 나중 저장은 최신 내용을 받는다', async () => {
    const a = apiAs(PEOPLE.lead);
    const b = apiAs(PEOPLE.qa);
    const c = (await a.getQaDoc(ref)).cases[0]!;
    const saved = await a.updateCase(ref, c.tcId, { ...c, title: '먼저' }, c.rev);
    expect(saved.rev).toBe(c.rev + 1);
    const err = await b.updateCase(ref, c.tcId, { ...c, title: '나중' }, c.rev).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).latest.title).toBe('먼저');
  });

  it('사이클은 만들 때 케이스 내용을 복사해 두고, QA 문서를 고쳐도 그 내용으로 읽힌다 (F-CY-02)', async () => {
    const fb = apiAs(PEOPLE.lead);
    const cycle = await fb.createCycle('haru', {
      name: '고정 확인',
      docId: ref.docId,
      buildId: 'build-130',
      targets: [{ model: 'Pixel 8', osMajor: 15 }],
      serverEnv: 'stage',
    });
    const cref = { projectId: 'haru', cycleId: cycle.id };
    const before = await fb.getCycle(cref);
    expect(before.cases.map((c) => c.tcId)).toEqual(cycle.snapshot.map((s) => s.tcId));
    const c = before.cases[0]!;
    await fb.updateCase(ref, c.tcId, { ...c, title: '사이클 뒤에 고친 제목' }, c.rev);
    expect((await fb.getCycle(cref)).cases).toEqual(before.cases);
  });

  it('구독하면 다른 사람이 확정한 판정이 바로 들어오고, 끊으면 더 받지 않는다 (F-CY-05·F-DB-07)', async () => {
    const cref = { projectId: 'haru', cycleId: 'cycle-130-1' };
    const watcher = apiAs(PEOPLE.lead);
    const other = apiAs(PEOPLE.qa);
    const first = await watcher.getCycle(cref);
    const r = first.results.find((x) => x.verdict === 'check')!;
    const verdictOf = (d: typeof first) =>
      d.results.find((x) => x.tcId === r.tcId && x.deviceId === r.deviceId)!.verdict;
    const seen: (typeof first)[] = [];
    const stop = watcher.watchCycle(cref, (d) => seen.push(d));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual(first);

    await other.confirmVerdict({ ...cref, tcId: r.tcId, deviceId: r.deviceId, verdict: 'fail', actualSummary: '재현' });
    await vi.waitFor(() => expect(verdictOf(seen.at(-1)!)).toBe('fail'));
    expect(seen.at(-1)!.cases).toEqual(first.cases);

    stop();
    const count = seen.length;
    await other.confirmVerdict({ ...cref, tcId: r.tcId, deviceId: r.deviceId, verdict: 'pass' });
    await new Promise((res) => setTimeout(res, 300));
    expect(seen.length).toBe(count);
  });

  it('판정을 확정하면 판정자·서버 시각이 변경 불가 로그로 남고, 결과에 이력으로 붙는다 (F-RP-04)', async () => {
    const cref = { projectId: 'haru', cycleId: 'cycle-130-1' };
    const qa = apiAs(PEOPLE.qa);
    const r = (await qa.getCycle(cref)).results.find((x) => x.verdict === 'check')!;
    const before = Date.now();
    await qa.confirmVerdict({ ...cref, tcId: r.tcId, deviceId: r.deviceId, verdict: 'fail', actualSummary: '재현' });
    const after = (await qa.getCycle(cref)).results.find((x) => x.tcId === r.tcId && x.deviceId === r.deviceId)!;
    expect(after).toMatchObject({ verdict: 'fail', decidedBy: { kind: 'human', name: PEOPLE.qa } });
    expect(after.history.slice(0, -1)).toEqual(r.history);
    const last = after.history.at(-1)!;
    expect(last).toMatchObject({ by: PEOPLE.qa, from: 'check', to: 'fail' });
    // 서버 시각 (에뮬레이터 시계와 몇 초 이내)
    expect(Math.abs(new Date(last.at).getTime() - before)).toBeLessThan(10_000);
  });

  it('케이스 수정안: 요청·조회·처리가 메모리 구현과 같고, 처리는 요청한 사람만 한다 (F-QD-17)', async () => {
    const fb = apiAs(PEOPLE.lead);
    const mem = memory();
    expect(await fb.listCaseRevisions(ref)).toEqual(await mem.listCaseRevisions(ref));
    const [done] = await fb.listCaseRevisions(ref);
    expect(done!.result?.kind).toBe('revise');

    // 다른 멤버는 내 수정안을 처리할 수 없다
    await expect(apiAs(PEOPLE.qa).closeCaseRevision('haru', done!.id, 'dismissed')).rejects.toBeInstanceOf(
      PermissionError,
    );
    const doc = await fb.getQaDoc(ref);
    const open = doc.questions.find((q) => q.status === 'open')!;
    for (const api of [fb, mem]) {
      await api.closeCaseRevision('haru', done!.id, 'dismissed');
      // 답변된 질문이 없는 케이스는 요청할 수 없다
      await expect(api.requestCaseRevision(ref, open.caseIds[0]!)).rejects.toBeInstanceOf(RuleError);
      const job = await api.requestCaseRevision(ref, done!.input.tcId);
      expect(job).toMatchObject({ kind: 'case_revise', status: 'queued', input: done!.input });
      // 진행 중이면 또 만들지 않는다
      await expect(api.requestCaseRevision(ref, done!.input.tcId)).rejects.toBeInstanceOf(RuleError);
    }
    const noVolatile = (xs: unknown) =>
      JSON.parse(JSON.stringify(xs).replace(/"(at|createdAt|id)":"[^"]+"/g, '"$1":"T"'));
    expect(noVolatile(await fb.listCaseRevisions(ref))).toEqual(noVolatile(await mem.listCaseRevisions(ref)));
    // Viewer는 요청할 수 없다
    await expect(apiAs(PEOPLE.planner).requestCaseRevision(ref, done!.input.tcId)).rejects.toThrow();
  });

  it('승인·질문 처리·판정 확정이 메모리 구현과 같게 저장된다', async () => {
    const fb = apiAs(PEOPLE.lead);
    const mem = memory();
    const doc = await fb.getQaDoc(ref);
    const pending = doc.cases.find((c) => c.approval.status === 'pending')!;
    const q = doc.questions.find((x) => x.status === 'open')!;
    const cref = { projectId: 'haru', cycleId: 'cycle-130-1' };
    const r = (await fb.getCycle(cref)).results.find((x) => x.verdict === 'check')!;
    const verdict = { ...cref, tcId: r.tcId, deviceId: r.deviceId, verdict: 'fail' as const, note: '재현됨' };
    for (const api of [fb, mem]) {
      await api.setApproval(ref, [pending.tcId], 'approved');
      await api.resolveQuestion(ref, q.id, { kind: 'proceed' });
      await api.commentQuestion(ref, q.id, '확인');
      await api.confirmVerdict(verdict);
    }
    // 시각만 다르다
    const noTime = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/"(at|executedAt)":"[^"]+"/g, '"$1":"T"'));
    expect(noTime(await fb.getQaDoc(ref))).toEqual(noTime(await mem.getQaDoc(ref)));
    expect(noTime(await fb.getCycle(cref))).toEqual(noTime(await mem.getCycle(cref)));
  });
});

describe('프로젝트·초대 (callable)', () => {
  it('만들고 초대해 다른 사람이 수락한다', async () => {
    const lead = apiAs(PEOPLE.lead);
    const p = await lead.createProject({
      name: 'Demo',
      appName: '데모',
      packageName: 'com.demo.app',
      dataNoticeAck: true,
    });
    const inv = await lead.createInvitation(p.id, { role: 'qa' });
    const guest = apiAs(PEOPLE.planner);
    expect((await guest.getInvitation(inv.token)).state).toBe('pending');
    await guest.acceptInvitation(inv.token, { dataNoticeAck: true });
    expect(await guest.myRole(p.id)).toBe('qa');
    expect((await guest.listMyProjects()).map((s) => s.project.id)).toContain(p.id);
    await expect(guest.createInvitation(p.id, { role: 'qa' })).rejects.toBeInstanceOf(PermissionError);
    await expect(lead.leaveProject('widget')).rejects.toBeInstanceOf(RuleError);
  });

  it('시드 사용자는 닉네임이 있다', async () => {
    const snaps = await Promise.all(SEED_USERS.map((u) => admin.doc(`users/${u.uid}`).get()));
    expect(snaps.every((s) => s.exists)).toBe(true);
  });
});

describe('호스트 연결 (F-TM-14)', () => {
  it('연결하면 내 목록에만 보이고, 해제하면 빠진다 — 메모리 구현과 같다', async () => {
    for (const api of [apiAs(PEOPLE.qa), createMemoryApi({ currentUser: PEOPLE.qa })]) {
      const cred = await api.connectHost(' MacBook Air ');
      expect(cred.uid).toBe(GITHUB[PEOPLE.qa]);
      expect((await api.myHostConnections()).map((c) => [c.id, c.name])).toEqual([[cred.hostId, 'MacBook Air']]);
      expect(JSON.stringify(await api.myHostConnections())).not.toContain('secretHash');
      await api.disconnectHost(cred.hostId);
      expect(await api.myHostConnections()).toEqual([]);
      await expect(api.disconnectHost(cred.hostId)).rejects.toBeInstanceOf(Error);
    }
  });
});
