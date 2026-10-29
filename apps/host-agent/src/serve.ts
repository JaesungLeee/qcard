/**
 * 호스트 에이전트 상주 모드: 로컬 콘솔을 띄워 두고(사이클을 골라 Run 시작), 웹에서 요청한 내 작업(QA 문서 생성)을
 * 이 PC의 Claude Code(본인 플랜)로 처리한다.
 *
 *   pnpm --filter @qcard/host serve
 *     --user <시드 사용자>          개발용: 에뮬레이터에서 브라우저 없이 그 사용자 이름으로 연결
 *     --package <앱>               빌드 파일이 없는 사이클(개발 시드)에서 실행할 앱. 에뮬레이터 기본: qcard.local.json의 devApp
 *     --serial <시리얼>            디바이스가 여러 대일 때 (기본: 처음 연결된 것, 1인 1대)
 *     --allow-network              set_network(네트워크 끄기) 허용
 *     --headless                   로컬 콘솔을 띄우지 않는다
 *
 * - 로컬 콘솔: 시작할 때 한 번만 열 수 있는 주소를 출력한다(터미널에서 Enter를 누르면 새 주소). 연결된 폰 화면을 실시간으로 보여 주고, 이 폰이 대상인
 *   사이클을 골라 Run을 시작·이어서 실행한다. 폰을 뺐다 꽂으면 30초 안에 알아챈다
 *
 * - 30초마다 연결 신호(+ Claude Code 상태)를 보내 웹이 "호스트 연결됨"을 표시한다 (F-DB-09)
 * - 웹에서 요청한 Run 시작(작업 kind `run_cycle`)을 받아 로컬 콘솔의 [실행]과 같은 경로로 시작한다. QA 문서 생성 중이어도 기다리지 않는다
 * - 내 작업만 받는다(요청자 = 나). 한 번에 하나씩, 처리 중에는 맥이 잠들지 않게 한다(caffeinate).
 *   케이스 수정안(F-QD-17)은 대기 중인 QA 문서 생성보다 먼저 한다 — 진행 중인 생성은 끊지 않는다
 * - 작업마다 호출을 ~/.qcard/jobs/<작업>/llm에 녹화한다. 플랜 한도로 멈춘 작업을 웹에서 다시 시도하면
 *   끝난 호출은 재생하고 남은 것만 부른다
 *
 * 먼저 `connect`로 이 PC를 계정에 연결해 둔다(F-TM-14). 연결이 해제됐으면 시작하지 않는다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, devAppPackage, listDevices } from '@qcard/device/node';
import {
  claudeCodeProblem,
  claudeCodeStatus,
  createCassetteLlm,
  createLiveLlm,
  MODELS_FOR,
  versionShortfall,
  type ClaudeCodeStatus,
} from '@qcard/llm';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { HostDisconnectedError, openHostSession, targetFromEnv } from './connect';
import { attachScreen, ConsoleService, launchConsole, type OnDemandScreen } from './console';
import { RESTORED, restoreAwake } from './awake';
import { claimJob, heartbeat, HOST_JOBS, pendingJobs, processJob, processReviseJob, startRunJobs } from './jobs';
import { UploadQueue } from './queue';
import { firestoreApply } from './sink';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    package: { type: 'string' },
    serial: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
  },
});
const target = targetFromEnv();
const session = await openHostSession({ seedUser: values.user, target }).catch((e: unknown) => {
  if (!(e instanceof HostDisconnectedError)) throw e;
  console.error(e.message);
  process.exit(1);
});
const { db, storage, api, user, host, account, queueDir, accounts } = session;

// ---------------------------------------------------------------- 연결 신호
/** 연결된 디바이스 (시리얼별 정보는 한 번만 읽는다) — 웹이 사이클 대상을 고를 때 쓴다. 읽기 전용(getprop·wm) */
const known = new Map<string, { serial: string; model: string; osMajor: number; resolution: string }>();
async function devices() {
  const list = await listDevices().catch(() => []);
  const out = [];
  for (const d of list.filter((x) => x.state === 'device')) {
    if (!known.has(d.serial)) {
      const i = await new AdbDriver(d.serial).info().catch(() => undefined);
      if (i)
        known.set(d.serial, {
          serial: d.serial,
          model: i.model,
          osMajor: i.osMajor,
          resolution: `${i.size.w}×${i.size.h}`,
        });
    }
    const k = known.get(d.serial);
    if (k) out.push(k);
  }
  return out;
}

let claude: ClaudeCodeStatus | undefined;
/** Claude Code를 쓸 수 없어 작업을 대기열에 남겨 두었다 (해결되면 연결 신호가 다시 부른다) */
let waitingForClaude = false;
/** Claude Code 상태를 다시 읽는다. 콘솔 홈은 디바이스가 바뀔 때만 다시 읽으므로, Claude Code 상태는 따로 알린다 */
async function readClaude() {
  claude = await claudeCodeStatus();
  service.claudeCodeChanged();
  return claude;
}
async function beat() {
  const s = await readClaude();
  // Claude Code 문제로 미뤄 둔 작업이 있으면, 해결됐는지 30초마다 본다
  if (waitingForClaude && !claudeCodeProblem(s, MODELS_FOR.qadoc)) void drain();
  const required = versionShortfall(s.version, MODELS_FOR.qadoc);
  const list = await devices();
  await useDevice(list.map((d) => d.serial));
  await service.checkDevice();
  await heartbeat(db, user.uid, {
    ...host,
    lastSeen: new Date().toISOString(),
    devices: list,
    claudeCode: {
      version: s.version,
      loggedIn: s.loggedIn,
      subscriptionType: s.subscriptionType,
      ...(required ? { requiredVersion: required } : {}),
    },
    jobs: HOST_JOBS,
    ...(consoleUi ? { consoleUrl: consoleUi.webUrl() } : {}),
  }).catch((e: Error) => console.error(`연결 신호 실패: ${e.message}`));
  return s;
}
// ---------------------------------------------------------------- 로컬 콘솔 (F-DB-01·05, PRD §4 ⑤)
const log = (l: string) => console.log(l);
const queue = await new UploadQueue(queueDir, firestoreApply(db, storage), {
  onDrop: (op, reason) => log(`보내지 못한 업로드를 뺐습니다 (${queueDir}/dropped): ${op.path} — ${reason}`),
}).open();
const service = new ConsoleService({
  api,
  storage,
  queue,
  executor: user.name,
  account,
  accounts,
  claudeCode: () => ({
    installed: claude?.installed ?? true,
    loggedIn: claude?.loggedIn ?? false,
    ...(claude?.version ? { version: claude.version } : {}),
    ...(claude?.subscriptionType ? { plan: claude.subscriptionType } : {}),
    ...(versionShortfall(claude?.version, MODELS_FOR.run)
      ? { requiredVersion: versionShortfall(claude?.version, MODELS_FOR.run) }
      : {}),
  }),
  // 웹에서 요청한 Run도 같은 경로로 시작하므로 여기서 함께 막는다 (F-EX-17)
  checkClaudeCode: async () => {
    const problem = claudeCodeProblem(await readClaude(), MODELS_FOR.run);
    if (problem) throw problem;
  },
  log,
  // 로컬 설정(qcard.local.json)은 저장소에서 개발할 때만 본다
  fallbackPackage: values.package ?? (target.emulator ? devAppPackage() : undefined),
  allowNetworkToggle: values['allow-network'],
  dashboardUrl: target.webUrl,
});
// 웹 사이드바의 [로컬 콘솔]로 들어오면 그 주소는 쓴 것이라, 연결 신호로 새 주소를 바로 올린다
const consoleUi = values.headless ? undefined : await launchConsole(service, log, { onLogin: () => void beat() });
// 터미널에서 Enter를 누르면 새 주소 (다른 브라우저에서 열 때 — 주소는 한 번만 쓸 수 있다)
if (consoleUi && process.stdin.isTTY) {
  log('  (Enter: 새 콘솔 주소)');
  process.stdin.on('data', () => consoleUi.printUrl());
}

/** 이 호스트가 쓰는 디바이스 (1인 1대). 바뀌면 콘솔과 화면 스트림을 새 디바이스로 */
let current: { serial: string; screen?: OnDemandScreen } | undefined;
async function useDevice(serials: string[]) {
  const serial = values.serial ? serials.find((s) => s === values.serial) : serials[0];
  if (serial && serial === current?.serial) {
    // 잠깐 빠졌다 돌아왔거나 화면 스트림을 못 띄운 경우: 화면을 보는 사람이 있으면 다시 띄운다
    current.screen?.wake();
    return;
  }
  if (!serial && !current) return;
  await current?.screen?.stop();
  consoleUi?.server.attachVideo(undefined);
  current = undefined;
  if (!serial) {
    // 빠짐: Run 중이면 Run이 '연결 끊김'으로 일시정지한다
    service.setDevice(undefined);
    log('디바이스 연결이 끊겼습니다');
    return;
  }
  if (service.running) return;
  const driver = new AdbDriver(serial, { allowDestructive: true });
  const info = await driver.info().catch(() => undefined);
  if (!info) return;
  current = { serial };
  if (await restoreAwake(driver, serial, { log }).catch(() => false)) service.notify(RESTORED);
  service.setDevice({ driver, info });
  log(`디바이스: ${info.model} (Android ${info.osMajor}) · ${serial}`);
  if (consoleUi) current.screen = await attachScreen(consoleUi.server, serial, log);
}

const status = await beat();
setInterval(beat, 30_000);
// 디바이스 연결·화면 꺼짐·잠김은 더 자주 본다 (다시 꽂거나 잠금을 풀면 바로 [Run 시작]을 누를 수 있게)
let watching = false;
setInterval(async () => {
  if (watching) return;
  watching = true;
  try {
    const list = await listDevices().catch(() => []);
    await useDevice(list.filter((d) => d.state === 'device').map((d) => d.serial));
    await service.checkDevice();
  } finally {
    watching = false;
  }
}, 5_000);
console.log(`호스트 ${host.name} · ${user.name}(@${user.github})`);
const problem = claudeCodeProblem(status, [...MODELS_FOR.run, ...MODELS_FOR.qadoc]);
console.log(
  problem
    ? `⚠ ${problem.message} (해결할 때까지 Run·QA 문서 생성을 시작하지 않습니다)`
    : `Claude Code ${status.version}${status.subscriptionType ? ` · ${status.subscriptionType} 플랜` : ''}`,
);

// ---------------------------------------------------------------- 작업 처리 (한 번에 하나)
// 작업이 하나 끝날 때마다 대기열을 다시 읽는다 — 긴 QA 문서 생성 중에 들어온 케이스 수정안이 다음 차례가 된다 (F-QD-17)
let busy = false;
let again = false;
async function drain() {
  if (busy) return void (again = true);
  busy = true;
  try {
    for (;;) {
      again = false;
      const job = (await pendingJobs(db, user.uid)).find((j) => j.kind !== 'run_cycle');
      if (!job) {
        if (again) continue;
        break;
      }
      // 맡기 전에 점검한다: 쓸 수 없으면 작업을 대기열에 그대로 두고 웹에는 연결 신호로 이유를 알린다 (F-EX-17)
      const problem = claudeCodeProblem(await readClaude(), MODELS_FOR.qadoc);
      if (problem) {
        if (!waitingForClaude) console.log(`\n작업을 시작하지 않고 기다립니다: ${problem.message}`);
        waitingForClaude = true;
        break;
      }
      waitingForClaude = false;
      const running = await claimJob(db, job, host.name, new Date().toISOString());
      if (!running) continue;
      const label =
        running.kind === 'case_revise'
          ? `케이스 수정안 ${running.input.tcId}`
          : `QA 문서 ${running.input.appVersion} 생성`;
      console.log(`\n■ ${job.projectId} · ${label} (${job.id})`);
      service.setBusy(`${label} 중 (${job.projectId})`);
      const live = createLiveLlm(undefined, { turnTimeoutMs: 600_000 });
      const awake = keepAwake();
      try {
        const deps = {
          db,
          storage,
          api,
          uid: user.uid,
          host: host.name,
          llmFor: (j: { projectId: string; id: string }) =>
            createCassetteLlm({
              dir: join(homedir(), '.qcard', 'jobs', `${j.projectId}-${j.id}`, 'llm'),
              mode: 'resume',
              inner: live,
            }),
          log: (l: string) => console.log(l),
        };
        const out =
          running.kind === 'case_revise' ? await processReviseJob(deps, running) : await processJob(deps, running);
        if (out.status === 'paused' && out.error?.kind === 'plan_limit') service.planLimited();
      } finally {
        live.close?.();
        awake?.kill();
        service.setBusy(undefined);
      }
    }
  } finally {
    busy = false;
  }
}

/** 처리 중에만 맥의 잠자기를 막는다 (잠들면 타이머·네트워크가 멈춰 생성이 15분씩 멈춘다) */
function keepAwake(): ChildProcess | undefined {
  if (process.platform !== 'darwin') return undefined;
  return spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
}

// ---------------------------------------------------------------- 웹에서 요청한 Run 시작 (QA 문서 생성을 기다리지 않는다)
let starting = false;
let startAgain = false;
async function startRuns() {
  if (starting) return void (startAgain = true);
  starting = true;
  try {
    do {
      startAgain = false;
      await startRunJobs({
        db,
        uid: user.uid,
        host: host.name,
        start: (req) => service.startRun(req),
        log: (l) => console.log(`\n${l}`),
      });
    } while (startAgain);
  } catch (e) {
    console.error(`Run 시작 요청 처리 실패: ${(e as Error).message}`);
  } finally {
    starting = false;
  }
}

onSnapshot(
  query(collectionGroup(db, 'jobs'), where('requestedBy', '==', user.uid)),
  (snap) => {
    const queued = snap.docChanges().filter((c) => c.doc.data().status === 'queued');
    if (queued.some((c) => c.doc.data().kind === 'run_cycle')) void startRuns();
    if (queued.some((c) => c.doc.data().kind !== 'run_cycle')) void drain();
  },
  (e) => console.error(`작업 구독 실패: ${e.message}`),
);
console.log('웹에서 요청한 작업을 기다립니다 (Ctrl+C로 종료)');
