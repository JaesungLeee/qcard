import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { fakeClock } from '@qcard/agent';
import { createFirebaseApi, writeAll } from '@qcard/data/firebase';
import { seedDocs } from '@qcard/data/seed';
import { FakeDevice } from '@qcard/device';
import { APP_PACKAGE, GITHUB, onboardingScenario, PEOPLE } from '@qcard/fixtures';
import { createLlm, PlanLimitError, UsageMeter, type LlmClient } from '@qcard/llm';
import { doc, getDoc, setLogLevel, type Firestore } from 'firebase/firestore';
import { getBytes, ref, type FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { firestoreApply, runCycle, runSink, UploadQueue, type RunTarget } from '../src';

/*
 * 호스트 에이전트 실행 → Firestore·Storage 업로드를 에뮬레이터·보안 규칙 위에서 확인한다.
 * LLM은 packages/agent e2e가 녹화한 실제 모델 응답을 재생하고, 디바이스는 합성 온보딩 앱(FakeDevice)이다.
 */

setLogLevel('silent');
const ROOT = resolve(import.meta.dirname, '../../..');
const CASSETTES = join(ROOT, 'packages/agent/cassettes');
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

const REF = { projectId: 'haru', cycleId: 'cycle-130-1' };
const DEVICE = 'galaxy-s24-15';

async function host(name: string, runId = 'run-host-1') {
  const ctx = env.authenticatedContext(GITHUB[name]!);
  const db = ctx.firestore() as unknown as Firestore;
  const storage = ctx.storage() as unknown as FirebaseStorage;
  const api = createFirebaseApi({
    db,
    storage,
    user: () => ({ uid: GITHUB[name]!, name }),
    call: () => Promise.reject(new Error('호스트 에이전트는 callable을 쓰지 않는다')),
  });
  const target: RunTarget = { ...REF, deviceId: DEVICE, runId, executor: name, screen: { w: 1080, h: 2340 } };
  const queue = await new UploadQueue(mkdtempSync(join(tmpdir(), 'qcard-queue-')), firestoreApply(db, storage), {
    retryMs: 50,
  }).open();
  return { db, api, sink: runSink(queue, target), queue };
}

/** 케이스마다 녹화 폴더가 다르다 (packages/agent e2e와 같은 녹화를 재생) */
const replay: LlmClient = {
  create: (req, meta) => createLlm({ mode: 'replay', cassetteDir: join(CASSETTES, meta.caseId!) }).create(req, meta),
};

const agentEnv = (llm: LlmClient) => ({
  device: new FakeDevice(onboardingScenario()),
  llm,
  appPackage: APP_PACKAGE,
  clock: fakeClock(Date.UTC(2026, 9, 20)),
  vision: false,
});

describe('runCycle → Firestore·Storage', () => {
  it('케이스를 실행해 결과·스크린샷을 올리고, 웹 API로 바로 읽힌다', async () => {
    const { db, api, sink } = await host(PEOPLE.lead);
    const before = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    );
    const out = await runCycle({
      api,
      sink,
      env: agentEnv(replay),
      ...REF,
      deviceId: DEVICE,
      runId: 'run-host-1',
      tcIds: ['TC-ONBOARDING-004'],
      meter: new UsageMeter({ maxCallsPerCase: 40 }),
    });
    expect(out.status).toBe('done');
    expect(out.results.map((r) => r.verdict)).toEqual(['pass']);

    const after = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    )!;
    expect(after).toMatchObject({ verdict: 'pass', runId: 'run-host-1', attempts: before!.attempts + 1 });
    // 스크린샷은 다운로드 URL이 아니라 Storage 경로로 남는다 — 멤버만 보안 규칙을 거쳐 읽는다
    const shot = after.steps[0]!.screenshot;
    expect(shot).toMatchObject({ kind: 'storage', w: 1080, h: 2340 });
    const path = (shot as { path: string }).path;
    expect(path).toMatch(/^projects\/haru\/cycles\/cycle-130-1\/runs\/run-host-1\/TC-ONBOARDING-004\/obs-\d\d\.png$/);
    expect(await api.screenshotUrl(path)).toMatch(/^blob:/);
    const outsider = env.authenticatedContext('outsider').storage() as unknown as FirebaseStorage;
    await expect(getBytes(ref(outsider, path))).rejects.toThrow();

    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-1'))).data();
    expect(run).toMatchObject({ status: 'done', executor: PEOPLE.lead, deviceId: DEVICE });
    expect(run?.currentTcId).toBeUndefined();
  });

  it('플랜 한도에 닿으면 결과를 쓰지 않고 Run을 일시정지한다', async () => {
    const { db, api, sink } = await host(PEOPLE.lead, 'run-host-2');
    const limited: LlmClient = { create: () => Promise.reject(new PlanLimitError('5시간 한도')) };
    const out = await runCycle({ api, sink, env: agentEnv(limited), ...REF, deviceId: DEVICE, runId: 'run-host-2' });
    expect(out).toMatchObject({ status: 'paused', reason: 'plan_limit', results: [] });
    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-2'))).data();
    expect(run).toMatchObject({ status: 'paused', pauseReason: 'plan_limit' });
    // 화면에 "일시정지 · 플랜 한도"로 보인다 (웹 API)
    const runs = (await api.getCycle(REF)).runs;
    expect(runs.find((r) => r.id === 'run-host-2')).toMatchObject({ status: 'paused', pauseReason: 'plan_limit' });
  });

  it('Viewer는 실행 결과를 올릴 수 없다 (보안 규칙 — 큐가 멈추고 알린다)', async () => {
    const { api, sink, queue } = await host(PEOPLE.planner, 'run-host-3');
    await expect(
      runCycle({ api, sink, env: agentEnv(replay), ...REF, deviceId: DEVICE, runId: 'run-host-3' }),
    ).rejects.toThrow('업로드 실패');
    expect(await queue.pending()).toBeGreaterThan(0); // 보내지 못한 작업은 로컬에 남는다
  });

  it('사이클의 대상 디바이스가 아니면 시작하지 않는다', async () => {
    const { api, sink } = await host(PEOPLE.lead);
    await expect(
      runCycle({ api, sink, env: agentEnv(replay), ...REF, deviceId: 'sm-s711n-16', runId: 'x' }),
    ).rejects.toThrow('대상 디바이스가 아닙니다');
  });
});
