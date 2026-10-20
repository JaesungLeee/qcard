import { describe, expect, it } from 'vitest';
import { ConflictError } from './api';
import type { LocalRun } from './localRuns';
import { createMemoryApi, passRate } from './memory';

const DOC = 'doc-130';
const CYCLE = 'cycle-130-1';

describe('QA 문서 편집·승인', () => {
  it('rev가 맞으면 저장되고 rev가 오른다', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases[0]!;
    const saved = await api.updateCase(DOC, tc.tcId, { ...tc, title: '수정한 제목' }, tc.rev);
    expect(saved.rev).toBe(tc.rev + 1);
    expect(saved.title).toBe('수정한 제목');
  });

  it('다른 사람이 먼저 저장했으면 ConflictError로 최신 내용을 돌려준다 (F-QD-09)', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases[0]!;
    await api.updateCase(DOC, tc.tcId, { ...tc, title: '먼저 저장' }, tc.rev);
    const err = await api.updateCase(DOC, tc.tcId, { ...tc, title: '나중 저장' }, tc.rev).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).latest.title).toBe('먼저 저장');
  });

  it('승인된 케이스의 내용이 바뀌면 자동으로 미승인 (F-QD-10)', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases.find((c) => c.approval.status === 'approved')!;
    const same = await api.updateCase(DOC, tc.tcId, { ...tc }, tc.rev);
    expect(same.approval.status).toBe('approved');
    const changed = await api.updateCase(DOC, tc.tcId, { ...tc, priority: 'low' }, same.rev);
    expect(changed.approval.status).toBe('pending');
  });

  it('승인은 현재 내용 해시로 기록된다', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases.find((c) => c.approval.status === 'pending')!;
    await api.setApproval(DOC, [tc.tcId], 'approved');
    const after = (await api.getQaDoc(DOC)).cases.find((c) => c.tcId === tc.tcId)!;
    expect(after.approval).toMatchObject({ status: 'approved', contentHash: tc.contentHash });
  });

  it('"현 스펙대로 진행"하면 그 질문에 묶인 보류 케이스가 미승인으로 풀린다 (F-QD-03)', async () => {
    const api = createMemoryApi();
    const doc = await api.getQaDoc(DOC);
    const q = doc.questions.find((x) => x.status === 'open')!;
    const held = doc.cases.filter((c) => q.caseIds.includes(c.tcId));
    expect(held.every((c) => c.approval.status === 'held')).toBe(true);
    await api.resolveQuestion(DOC, q.id, { kind: 'proceed' });
    const after = await api.getQaDoc(DOC);
    for (const c of held) expect(after.cases.find((x) => x.tcId === c.tcId)!.approval.status).toBe('pending');
  });
});

describe('사이클 판정', () => {
  it('사람이 확정하면 판정 주체·이력이 남는다 (F-RP-04)', async () => {
    const api = createMemoryApi();
    const { results } = await api.getCycle(CYCLE);
    const check = results.find((r) => r.verdict === 'check')!;
    const r = await api.confirmVerdict({
      cycleId: CYCLE,
      tcId: check.tcId,
      deviceId: check.deviceId,
      verdict: 'pass',
      note: '확인함',
    });
    expect(r.decidedBy).toEqual({ kind: 'human', name: api.currentUser });
    expect(r.history.at(-1)).toMatchObject({ from: 'check', to: 'pass', by: api.currentUser });
  });

  it('통과율은 N/T를 분모에서 뺀다', () => {
    expect(passRate({ pass: 8, fail: 1, blocked: 1, check: 0, nt: 90, na: 0 })).toBeCloseTo(0.8);
  });

  it('사이클 요약의 칸 수는 스냅샷 × 대상 디바이스', async () => {
    const api = createMemoryApi();
    const [summary] = await api.listCycles('haru');
    expect(summary!.total).toBe(summary!.cycle.snapshot.length * summary!.cycle.targets.length);
  });
});

describe('로컬 실행', () => {
  const run = (over: Partial<LocalRun> = {}): LocalRun => ({
    id: '2026-10-20T08-26-50-756Z',
    startedAt: '2026-10-20T08:26:50.756Z',
    finishedAt: '2026-10-20T08:28:30.000Z',
    device: { model: 'SM-S711N', osMajor: 16, size: { w: 1080, h: 2340 } },
    appPackage: 'com.example.harukong.qa',
    docId: DOC,
    results: [
      {
        tcId: 'TC-ONBOARDING-001',
        deviceId: 'SM-S711N-16',
        verdict: 'pass',
        agentVerdict: 'pass',
        autoConfirmed: true,
        unmetConditions: [],
        attempts: 1,
        steps: [],
        points: [],
        history: [],
      },
    ],
    ...over,
  });

  it('실행 하나가 사이클 하나가 되고, 실행한 케이스·기기만 담는다', async () => {
    const api = createMemoryApi({ localRuns: async () => [run()] });
    const local = (await api.listCycles('haru')).find((s) => s.cycle.origin === 'local_run')!;
    expect(local.cycle.id).toBe('run-2026-10-20T08-26-50-756Z');
    expect(local.cycle.targets.map((t) => t.id)).toEqual(['SM-S711N-16']);
    expect(local).toMatchObject({ total: 1, done: 1, passRate: 1 });
    expect(local.build.packageName).toBe('com.example.harukong.qa');
    const detail = await api.getCycle(local.cycle.id);
    expect(detail.cases.map((c) => c.tcId)).toEqual(['TC-ONBOARDING-001']);
  });

  it('로컬 실행 결과도 사람이 확정할 수 있다', async () => {
    const api = createMemoryApi({ localRuns: async () => [run()] });
    const r = await api.confirmVerdict({
      cycleId: 'run-2026-10-20T08-26-50-756Z',
      tcId: 'TC-ONBOARDING-001',
      deviceId: 'SM-S711N-16',
      verdict: 'check',
      note: '다시 볼 것',
    });
    expect(r.history.at(-1)).toMatchObject({ from: 'pass', to: 'check' });
  });

  it('없는 QA 문서를 가리키는 실행은 건너뛰고, 한 번만 읽는다', async () => {
    let calls = 0;
    const api = createMemoryApi({
      localRuns: async () => {
        calls++;
        return [run({ docId: 'doc-x' })];
      },
    });
    await api.listCycles('haru');
    await api.listCycles('haru');
    expect(calls).toBe(1);
    expect((await api.listCycles('haru')).some((s) => s.cycle.origin === 'local_run')).toBe(false);
  });
});
