import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { PermissionError } from '@qcard/data';
import { createFirebaseApi, writeAll } from '@qcard/data/firebase';
import { seedDocs } from '@qcard/data/seed';
import { GITHUB, PEOPLE } from '@qcard/fixtures';
import { PlanLimitError, type LlmClient } from '@qcard/llm';
import type { QaDocJob } from '@qcard/shared';
import { fakeGeneratorLlm } from '@qcard/qadoc';
import { setLogLevel, type Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimJob, heartbeat, pendingJobs, processJob } from '../src';

/*
 * QA 문서 생성 작업 (PRD §5.2, §6.2): 웹이 스펙을 올려 작업을 만들고 → 요청자의 호스트가 받아 생성 → Firestore에 저장.
 * 에뮬레이터·보안 규칙 위에서, 모델은 가짜(fakeGeneratorLlm)로 확인한다.
 */

setLogLevel('silent');
const ROOT = resolve(import.meta.dirname, '../../..');
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: readFileSync(join(ROOT, 'firebase/firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(join(ROOT, 'firebase/storage.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled((c) => writeAll(c.firestore() as unknown as Firestore, seedDocs()));
});

// 팀 스펙 템플릿 모양의 합성 문서
const SPEC = `# 스펙 명세서: 샘플 기능

## 1. 유저 시나리오

### 유저 플로우 1 - 처음 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-001 | 첫 화면 | 처음 설치함 | 앱을 연다 | \`시작하기\`가 보인다 | FR-001 |
| TS-002 | 시작 | 첫 화면 | [시작하기] | 홈으로 이동한다 | FR-002 |

| ID | 상황 | 처리 | 관련 FR |
|---|---|---|---|
| EC-001 | 네트워크가 없다 | 재시도 안내를 띄운다 | FR-001 |

## 2. 요구사항

- **FR-001**: 첫 화면을 보여 준다.
- **FR-002**: 시작하면 홈을 연다.
`;
const FILES = [
  { path: 'docs/specs/sample/spec.md', content: SPEC },
  { path: 'docs/specs/sample/plan.md', content: '# 계획 (입력 아님)' },
];
const PROJECT = 'haru';

function as(name: string) {
  const uid = GITHUB[name]!;
  const ctx = env.authenticatedContext(uid);
  const db = ctx.firestore() as unknown as Firestore;
  const storage = ctx.storage() as unknown as FirebaseStorage;
  const api = createFirebaseApi({
    db,
    storage,
    user: () => ({ uid, name }),
    call: () => Promise.reject(new Error('callable 없음')),
  });
  const deps = (llm: LlmClient) => ({ db, storage, api, uid, host: `${name}의 PC`, llmFor: () => llm });
  return { uid, db, api, deps };
}

describe('QA 문서 생성 작업', () => {
  it('웹 요청 → 내 호스트가 받아 생성·저장하고, 웹에서 바로 문서가 보인다', async () => {
    const lead = as(PEOPLE.lead);
    const job = await lead.api.requestQaDoc(PROJECT, { appVersion: '2.0.0', files: FILES });
    expect(job).toMatchObject({ status: 'queued', requestedBy: lead.uid, input: { appVersion: '2.0.0' } });

    // 다른 사람의 호스트에는 보이지 않고, 가져갈 수도 없다
    const qa = as(PEOPLE.qa);
    expect(await pendingJobs(qa.db, qa.uid)).toEqual([]);
    await expect(claimJob(qa.db, job, '김민지의 PC', 'now')).rejects.toThrow();

    const [mine] = await pendingJobs(lead.db, lead.uid);
    expect(mine?.id).toBe(job.id);
    const running = await claimJob(lead.db, job, '이재성의 PC', '2026-10-22T10:00:00Z');
    expect(running).toMatchObject({ status: 'running', host: '이재성의 PC' });
    // 같은 작업을 두 번 가져가지 않는다 (같은 사용자의 다른 PC)
    expect(await claimJob(lead.db, mine!, '이재성의 다른 PC', 'now')).toBeUndefined();

    const { llm } = fakeGeneratorLlm();
    const done = await processJob(lead.deps(llm), running!);
    expect(done).toMatchObject({
      status: 'done',
      result: { docId: 'doc-2.0.0', cases: 3, generated: 3, questions: 1, newPrepFlows: 2 },
    });

    // 웹(다른 멤버)에서 그대로 읽힌다
    const doc = await qa.api.getQaDoc({ projectId: PROJECT, docId: 'doc-2.0.0' });
    expect(doc.cases.map((c) => [c.tcId, c.change])).toEqual([
      ['TC-SAMPLE-001', 'new'],
      ['TC-SAMPLE-002', 'new'],
      ['TC-SAMPLE-003', 'new'],
    ]);
    expect(doc.specs).toEqual([{ name: 'sample', feature: '샘플 기능', file: 'docs/specs/sample/spec.md' }]);
    expect((await qa.api.listPrepFlows(PROJECT)).map((f) => f.id)).toEqual(expect.arrayContaining(['pf-home', 'pf-undo']));
    expect((await qa.api.listJobs(PROJECT))[0]).toMatchObject({
      id: job.id,
      status: 'done',
      plan: { specs: [{ name: 'sample', title: '샘플 기능', new: 3, changed: 0, same: 0 }], removed: 0 },
      progress: { phase: 'save', done: 3, total: 3, active: [], drafted: { sample: 3 } },
    });

    // 작업 상세 화면: 생성 계획·초안·진행 기록이 남아 다른 멤버도 본다
    const [spec] = await qa.api.listJobSpecs(PROJECT, job.id);
    expect(spec!.rows.map((r) => [r.id, r.tcId, r.change])).toEqual([
      ['TS-001', 'TC-SAMPLE-001', 'new'],
      ['TS-002', 'TC-SAMPLE-002', 'new'],
      ['EC-001', 'TC-SAMPLE-003', 'new'],
    ]);
    const drafts = await qa.api.listJobDrafts(PROJECT, job.id, 'sample');
    expect(drafts.map((d) => [d.rowId, d.questions.length])).toEqual([
      ['TS-001', 0],
      ['TS-002', 0],
      ['EC-001', 1],
    ]);
    expect((await qa.api.listJobEvents(PROJECT, job.id)).map((e) => e.kind)).toEqual(
      expect.arrayContaining(['start', 'plan', 'prep_flow', 'cases', 'question', 'warning', 'done']),
    );
    expect((await qa.api.listQaDocs(PROJECT)).map((d) => d.appVersion)).toContain('2.0.0');
  });

  it('이전 버전과 비교해 바뀐 행만 다시 만든다 — 이전 버전의 스펙 묶음을 Storage에서 읽어 넘긴다', async () => {
    const lead = as(PEOPLE.lead);
    const first = await lead.api.requestQaDoc(PROJECT, { appVersion: '2.0.0', files: FILES });
    await processJob(lead.deps(fakeGeneratorLlm().llm), (await claimJob(lead.db, first, 'pc', 'now'))!);

    const changed = SPEC.replace('홈으로 이동한다', '오늘 탭이 선택된 채로 열린다');
    const next = await lead.api.requestQaDoc(PROJECT, {
      appVersion: '2.1.0',
      files: [{ path: 'sample/spec.md', content: changed }],
      prevDocId: 'doc-2.0.0',
    });
    const fake = fakeGeneratorLlm();
    const done = await processJob(lead.deps(fake.llm), (await claimJob(lead.db, next, 'pc', 'now'))!);
    expect(done.result).toMatchObject({ docId: 'doc-2.1.0', cases: 3, generated: 1 });
    const casePrompts = fake.calls.filter((c) => c.kind === 'case').map((c) => c.prompt);
    expect(casePrompts).toHaveLength(1);
    expect(casePrompts[0]).toContain('  Then: 홈으로 이동한다'); // 이전 버전 행
    const doc = await lead.api.getQaDoc({ projectId: PROJECT, docId: 'doc-2.1.0' });
    expect(doc.prevDocId).toBe('doc-2.0.0');
    expect(doc.cases.map((c) => c.change)).toEqual(['same', 'changed', 'same']);
  });

  it('플랜 한도면 일시정지로 남기고, 요청자만 다시 시도할 수 있다 (F-EX-17)', async () => {
    const lead = as(PEOPLE.lead);
    const job = await lead.api.requestQaDoc(PROJECT, { appVersion: '2.0.0', files: FILES });
    const { llm } = fakeGeneratorLlm({ failOn: { call: 2, error: new PlanLimitError('5시간 한도') } });
    const paused = await processJob(lead.deps(llm), (await claimJob(lead.db, job, 'pc', 'now'))!);
    expect(paused).toMatchObject({ status: 'paused', error: { kind: 'plan_limit', message: '5시간 한도' } });

    await expect(as(PEOPLE.qa).api.retryJob(PROJECT, job.id)).rejects.toBeInstanceOf(PermissionError);
    await lead.api.retryJob(PROJECT, job.id);
    const [again] = await pendingJobs(lead.db, lead.uid);
    expect(again).toMatchObject({ id: job.id, status: 'queued' });
    expect(again).not.toHaveProperty('error');

    // 멈춘 이유가 진행 기록에 남고, 다시 처리하면 "다시 시작"만 더해진다 (같은 기록이 두 번 생기지 않는다)
    const before = await lead.api.listJobEvents(PROJECT, job.id);
    expect([...new Set(before.map((e) => e.kind))].sort()).toEqual(['plan', 'prep_flow', 'start', 'stop', 'warning']);
    expect(before.find((e) => e.kind === 'stop')!.text).toContain('5시간 한도');
    await processJob(lead.deps(fakeGeneratorLlm().llm), (await claimJob(lead.db, again as QaDocJob, 'pc', 'now'))!);
    const after = await lead.api.listJobEvents(PROJECT, job.id);
    expect(after.filter((e) => e.kind === 'start').map((e) => e.id)).toEqual(['start', `restart-${before.length}`]);
    expect(after.filter((e) => e.kind === 'plan')).toHaveLength(1);
    expect(after.filter((e) => e.kind === 'warning')).toHaveLength(before.filter((e) => e.kind === 'warning').length + 1);
  });

  it('Viewer는 요청할 수 없고, 스펙 묶음은 만든 뒤 바꿀 수 없다', async () => {
    await expect(
      as(PEOPLE.planner).api.requestQaDoc(PROJECT, { appVersion: '2.0.0', files: FILES }),
    ).rejects.toBeInstanceOf(PermissionError);

    const lead = as(PEOPLE.lead);
    const job = await lead.api.requestQaDoc(PROJECT, { appVersion: '2.0.0', files: FILES });
    const { doc, updateDoc } = await import('firebase/firestore');
    await expect(
      updateDoc(doc(lead.db, 'projects', PROJECT, 'specBundles', job.input.bundleId), { appVersion: '9.9.9' }),
    ).rejects.toThrow();
  });

  it('호스트 연결 신호는 연결된 그 호스트만 쓰고 본인 웹에서 보인다 (F-TM-14)', async () => {
    const lead = as(PEOPLE.lead);
    await env.withSecurityRulesDisabled(async (c) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(c.firestore() as unknown as Firestore, 'hostConnections/mbp'), { id: 'mbp', uid: lead.uid });
    });
    // 호스트 토큰(host 클레임)으로 접속한 호스트
    const hostDb = env.authenticatedContext(lead.uid, { host: 'mbp' }).firestore() as unknown as Firestore;
    const beat = { id: 'mbp', name: 'MacBook Pro', lastSeen: '2026-10-22T10:00:00Z' };
    await heartbeat(hostDb, lead.uid, beat);
    expect(await lead.api.myHosts()).toEqual([beat]);
    expect(await as(PEOPLE.qa).api.myHosts()).toEqual([]);
    // 사람(웹) 세션이나 다른 사람은 쓰지 못한다
    await expect(heartbeat(lead.db, lead.uid, beat)).rejects.toThrow();
    await expect(heartbeat(as(PEOPLE.qa).db, lead.uid, { ...beat, id: 'x' })).rejects.toThrow();
  });
});
