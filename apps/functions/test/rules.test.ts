import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/*
 * Firestore 보안 규칙 (firebase/firestore.rules): 프로젝트 격리, 역할별 쓰기,
 * 프로젝트·멤버·초대는 클라이언트가 직접 못 쓴다 (Functions만).
 */

let env: RulesTestEnvironment;
// assertFails가 기대하는 거부 로그는 숨긴다
setLogLevel('silent');

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../../../firebase/firestore.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'projects/haru'), { id: 'haru', name: '하루콩' });
    await setDoc(doc(db, 'projects/haru/members/u-admin'), { role: 'admin' });
    await setDoc(doc(db, 'projects/haru/members/u-qa'), { role: 'qa' });
    await setDoc(doc(db, 'projects/haru/members/u-viewer'), { role: 'viewer' });
    await setDoc(doc(db, 'projects/haru/invitations/i1'), { token: 't1' });
    await setDoc(doc(db, 'projects/haru/qaDocs/doc-130'), { appVersion: '1.3.0' });
    await setDoc(doc(db, 'projects/other/qaDocs/d1'), { appVersion: '1.0.0' });
    await setDoc(doc(db, 'invitationTokens/t1'), { projectId: 'haru', invitationId: 'i1' });
    await setDoc(doc(db, 'users/u-qa'), { github: 'minji-kim', name: '김민지' });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe('읽기', () => {
  it('멤버만 프로젝트와 하위 데이터를 읽는다 (프로젝트 격리)', async () => {
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru')));
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru/qaDocs/doc-130')));
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru/members/u-admin')));
    await assertFails(getDoc(doc(as('u-outsider'), 'projects/haru')));
    await assertFails(getDoc(doc(as('u-outsider'), 'projects/haru/qaDocs/doc-130')));
    await assertFails(getDoc(doc(as('u-admin'), 'projects/other/qaDocs/d1')));
    await assertFails(getDoc(doc(as(null), 'projects/haru')));
  });

  it('초대는 Admin만 보고, 초대 토큰 색인은 아무도 못 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('u-admin'), 'projects/haru/invitations/i1')));
    await assertFails(getDoc(doc(as('u-qa'), 'projects/haru/invitations/i1')));
    await assertFails(getDoc(doc(as('u-admin'), 'invitationTokens/t1')));
  });

  it('닉네임은 본인만 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('u-qa'), 'users/u-qa')));
    await assertFails(getDoc(doc(as('u-admin'), 'users/u-qa')));
  });
});

describe('쓰기', () => {
  it('프로젝트·멤버·초대·닉네임은 클라이언트가 직접 못 쓴다', async () => {
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru'), { name: 'X' }));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/members/u-qa'), { role: 'viewer' }));
    await assertFails(setDoc(doc(as('u-outsider'), 'projects/haru/members/u-outsider'), { role: 'admin' }));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/invitations/i2'), { token: 't2' }));
    await assertFails(setDoc(doc(as('u-qa'), 'users/u-qa'), { github: 'someone-else' }));
    await assertFails(setDoc(doc(as('u-new'), 'projects/new'), { name: 'New' }));
  });

  it('QA 데이터는 Admin·QA가 쓰고 Viewer·비멤버는 못 쓴다', async () => {
    await assertSucceeds(setDoc(doc(as('u-qa'), 'projects/haru/qaDocs/doc-130'), { appVersion: '1.3.1' }));
    await assertSucceeds(setDoc(doc(as('u-admin'), 'projects/haru/cycles/c1/results/r1'), { verdict: 'nt' }));
    await assertFails(setDoc(doc(as('u-viewer'), 'projects/haru/qaDocs/doc-130'), { appVersion: 'x' }));
    await assertFails(setDoc(doc(as('u-outsider'), 'projects/haru/cycles/c1'), { name: 'x' }));
  });

  it('사이클의 스냅샷·케이스 사본은 만든 뒤 바꾸지 않는다 (F-CY-02)', async () => {
    const qa = as('u-qa');
    const cycle = doc(qa, 'projects/haru/cycles/c2');
    const copy = doc(qa, 'projects/haru/cycles/c2/cases/TC-1');
    const snapshot = [{ tcId: 'TC-1', contentHash: 'h1' }];
    await assertSucceeds(setDoc(cycle, { name: 'c2', docId: 'doc-130', buildId: 'build-100-a', snapshot }));
    await assertSucceeds(setDoc(copy, { title: '원래 제목' }));
    await assertFails(setDoc(copy, { title: '바꾼 제목' }));
    await assertFails(deleteDoc(copy));
    await assertFails(updateDoc(cycle, { snapshot: [{ tcId: 'TC-1', contentHash: 'h2' }] }));
    await assertFails(updateDoc(cycle, { docId: 'doc-120' }));
    await assertFails(updateDoc(cycle, { buildId: 'build-101-b' })); // 새 빌드는 새 사이클로
    // 이름·기간 같은 다른 필드와 결과 칸(N/T)은 계속 쓴다
    await assertSucceeds(updateDoc(cycle, { name: 'c2 (수정)' }));
    await assertSucceeds(setDoc(doc(qa, 'projects/haru/cycles/c2/results/TC-1__d'), { verdict: 'nt' }));
    await assertFails(setDoc(doc(as('u-viewer'), 'projects/haru/cycles/c3/cases/TC-1'), { title: 'x' }));
  });

  describe('판정 기록 (F-RP-04)', () => {
    const RESULT = 'projects/haru/cycles/c1/results/TC-1__d';
    const LOG = 'projects/haru/cycles/c1/verdictLog';
    const log = (over: Record<string, unknown> = {}) => ({
      tcId: 'TC-1',
      deviceId: 'd',
      from: 'check',
      to: 'fail',
      by: '김민지',
      byUid: 'u-qa',
      at: serverTimestamp(),
      ...over,
    });
    const human = (decision: string, over: Record<string, unknown> = {}) => ({
      tcId: 'TC-1',
      deviceId: 'd',
      verdict: 'fail',
      decidedBy: { kind: 'human', name: '김민지' },
      _decision: decision,
      ...over,
    });
    beforeEach(() =>
      env.withSecurityRulesDisabled((c) =>
        setDoc(doc(c.firestore(), RESULT), {
          tcId: 'TC-1',
          deviceId: 'd',
          verdict: 'check',
          decidedBy: { kind: 'agent' },
        }),
      ),
    );
    /** 로그 + 결과를 한 번에 (confirmVerdict와 같은 모양) */
    const confirm = (
      logData: Record<string, unknown>,
      result: (id: string) => Record<string, unknown>,
      uid = 'u-qa',
    ) => {
      const db = as(uid);
      const b = writeBatch(db);
      const ref = doc(db, LOG, `l-${Math.random().toString(36).slice(2)}`);
      b.set(ref, logData);
      b.set(doc(db, RESULT), result(ref.id));
      return b.commit();
    };

    it('로그인 사용자 이름·서버 시각으로 로그를 남기면 사람 판정을 쓴다', async () => {
      await assertSucceeds(confirm(log(), (id) => human(id)));
    });

    it('로그 없이, 남의 이름으로, 클라이언트 시각으로는 사람 판정을 못 쓴다', async () => {
      await assertFails(setDoc(doc(as('u-qa'), RESULT), human('none')));
      await assertFails(
        confirm(log({ by: '이재성' }), (id) => human(id, { decidedBy: { kind: 'human', name: '이재성' } })),
      );
      await assertFails(confirm(log({ byUid: 'u-admin' }), (id) => human(id)));
      await assertFails(confirm(log({ at: Timestamp.fromDate(new Date('2026-01-01')) }), (id) => human(id)));
      // 로그와 다른 판정
      await assertFails(confirm(log({ to: 'pass' }), (id) => human(id)));
    });

    it('예전 로그를 다시 가리켜 판정을 바꾸지 못하고, 로그는 고치거나 지우지 못한다', async () => {
      let first = '';
      await assertSucceeds(confirm(log(), (id) => ((first = id), human(id))));
      await assertFails(setDoc(doc(as('u-qa'), RESULT), human(first, { verdict: 'pass' })));
      await assertFails(updateDoc(doc(as('u-qa'), LOG, first), { to: 'pass' }));
      await assertFails(deleteDoc(doc(as('u-qa'), LOG, first)));
    });

    it('판정을 건드리지 않는 메모·요약은 사람이 고치지만, Agent 증거는 못 고친다', async () => {
      await assertSucceeds(updateDoc(doc(as('u-qa'), RESULT), { actualSummary: '요약만 고침', note: '메모' }));
      await assertFails(updateDoc(doc(as('u-qa'), RESULT), { steps: [] }));
      await assertFails(updateDoc(doc(as('u-qa'), RESULT), { runId: 'other' }));
      await assertFails(updateDoc(doc(as('u-viewer'), RESULT), { note: 'x' }));
    });

    it('사람은 Agent 판정을 쓰지 못하고, 호스트는 사람 판정·판정 로그를 쓰지 못한다 (PRD §8)', async () => {
      await assertFails(
        setDoc(doc(as('u-qa'), RESULT), { tcId: 'TC-1', deviceId: 'd', verdict: 'pass', decidedBy: { kind: 'agent' } }),
      );
      await assertFails(setDoc(doc(as('u-qa'), 'projects/haru/cycles/c1/results/new'), { verdict: 'pass' }));
      await env.withSecurityRulesDisabled((c) =>
        setDoc(doc(c.firestore(), 'hostConnections/h-qa'), { id: 'h-qa', uid: 'u-qa' }),
      );
      const host = env.authenticatedContext('u-qa', { host: 'h-qa' }).firestore();
      const b = writeBatch(host);
      const ref = doc(host, LOG, 'l-host');
      b.set(ref, log());
      b.set(doc(host, RESULT), human(ref.id));
      await assertFails(b.commit());
    });
  });

  it('이전 시도 보관본은 호스트가 만들기만 하고 바꾸지 못한다 (F-CY-04)', async () => {
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'hostConnections/h-qa'), { id: 'h-qa', uid: 'u-qa' }),
    );
    const host = env.authenticatedContext('u-qa', { host: 'h-qa' }).firestore();
    const kept = doc(host, 'projects/haru/cycles/c1/attempts/TC-1__d__1');
    await assertSucceeds(setDoc(kept, { verdict: 'fail' }));
    await assertFails(setDoc(kept, { verdict: 'pass' }));
    await assertFails(deleteDoc(kept));
    await assertFails(setDoc(doc(as('u-qa'), 'projects/haru/cycles/c1/attempts/TC-1__d__2'), { verdict: 'fail' }));
  });

  it('작업(Job)은 본인 이름으로만 요청한다', async () => {
    await assertSucceeds(
      setDoc(doc(as('u-qa'), 'projects/haru/jobs/j1'), { kind: 'qa_doc_generate', requestedBy: 'u-qa' }),
    );
    await assertFails(
      setDoc(doc(as('u-qa'), 'projects/haru/jobs/j2'), { kind: 'qa_doc_generate', requestedBy: 'u-admin' }),
    );
    await assertFails(
      setDoc(doc(as('u-viewer'), 'projects/haru/jobs/j3'), { kind: 'qa_doc_generate', requestedBy: 'u-viewer' }),
    );
  });
});

describe('호스트 토큰 (F-TM-14)', () => {
  // 호스트 에이전트는 Functions가 발급한 토큰으로 접속한다: uid = 사용자, host 클레임 = 연결 id
  const asHost = (uid: string, host: string) => env.authenticatedContext(uid, { host }).firestore();
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'hostConnections/h-qa'), { id: 'h-qa', uid: 'u-qa', name: 'mbp' });
    });
  });

  it('연결이 살아 있는 동안만 사용자 권한으로 읽고 쓴다', async () => {
    await assertSucceeds(getDoc(doc(asHost('u-qa', 'h-qa'), 'projects/haru/qaDocs/doc-130')));
    await assertSucceeds(
      setDoc(doc(asHost('u-qa', 'h-qa'), 'projects/haru/cycles/c1/runs/r1'), {
        status: 'running',
        executorUid: 'u-qa',
        hostId: 'h-qa',
      }),
    );
    // 연결 해제(문서 삭제) 뒤에는 이미 받은 토큰도 막힌다
    await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), 'hostConnections/h-qa')));
    await assertFails(getDoc(doc(asHost('u-qa', 'h-qa'), 'projects/haru/qaDocs/doc-130')));
    await assertFails(
      setDoc(doc(asHost('u-qa', 'h-qa'), 'projects/haru/cycles/c1/runs/r2'), {
        status: 'running',
        executorUid: 'u-qa',
        hostId: 'h-qa',
      }),
    );
  });

  it('다른 사람의 연결 id로는 통과하지 못한다', async () => {
    await assertFails(getDoc(doc(asHost('u-admin', 'h-qa'), 'projects/haru/qaDocs/doc-130')));
  });

  it('연결 목록은 본인 것만 읽고, 아무도 직접 쓰지 못한다', async () => {
    await assertSucceeds(getDoc(doc(as('u-qa'), 'hostConnections/h-qa')));
    await assertFails(getDoc(doc(as('u-admin'), 'hostConnections/h-qa')));
    await assertFails(setDoc(doc(as('u-qa'), 'hostConnections/h-new'), { uid: 'u-qa' }));
    await assertFails(deleteDoc(doc(as('u-qa'), 'hostConnections/h-qa')));
  });

  it('연결 신호는 그 호스트만 자기 문서에 쓰고, 웹(사람)은 읽기만 한다', async () => {
    const beat = { id: 'h-qa', name: 'mbp', lastSeen: '2026-10-24T00:00:00Z' };
    await assertSucceeds(setDoc(doc(asHost('u-qa', 'h-qa'), 'users/u-qa/hosts/h-qa'), beat));
    await assertSucceeds(getDoc(doc(as('u-qa'), 'users/u-qa/hosts/h-qa')));
    await assertFails(setDoc(doc(as('u-qa'), 'users/u-qa/hosts/h-qa'), beat));
    await assertFails(setDoc(doc(asHost('u-qa', 'h-qa'), 'users/u-qa/hosts/other'), beat));
    await assertFails(deleteDoc(doc(asHost('u-qa', 'h-qa'), 'users/u-qa/hosts/h-qa')));
  });
});

describe('Agent 기록은 그 Run을 실행한 사용자의 호스트만 (PRD §8)', () => {
  const C = 'projects/haru/cycles/c1';
  const asHost = (uid: string, host: string) => env.authenticatedContext(uid, { host }).firestore();
  const run = { status: 'running', executorUid: 'u-qa', hostId: 'h-qa' };
  const agent = { tcId: 'TC-1', deviceId: 'd', verdict: 'pass', decidedBy: { kind: 'agent' }, runId: 'r1' };
  beforeEach(() =>
    env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'hostConnections/h-qa'), { id: 'h-qa', uid: 'u-qa' });
      await setDoc(doc(db, 'hostConnections/h-qa2'), { id: 'h-qa2', uid: 'u-qa' });
      await setDoc(doc(db, 'hostConnections/h-admin'), { id: 'h-admin', uid: 'u-admin' });
    }),
  );

  it('Run은 호스트가 자기 이름·연결로만 만들고, 사람(웹) 세션은 만들지도 고치지도 못한다', async () => {
    await assertFails(setDoc(doc(as('u-qa'), `${C}/runs/r1`), run));
    await assertFails(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), { ...run, executorUid: 'u-admin' }));
    await assertFails(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), { ...run, hostId: 'h-qa2' }));
    await assertSucceeds(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), run));
    await assertFails(updateDoc(doc(as('u-qa'), `${C}/runs/r1`), { status: 'done' }));
    await assertFails(deleteDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`)));
  });

  it('같은 사용자의 다른(다시 연결한) PC는 이어서 쓰고, 다른 사람의 호스트는 못 쓴다', async () => {
    await assertSucceeds(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), run));
    await assertSucceeds(updateDoc(doc(asHost('u-qa', 'h-qa2'), `${C}/runs/r1`), { status: 'paused' }));
    await assertFails(updateDoc(doc(asHost('u-admin', 'h-admin'), `${C}/runs/r1`), { status: 'done' }));
    await assertFails(updateDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), { executorUid: 'u-admin' }));
  });

  it('예전 Run(실행자 uid 없음)은 더 이어 쓰지 못한다', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `${C}/runs/old`), { status: 'paused' }));
    await assertFails(updateDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/old`), { status: 'running' }));
  });

  it('Agent 판정은 그 Run의 실행자 호스트만 쓴다', async () => {
    await assertSucceeds(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/runs/r1`), run));
    await assertSucceeds(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/results/TC-1__d`), agent));
    await assertFails(setDoc(doc(asHost('u-admin', 'h-admin'), `${C}/results/TC-1__d`), agent));
    await assertFails(setDoc(doc(asHost('u-qa', 'h-qa'), `${C}/results/TC-1__d`), { ...agent, runId: 'nope' }));
    // 사람(웹)은 Agent 판정인 채로 판정을 바꾸지 못하고, Agent 증거도 못 바꾼다
    await assertFails(setDoc(doc(as('u-qa'), `${C}/results/TC-1__d`), { ...agent, verdict: 'fail' }));
    await assertFails(setDoc(doc(as('u-qa'), `${C}/results/TC-1__d`), { ...agent, steps: [] }));
  });
});

describe('테스트 계정 (F-PF-08, F-EX-09)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'projects/haru/accounts/a1'), { id: 'a1', loginId: 'qa01@haru.test', kind: '기본' });
      await setDoc(doc(db, 'projects/haru/accountSecrets/a1'), { sealed: 'local:xxx' });
      await setDoc(doc(db, 'projects/haru/secretAccessLog/l1'), { accountId: 'a1', uid: 'u-qa' });
    });
  });

  it('계정 목록은 멤버가 읽고, 아무도 직접 쓰지 못한다', async () => {
    await assertSucceeds(getDoc(doc(as('u-viewer'), 'projects/haru/accounts/a1')));
    await assertFails(getDoc(doc(as('u-outsider'), 'projects/haru/accounts/a1')));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/accounts/a2'), { loginId: 'x', kind: '기본' }));
    await assertFails(updateDoc(doc(as('u-qa'), 'projects/haru/accounts/a1'), { quarantine: null }));
  });

  it('비밀값은 Admin도 읽거나 쓰지 못한다', async () => {
    await assertFails(getDoc(doc(as('u-admin'), 'projects/haru/accountSecrets/a1')));
    await assertFails(setDoc(doc(as('u-admin'), 'projects/haru/accountSecrets/a1'), { sealed: 'x' }));
  });

  it('비밀값 전달 기록은 Admin·QA가 읽고 Viewer는 못 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('u-qa'), 'projects/haru/secretAccessLog/l1')));
    await assertFails(getDoc(doc(as('u-viewer'), 'projects/haru/secretAccessLog/l1')));
    await assertFails(setDoc(doc(as('u-qa'), 'projects/haru/secretAccessLog/l2'), { accountId: 'a1' }));
  });
});
