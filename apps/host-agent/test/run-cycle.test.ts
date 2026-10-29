import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { fakeClock } from '@qcard/agent';
import { createFirebaseApi, writeAll } from '@qcard/data/firebase';
import { seedDocs } from '@qcard/data/seed';
import { DeviceDisconnectedError, FakeDevice } from '@qcard/device';
import { APP_PACKAGE, GITHUB, onboardingScenario, PEOPLE } from '@qcard/fixtures';
import { ClaudeCodeSetupError, createLlm, PlanLimitError, SecretVault, UsageMeter, type LlmClient } from '@qcard/llm';
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, updateDoc, type Firestore } from 'firebase/firestore';
import { getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ConsoleHome, ConsoleServerMessage } from '@qcard/shared';
import {
  ConsoleService,
  firestoreApply,
  runCycle,
  runSink,
  startRunJobs,
  UploadQueue,
  type ConsoleServiceDeps,
  type RunTarget,
} from '../src';

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
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore() as unknown as Firestore;
    await writeAll(db, seedDocs());
    // 사람마다 연결된 PC 하나 (호스트는 호스트 토큰으로 쓴다, F-TM-14)
    await writeAll(
      db,
      Object.values(GITHUB).map((uid) => [`hostConnections/${hostOf(uid)}`, { id: hostOf(uid), uid }]),
    );
  });
});

const hostOf = (uid: string) => `pc-${uid}`;
const REF = { projectId: 'haru', cycleId: 'cycle-130-1' };
const DEVICE = 'galaxy-s24-15';

/** 그 사람의 PC에서 도는 호스트 에이전트 (호스트 토큰) */
async function host(name: string, runId = 'run-host-1') {
  const uid = GITHUB[name]!;
  const ctx = env.authenticatedContext(uid, { host: hostOf(uid) });
  const db = ctx.firestore() as unknown as Firestore;
  const storage = ctx.storage() as unknown as FirebaseStorage;
  const api = createFirebaseApi({
    db,
    storage,
    user: () => ({ uid: GITHUB[name]!, name }),
    call: () => Promise.reject(new Error('호스트 에이전트는 callable을 쓰지 않는다')),
  });
  const target: RunTarget = {
    ...REF,
    deviceId: DEVICE,
    runId,
    executor: name,
    executorUid: uid,
    hostId: hostOf(uid),
    screen: { w: 1080, h: 2340 },
  };
  const queue = await new UploadQueue(mkdtempSync(join(tmpdir(), 'qcard-queue-')), firestoreApply(db, storage), {
    retryMs: 50,
  }).open();
  return { db, storage, api, sink: runSink(queue, target), queue, target };
}

/** 케이스마다 녹화 폴더가 다르다 (packages/agent e2e와 같은 녹화를 재생) */
const replay: LlmClient = {
  create: (req, meta) => createLlm({ mode: 'replay', cassetteDir: join(CASSETTES, meta.caseId!) }).create(req, meta),
};

const agentEnv = (llm: LlmClient, device = new FakeDevice(onboardingScenario())) => ({
  device,
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
    // 이전 시도는 요약이 결과에, 전체 내용이 attempts에 남는다 (F-CY-04). 판정 이력도 그대로다
    expect(after.previousAttempts?.at(-1)).toMatchObject({
      attempt: before!.attempts,
      verdict: before!.verdict,
      runId: before!.runId,
    });
    expect(after.history).toEqual(before!.history);
    const kept = await getDoc(
      doc(db, `projects/haru/cycles/cycle-130-1/attempts/TC-ONBOARDING-004__${DEVICE}__${before!.attempts}`),
    );
    expect(kept.data()).toMatchObject({ verdict: before!.verdict, runId: before!.runId, steps: before!.steps });
    // 스크린샷은 다운로드 URL이 아니라 Storage 경로로 남는다 — 멤버만 보안 규칙을 거쳐 읽는다
    const shot = after.steps[0]!.screenshot;
    expect(shot).toMatchObject({ kind: 'storage', w: 1080, h: 2340 });
    const path = (shot as { path: string }).path;
    expect(path).toMatch(/^projects\/haru\/cycles\/cycle-130-1\/runs\/run-host-1\/TC-ONBOARDING-004\/obs-\d\d\.png$/);
    expect(await api.screenshotUrl(path)).toMatch(/^blob:/);
    const outsider = env.authenticatedContext('outsider').storage() as unknown as FirebaseStorage;
    await expect(getBytes(ref(outsider, path))).rejects.toThrow();
    // 스크린샷은 그 Run을 실행한 사용자의 호스트만 올린다 — 같은 사람의 웹 세션도, 다른 사람의 호스트도 못 한다 (PRD §8)
    const png = new Uint8Array([137, 80, 78, 71]);
    const web = env.authenticatedContext(GITHUB[PEOPLE.lead]!).storage() as unknown as FirebaseStorage;
    await expect(uploadBytes(ref(web, path.replace('obs-', 'fake-')), png)).rejects.toThrow();
    const qaHost = (await host(PEOPLE.qa)).storage;
    await expect(uploadBytes(ref(qaHost, path.replace('obs-', 'fake-')), png)).rejects.toThrow();

    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-1'))).data();
    expect(run).toMatchObject({
      status: 'done',
      executor: PEOPLE.lead,
      executorUid: GITHUB[PEOPLE.lead],
      hostId: hostOf(GITHUB[PEOPLE.lead]!),
      deviceId: DEVICE,
    });
    expect(run?.currentTcId).toBeUndefined();
  });

  it('같은 시도를 다시 보내면(업로드 재시도) 이전 시도로 보관하지 않는다', async () => {
    const { db, storage, api } = await host(PEOPLE.lead);
    const before = (await api.getCycle(REF)).results.find((r) => r.verdict !== 'nt' && r.deviceId === DEVICE)!;
    const path = `projects/haru/cycles/cycle-130-1/results/${before.tcId}__${DEVICE}`;
    const rerun = {
      ...before,
      verdict: 'fail',
      decidedBy: { kind: 'agent' },
      runId: 'run-x',
      executedAt: '2026-10-23T10:00:00.000Z',
      history: [],
    };
    await setDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-x'), {
      id: 'run-x',
      executorUid: GITHUB[PEOPLE.lead],
      hostId: hostOf(GITHUB[PEOPLE.lead]!),
    });
    const apply = firestoreApply(db, storage);
    await apply({ type: 'result', path, data: rerun });
    await apply({ type: 'result', path, data: rerun });
    const after = (await api.getCycle(REF)).results.find((r) => r.tcId === before.tcId && r.deviceId === DEVICE)!;
    expect(after.attempts).toBe(before.attempts + 1);
    expect(after.previousAttempts).toHaveLength((before.previousAttempts?.length ?? 0) + 1);
  });

  it('플랜 한도에 닿으면 결과를 쓰지 않고 Run을 일시정지한다', async () => {
    const { db, api, sink } = await host(PEOPLE.lead, 'run-host-2');
    const until = '2026-10-20T05:30:00.000Z';
    const limited: LlmClient = { create: () => Promise.reject(new PlanLimitError('플랜 한도', until)) };
    const out = await runCycle({ api, sink, env: agentEnv(limited), ...REF, deviceId: DEVICE, runId: 'run-host-2' });
    // 풀리는 시각을 알면 함께 돌려준다 (콘솔 상단에 보인다, F-DB-09)
    expect(out).toMatchObject({ status: 'paused', reason: 'plan_limit', limitedUntil: until, results: [] });
    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-2'))).data();
    expect(run).toMatchObject({ status: 'paused', pauseReason: 'plan_limit' });
    // 화면에 "일시정지 · 플랜 한도"로 보인다 (웹 API)
    const runs = (await api.getCycle(REF)).runs;
    expect(runs.find((r) => r.id === 'run-host-2')).toMatchObject({ status: 'paused', pauseReason: 'plan_limit' });
  });

  it('실행 중 Claude Code가 없어지면 "설치 필요"로 일시정지한다 (로그인 필요와 구분)', async () => {
    const { db, api, sink } = await host(PEOPLE.lead, 'run-host-3');
    const missing: LlmClient = {
      create: () =>
        Promise.reject(new ClaudeCodeSetupError('not_installed', 'Claude Code(claude)가 설치되어 있지 않습니다')),
    };
    const out = await runCycle({ api, sink, env: agentEnv(missing), ...REF, deviceId: DEVICE, runId: 'run-host-3' });
    expect(out).toMatchObject({ status: 'paused', reason: 'claude_not_installed' });
    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-3'))).data();
    expect(run).toMatchObject({ status: 'paused', pauseReason: 'claude_not_installed' });
  });

  it('배정할 테스트 계정이 없으면 LLM을 부르지 않고 Blocked("계정 없음")로 올리고, 다음 케이스로 간다 (F-PF-04)', async () => {
    const { api, sink } = await host(PEOPLE.lead, 'run-host-acct');
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore() as unknown as Firestore;
      await updateDoc(doc(db, 'projects/haru/cycles/cycle-130-1/cases/TC-ONBOARDING-004'), { accountKind: '구독자' });
    });
    const claims: string[] = [];
    const noLlm: LlmClient = { create: () => Promise.reject(new Error('LLM을 부르면 안 된다')) };
    const out = await runCycle({
      api,
      sink,
      env: { ...agentEnv(noLlm), vault: new SecretVault() },
      ...REF,
      deviceId: DEVICE,
      runId: 'run-host-acct',
      tcIds: ['TC-ONBOARDING-004'],
      accounts: {
        claim: async (input) => {
          claims.push(`${input.tcId}:${input.kind}`);
          return { account: null };
        },
        release: async () => {},
      },
    });
    expect(claims).toEqual(['TC-ONBOARDING-004:구독자']);
    expect(out.status).toBe('done');
    const r = (await api.getCycle(REF)).results.find((x) => x.tcId === 'TC-ONBOARDING-004' && x.deviceId === DEVICE)!;
    expect(r).toMatchObject({ verdict: 'blocked', blockedReason: '계정 없음: 구독자 종류의 빈 계정이 없습니다' });
  });

  it('디바이스가 잠겨 있으면 LLM을 부르지 않고 Run을 일시정지한다', async () => {
    const { db, api, sink } = await host(PEOPLE.lead, 'run-host-4');
    const device = new FakeDevice(onboardingScenario());
    device.display = { awake: false, locked: true };
    const never: LlmClient = { create: () => Promise.reject(new Error('부르면 안 된다')) };
    const out = await runCycle({
      api,
      sink,
      env: agentEnv(never, device),
      ...REF,
      deviceId: DEVICE,
      runId: 'run-host-4',
    });
    expect(out).toMatchObject({ status: 'paused', reason: 'device_locked', results: [] });
    expect(out.status === 'paused' && out.message).toContain('꺼져');
    const run = (await getDoc(doc(db, 'projects/haru/cycles/cycle-130-1/runs/run-host-4'))).data();
    expect(run).toMatchObject({ status: 'paused', pauseReason: 'device_locked' });
  });

  it('실행 중 잠겨 Blocked로 끝난 케이스는 결과를 버리고 일시정지한다 (재개하면 그 케이스부터)', async () => {
    const { api, sink } = await host(PEOPLE.lead, 'run-host-5');
    const device = new FakeDevice(onboardingScenario());
    // 첫 호출 때 화면이 잠기고, Agent는 진행할 수 없다며 멈춘다
    const lockAndGiveUp: LlmClient = {
      create: async (req) => {
        device.display = { awake: true, locked: true };
        return {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: req.model,
          content: [{ type: 'tool_use', id: 't1', name: 'give_up', input: { kind: 'stuck', reason: '잠금 화면' } }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as never;
      },
    };
    const before = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    );
    const out = await runCycle({
      api,
      sink,
      env: agentEnv(lockAndGiveUp, device),
      ...REF,
      deviceId: DEVICE,
      runId: 'run-host-5',
      tcIds: ['TC-ONBOARDING-004'],
    });
    expect(out).toMatchObject({ status: 'paused', reason: 'device_locked', results: [] });
    expect(out.status === 'paused' && out.message).toContain('TC-ONBOARDING-004 실행 중');
    const after = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    );
    expect(after).toEqual(before);
  });

  it('실행 중 디바이스 연결이 끊기면 그 케이스 결과는 버리고 "연결 끊김"으로 일시정지한다', async () => {
    const { api, sink } = await host(PEOPLE.lead, 'run-host-6');
    const device = new FakeDevice(onboardingScenario());
    // 첫 액션(탭)에서 USB가 빠진다
    device.tap = () => Promise.reject(new DeviceDisconnectedError('디바이스 연결이 끊겼습니다'));
    const before = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    );
    const out = await runCycle({
      api,
      sink,
      env: agentEnv(replay, device),
      ...REF,
      deviceId: DEVICE,
      runId: 'run-host-6',
      tcIds: ['TC-ONBOARDING-004'],
    });
    expect(out).toMatchObject({ status: 'paused', reason: 'device_disconnected', results: [] });
    expect(out.status === 'paused' && out.message).toContain('USB를 다시 연결');
    const after = (await api.getCycle(REF)).results.find(
      (r) => r.tcId === 'TC-ONBOARDING-004' && r.deviceId === DEVICE,
    );
    expect(after).toEqual(before);

    // 시작 전에 이미 빠져 있으면 LLM을 부르지 않고 일시정지
    const { api: api2, sink: sink2 } = await host(PEOPLE.lead, 'run-host-7');
    const gone = new FakeDevice(onboardingScenario());
    gone.screenState = () => Promise.reject(new DeviceDisconnectedError('x'));
    const never: LlmClient = { create: () => Promise.reject(new Error('부르면 안 된다')) };
    expect(
      await runCycle({
        api: api2,
        sink: sink2,
        env: agentEnv(never, gone),
        ...REF,
        deviceId: DEVICE,
        runId: 'run-host-7',
      }),
    ).toMatchObject({ status: 'paused', reason: 'device_disconnected' });
  });

  it('Viewer는 실행 결과를 올릴 수 없다 (보안 규칙 — 거절된 작업은 빼고 Run을 멈춘다)', async () => {
    const { api, sink, queue } = await host(PEOPLE.planner, 'run-host-3');
    await expect(
      runCycle({ api, sink, env: agentEnv(replay), ...REF, deviceId: DEVICE, runId: 'run-host-3' }),
    ).rejects.toThrow('업로드 실패');
    // 남은 작업은 다음 Run이 보내 보고, 거절되면 그 Run을 멈추지 않고 dropped로 뺀다 (뒤의 업로드를 막지 않는다)
    queue.retry();
    expect(await queue.drain()).toBe(0);
  });

  it('사이클의 대상 디바이스가 아니면 시작하지 않는다', async () => {
    const { api, sink } = await host(PEOPLE.lead);
    await expect(
      runCycle({ api, sink, env: agentEnv(replay), ...REF, deviceId: 'sm-s711n-16', runId: 'x' }),
    ).rejects.toThrow('대상 디바이스가 아닙니다');
  });
});

// ---------------------------------------------------------------- 상주 호스트의 로컬 콘솔 (PRD §4 ⑤)

describe('로컬 콘솔 서비스 (serve)', () => {
  /** 시드 사이클 cycle-130-1의 대상(Galaxy S24 · Android 15)과 같은 가짜 디바이스 */
  const galaxy = () => {
    const s = onboardingScenario();
    return new FakeDevice({ ...s, info: { ...s.info, model: 'Galaxy S24' } });
  };
  const serviceFor = async (device: FakeDevice, more: Partial<ConsoleServiceDeps> = {}) => {
    const { api, storage, queue, target } = await host(PEOPLE.lead, 'unused');
    const msgs: ConsoleServerMessage[] = [];
    const service = new ConsoleService({
      api,
      storage,
      queue,
      executor: PEOPLE.lead,
      account: { uid: target.executorUid, hostId: target.hostId },
      claudeCode: () => ({ installed: true, loggedIn: true }),
      log: () => {},
      fallbackPackage: APP_PACKAGE,
      llm: () => replay,
      env: { clock: fakeClock(Date.UTC(2026, 9, 20)), vision: false },
      awakeDir: mkdtempSync(join(tmpdir(), 'qcard-awake-')),
      dashboardUrl: 'https://qcard.example',
      ...more,
    });
    service.subscribe((m) => msgs.push(m));
    service.setDevice({ driver: device, info: await device.info() });
    await service.refresh();
    const home = () => (msgs.filter((m) => m.type === 'home').at(-1) as { home: ConsoleHome }).home;
    return { service, msgs, home };
  };

  it('접속하면 먼저 웹 대시보드 주소를 알려 준다 (127.0.0.1 콘솔의 [대시보드에서 보기])', async () => {
    const { msgs } = await serviceFor(galaxy());
    expect(msgs[0]).toEqual({ type: 'info', dashboardUrl: 'https://qcard.example' });
  });

  it('홈에 이 디바이스가 대상인 사이클을 보이고, Run을 시작하면 실행 화면 → 끝나면 홈으로 돌아온다', async () => {
    const device = galaxy();
    const { service, msgs, home } = await serviceFor(device);
    const option = home().cycles.find((c) => c.cycleId === 'cycle-130-1');
    expect(option).toMatchObject({ projectId: 'haru', deviceId: DEVICE });
    expect(option!.cases.some((c) => c.tcId === 'TC-ONBOARDING-004')).toBe(true);
    // 대상이 아닌 사이클은 보이지 않는다
    expect(home().cycles.every((c) => c.deviceId === DEVICE)).toBe(true);

    service.handle({ type: 'start', projectId: 'haru', cycleId: 'cycle-130-1', tcIds: ['TC-ONBOARDING-004'] });
    for (let i = 0; i < 100 && !service.running; i++) await new Promise((r) => setTimeout(r, 20));
    expect(service.running).toBe(true);
    await service.idle();

    const states = msgs.filter((m) => m.type === 'state');
    expect(states.length).toBeGreaterThan(0);
    expect(msgs.at(-1)?.type).toBe('home');
    expect(home().lastRun).toMatchObject({ status: 'done', judged: 1 });
    // Run 동안만 화면 켜짐 유지를 켰다가 되돌렸다
    expect(device.log.filter((l) => l.startsWith('stay-on'))).toEqual(['stay-on 7', 'stay-on 0']);
    expect(service.running).toBe(false);
  });

  it('남은 케이스에 필요한데 배정할 계정이 없는 종류를 홈에 알린다 (F-PF-08)', async () => {
    const C = 'projects/haru/cycles/cycle-130-1';
    const tc = 'TC-ONBOARDING-004';
    const write = (fn: (db: Firestore) => Promise<void>) =>
      env.withSecurityRulesDisabled((c) => fn(c.firestore() as unknown as Firestore));
    await write(async (db) => {
      // 남은 칸으로 만든다 (N/T)
      await updateDoc(doc(db, `${C}/results/${tc}__${DEVICE}`), { verdict: 'nt' });
      await updateDoc(doc(db, `${C}/cases/${tc}`), { accountKind: '기본' });
      // 기본 계정은 하나 있고 비어 있다. 구독자 계정은 격리돼 배정할 수 없다
      const base = {
        projectId: 'haru',
        usesTotp: false,
        createdAt: 'x',
        createdBy: 'x',
        secretUpdated: { by: 'x', at: 'x' },
      };
      await setDoc(doc(db, 'projects/haru/accounts/a1'), { ...base, id: 'a1', kind: '기본', loginId: 'a1' });
      await setDoc(doc(db, 'projects/haru/accounts/s1'), {
        ...base,
        id: 's1',
        kind: '구독자',
        loginId: 's1',
        quarantine: { reason: 'restore_failed', at: 'x', cycleId: 'c', runId: 'r', tcId: 't' },
      });
    });
    const { home } = await serviceFor(galaxy());
    const option = () => home().cycles.find((c) => c.cycleId === 'cycle-130-1')!;
    expect(option().accountShortage).toBeUndefined();

    await write((db) => updateDoc(doc(db, `${C}/cases/${tc}`), { accountKind: '구독자' }));
    const again = await serviceFor(galaxy());
    expect(again.home().cycles.find((c) => c.cycleId === 'cycle-130-1')!.accountShortage).toEqual([
      { kind: '구독자', cases: 1 },
    ]);
  });

  it('Claude Code를 쓸 수 없으면 Run을 시작하지 않고 해결 방법을 알린다 — 디바이스는 건드리지 않는다 (F-EX-17)', async () => {
    const device = galaxy();
    const problem = new ClaudeCodeSetupError(
      'outdated',
      'Claude Code 2.1.250은(는) Sonnet 5.5를 지원하지 않습니다',
      '2.1.284',
    );
    const { service, msgs } = await serviceFor(device, { checkClaudeCode: () => Promise.reject(problem) });
    const out = await service.startRun({ projectId: 'haru', cycleId: 'cycle-130-1', tcIds: ['TC-ONBOARDING-004'] });
    expect(out).toEqual({ error: problem.message });
    expect(msgs.at(-1)).toEqual({ type: 'error', message: problem.message });
    expect(service.running).toBe(false);
    expect(device.log.filter((l) => l.startsWith('stay-on'))).toEqual([]);
  });

  it('플랜 한도에 닿으면 상단에 알리고, 시각이 지나거나 다시 시작하면 푼다 (F-DB-09)', async () => {
    const { service, home } = await serviceFor(galaxy());
    service.planLimited();
    expect(home().claudeCode).toMatchObject({ limited: true });
    expect(home().claudeCode.limitedUntil).toBeUndefined();
    service.planLimited(new Date(Date.now() + 60_000).toISOString());
    expect(home().claudeCode).toMatchObject({ limited: true, limitedUntil: expect.any(String) });
    // 풀리는 시각이 지났다
    service.planLimited(new Date(Date.now() - 1000).toISOString());
    expect(home().claudeCode.limited).toBeUndefined();
    // 시각을 모르면 다시 시작할 때 푼다 (또 닿으면 다시 일시정지한다)
    service.planLimited();
    await service.startRun({ projectId: 'haru', cycleId: 'cycle-130-1', tcIds: ['TC-ONBOARDING-004'] });
    await service.idle();
    expect(home().claudeCode.limited).toBeUndefined();
  });

  it('디바이스가 없어도 Claude Code 상태가 바뀌면 홈에 알린다', async () => {
    const { api, storage, queue, target } = await host(PEOPLE.lead, 'unused');
    let loggedIn = false;
    const msgs: ConsoleServerMessage[] = [];
    const service = new ConsoleService({
      api,
      storage,
      queue,
      executor: PEOPLE.lead,
      account: { uid: target.executorUid, hostId: target.hostId },
      claudeCode: () => ({ installed: true, loggedIn }),
      log: () => {},
    });
    service.subscribe((m) => msgs.push(m));
    loggedIn = true;
    service.claudeCodeChanged();
    service.claudeCodeChanged(); // 그대로면 다시 보내지 않는다
    const homes = msgs.filter((m) => m.type === 'home').map((m) => (m as { home: ConsoleHome }).home);
    expect(homes.map((h) => h.claudeCode?.loggedIn)).toEqual([false, true]);
  });

  it('이어서 실행하면 그 Run의 큐를 다시 돌린다 — 이전 결과가 있어 다시 실행하려고 고른 칸도', async () => {
    // TC-004(시드에 이전 결과 있음)를 다시 실행하려고 골랐다가 연결이 끊겨 멈춘 Run
    const { queue } = await host(PEOPLE.lead, 'unused');
    const paused = runSink(queue, {
      ...REF,
      deviceId: DEVICE,
      runId: 'run-paused',
      executor: PEOPLE.lead,
      executorUid: GITHUB[PEOPLE.lead]!,
      hostId: hostOf(GITHUB[PEOPLE.lead]!),
      screen: { w: 1080, h: 2340 },
    });
    await paused.start(['TC-ONBOARDING-004']);
    await paused.pause('device_disconnected');
    await paused.drain();

    const { service, msgs, home } = await serviceFor(galaxy());
    const option = home().cycles.find((c) => c.cycleId === 'cycle-130-1');
    expect(option?.pausedRun).toMatchObject({ id: 'run-paused', total: 1, left: 1 });

    service.handle({ type: 'start', ...REF, resumeRunId: 'run-paused' });
    for (let i = 0; i < 100 && !service.running; i++) await new Promise((r) => setTimeout(r, 20));
    await service.idle();
    const first = msgs.find((m) => m.type === 'state' && m.state.queue.length > 0);
    expect(first?.type === 'state' && first.state.queue.map((q) => q.tcId)).toEqual(['TC-ONBOARDING-004']);
    // 이번에 결과를 냈으니 더 이어서 실행할 것이 없다
    await service.refresh();
    expect(home().cycles.find((c) => c.cycleId === 'cycle-130-1')?.pausedRun).toBeUndefined();
  });

  it('케이스를 고르지 않고 시작하면 결과가 없는 칸만 돌린다 ([남은 N건 실행])', async () => {
    // 시드는 이 칸의 자동 케이스에 모두 결과가 있다 — TC-004만 비운다
    await env.withSecurityRulesDisabled((c) =>
      deleteDoc(
        doc(
          c.firestore() as unknown as Firestore,
          'projects/haru/cycles/cycle-130-1/results/TC-ONBOARDING-004__' + DEVICE,
        ),
      ),
    );
    const { service, msgs, home } = await serviceFor(galaxy());
    const option = home().cycles.find((c) => c.cycleId === 'cycle-130-1')!;
    expect(option.cases.length).toBeGreaterThan(1);
    expect(option.cases.filter((c) => !c.done).map((c) => c.tcId)).toEqual(['TC-ONBOARDING-004']);

    service.handle({ type: 'start', ...REF });
    let first: ConsoleServerMessage | undefined;
    for (let i = 0; i < 100 && !first; i++) {
      await new Promise((r) => setTimeout(r, 20));
      first = msgs.find((m) => m.type === 'state' && m.state.queue.length > 0);
    }
    service.handle({ type: 'control', action: 'abort' });
    await service.idle();
    expect(first?.type === 'state' && first.state.queue.map((q) => q.tcId)).toEqual(['TC-ONBOARDING-004']);
  });

  it('호스트가 죽어 "실행 중"으로 남은 내 Run은 다시 켤 때 일시정지로 정리해 이어서 실행할 수 있다 (F-DV-04)', async () => {
    const { queue } = await host(PEOPLE.lead, 'unused');
    const dead = runSink(queue, {
      ...REF,
      deviceId: DEVICE,
      runId: 'run-dead',
      executor: PEOPLE.lead,
      executorUid: GITHUB[PEOPLE.lead]!,
      hostId: hostOf(GITHUB[PEOPLE.lead]!),
      screen: { w: 1080, h: 2340 },
    });
    await dead.start(['TC-ONBOARDING-004']);
    await dead.drain();
    // 마지막 신호가 5분 전
    const path = 'projects/haru/cycles/cycle-130-1/runs/run-dead';
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore() as unknown as Firestore, path), {
        heartbeatAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    );

    const { service, home } = await serviceFor(galaxy());
    expect(home().cycles.find((c) => c.cycleId === 'cycle-130-1')?.pausedRun).toMatchObject({
      id: 'run-dead',
      reason: 'host_lost',
    });
    await service.idle();
    await vi.waitFor(async () => {
      let run: unknown;
      await env.withSecurityRulesDisabled(async (c) => {
        run = (await getDoc(doc(c.firestore() as unknown as Firestore, path))).data();
      });
      expect(run).toMatchObject({ status: 'paused', pauseReason: 'host_lost' });
    });
  });

  it('웹에서 요청한 Run 시작을 받아 콘솔과 같은 경로로 시작하고, 작업에 Run id를 남긴다', async () => {
    const { db, api } = await host(PEOPLE.lead, 'unused');
    const { service, msgs } = await serviceFor(galaxy());
    const job = await api.requestRun('haru', {
      cycleId: 'cycle-130-1',
      deviceId: DEVICE,
      tcIds: ['TC-ONBOARDING-004'],
    });
    const [done] = await startRunJobs({
      db,
      uid: GITHUB[PEOPLE.lead]!,
      host: '테스트 맥',
      start: (req) => service.startRun(req),
    });
    expect(done).toMatchObject({
      id: job.id,
      status: 'done',
      host: '테스트 맥',
      result: { runId: expect.any(String) },
    });
    expect(service.running).toBe(true);
    await service.idle();
    const first = msgs.find((m) => m.type === 'state' && m.state.queue.length > 0);
    expect(first?.type === 'state' && first.state.queue.map((q) => q.tcId)).toEqual(['TC-ONBOARDING-004']);
    const saved = (await api.listJobs('haru')).find((j) => j.id === job.id);
    expect(saved).toMatchObject({ status: 'done', result: { runId: done!.result!.runId } });
    // 다시 받아도 같은 요청을 두 번 시작하지 않는다
    expect(
      await startRunJobs({ db, uid: GITHUB[PEOPLE.lead]!, host: '테스트 맥', start: () => Promise.reject() }),
    ).toEqual([]);
  });

  it('폰이 잠겨 있으면 웹 요청을 시작하지 않고 이유를 작업에 남긴다', async () => {
    const { db, api } = await host(PEOPLE.lead, 'unused');
    const device = galaxy();
    const { service } = await serviceFor(device);
    device.display = { awake: true, locked: true };
    await api.requestRun('haru', { cycleId: 'cycle-130-1', deviceId: DEVICE });
    const [failed] = await startRunJobs({
      db,
      uid: GITHUB[PEOPLE.lead]!,
      host: '테스트 맥',
      start: (req) => service.startRun(req),
    });
    expect(failed).toMatchObject({
      status: 'failed',
      error: { kind: 'failed', message: expect.stringMatching(/잠겨/) },
    });
    expect(service.running).toBe(false);
  });

  it('완료된 사이클은 홈에서 빠지고, 시작·이어서 실행 요청도 받지 않는다 (F-CY-09)', async () => {
    const { service, msgs, home } = await serviceFor(galaxy());
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore() as unknown as Firestore, 'projects/haru/cycles/cycle-130-1'), {
        'period.end': '2026-10-27T00:00:00Z',
      }),
    );
    await service.refresh();
    expect(home().cycles.some((c) => c.cycleId === 'cycle-130-1')).toBe(false);
    service.handle({ type: 'start', projectId: 'haru', cycleId: 'cycle-130-1', resumeRunId: 'run-old' });
    for (let i = 0; i < 50 && !msgs.some((m) => m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(msgs.find((m) => m.type === 'error')).toMatchObject({ message: expect.stringMatching(/완료된 사이클/) });
    expect(service.running).toBe(false);
  });

  it('디바이스가 잠겨 있으면 Run을 시작하지 않고 이유를 알린다', async () => {
    const device = galaxy();
    const { service, msgs, home } = await serviceFor(device);
    device.display = { awake: true, locked: true };
    await service.refresh();
    expect(home().deviceProblem).toMatch(/잠겨/);
    service.handle({ type: 'start', projectId: 'haru', cycleId: 'cycle-130-1' });
    for (let i = 0; i < 50 && !msgs.some((m) => m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(msgs.find((m) => m.type === 'error')).toMatchObject({ message: expect.stringMatching(/잠겨/) });
    expect(service.running).toBe(false);
  });
});
