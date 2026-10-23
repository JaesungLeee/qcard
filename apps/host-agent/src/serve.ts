/**
 * 호스트 에이전트 상주 모드: 로컬 콘솔을 띄워 두고(사이클을 골라 Run 시작), 웹에서 요청한 내 작업(QA 문서 생성)을
 * 이 PC의 Claude Code(본인 플랜)로 처리한다.
 *
 *   pnpm --filter @qcard/host-agent serve --user jaesung-lee
 *     --package com.example.harukong.qa   빌드 파일이 없는 사이클(시드)에서 실행할 앱
 *     --serial <시리얼>            디바이스가 여러 대일 때 (기본: 처음 연결된 것, 1인 1대)
 *     --allow-network              set_network(네트워크 끄기) 허용
 *     --headless                   로컬 콘솔을 띄우지 않는다
 *
 * - 로컬 콘솔: 시작할 때 한 번만 열 수 있는 주소를 출력한다(터미널에서 Enter를 누르면 새 주소). 연결된 폰 화면을 실시간으로 보여 주고, 이 폰이 대상인
 *   사이클을 골라 Run을 시작·이어서 실행한다. 폰을 뺐다 꽂으면 30초 안에 알아챈다
 *
 * - 30초마다 연결 신호(+ Claude Code 상태)를 보내 웹이 "호스트 연결됨"을 표시한다 (F-DB-09)
 * - 내 작업만 받는다(요청자 = 나). 한 번에 하나씩, 처리 중에는 맥이 잠들지 않게 한다(caffeinate)
 * - 작업마다 호출을 ~/.qcard/jobs/<작업>/llm에 녹화한다. 플랜 한도로 멈춘 작업을 웹에서 다시 시도하면
 *   끝난 호출은 재생하고 남은 것만 부른다
 *
 * 지금은 에뮬레이터(`pnpm emu`)에만 연결한다. --user는 시드 사용자(GitHub 사용자명).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, listDevices } from '@qcard/device/node';
import { claudeCodeStatus, createCassetteLlm, createLiveLlm, type ClaudeCodeStatus } from '@qcard/llm';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { connectEmulator } from './connect';
import { attachScreen, ConsoleService, launchConsole } from './console';
import { RESTORED, restoreAwake } from './awake';
import { claimJob, heartbeat, pendingJobs, processJob } from './jobs';
import { UploadQueue } from './queue';
import { firestoreApply } from './sink';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    package: { type: 'string', default: 'com.example.harukong.qa' },
    serial: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
  },
});
if (!values.user) {
  console.error('사용법: serve --user <GitHub 사용자명>');
  process.exit(1);
}

const { db, storage, api, user } = await connectEmulator(values.user);
const machine = hostname().replace(/\.local$/, '');
const host = { id: machine.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), name: `${user.name}의 ${machine}` };

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
async function beat() {
  const s = await claudeCodeStatus();
  claude = s;
  const list = await devices();
  await useDevice(list.map((d) => d.serial));
  await service.checkDevice();
  await heartbeat(db, user.uid, {
    ...host,
    lastSeen: new Date().toISOString(),
    devices: list,
    claudeCode: { version: s.version, loggedIn: s.loggedIn, subscriptionType: s.subscriptionType },
  }).catch((e: Error) => console.error(`연결 신호 실패: ${e.message}`));
  return s;
}
// ---------------------------------------------------------------- 로컬 콘솔 (F-DB-01·05, PRD §4 ⑤)
const log = (l: string) => console.log(l);
const queue = await new UploadQueue(join(homedir(), '.qcard', 'upload-queue'), firestoreApply(db, storage), {
  onDrop: (op) => log(`대상 문서가 없어 보내지 못한 업로드를 뺐습니다 (~/.qcard/upload-queue/dropped): ${op.path}`),
}).open();
const service = new ConsoleService({
  api,
  storage,
  queue,
  executor: user.name,
  claudeCode: () => ({
    installed: claude?.installed ?? true,
    loggedIn: claude?.loggedIn ?? false,
    ...(claude?.version ? { version: claude.version } : {}),
    ...(claude?.subscriptionType ? { plan: claude.subscriptionType } : {}),
  }),
  log,
  fallbackPackage: values.package,
  allowNetworkToggle: values['allow-network'],
});
const consoleUi = values.headless ? undefined : await launchConsole(service, log);
// 터미널에서 Enter를 누르면 새 주소 (다른 브라우저에서 열 때 — 주소는 한 번만 쓸 수 있다)
if (consoleUi && process.stdin.isTTY) {
  log('  (Enter: 새 콘솔 주소)');
  process.stdin.on('data', () => consoleUi.printUrl());
}

/** 이 호스트가 쓰는 디바이스 (1인 1대). 바뀌면 콘솔과 화면 스트림을 새 디바이스로 */
let current: { serial: string; video?: { stop(): Promise<void>; alive(): boolean } } | undefined;
async function useDevice(serials: string[]) {
  const serial = values.serial ? serials.find((s) => s === values.serial) : serials[0];
  if (serial && serial === current?.serial) {
    // 잠깐 빠졌다 돌아온 경우: 끊긴 화면 스트림만 다시 띄운다
    if (consoleUi && current.video && !current.video.alive()) {
      log('디바이스가 다시 연결됐습니다 — 화면 스트림을 다시 띄웁니다');
      current.video = await attachScreen(consoleUi.server, serial, log);
    }
    return;
  }
  if (!serial && !current) return;
  await current?.video?.stop();
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
  if (consoleUi) current.video = await attachScreen(consoleUi.server, serial, log);
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
console.log(
  status.loggedIn
    ? `Claude Code ${status.version} · ${status.subscriptionType ?? status.authMethod} 플랜`
    : '⚠ Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`로 로그인하세요 (작업은 일시정지됩니다)',
);

// ---------------------------------------------------------------- 작업 처리 (한 번에 하나)
let busy = false;
let again = false;
async function drain() {
  if (busy) return void (again = true);
  busy = true;
  try {
    do {
      again = false;
      for (const job of await pendingJobs(db, user.uid)) {
        const running = await claimJob(db, job, host.name, new Date().toISOString());
        if (!running) continue;
        console.log(`\n■ ${job.projectId} · QA 문서 ${running.input.appVersion} 생성 (${job.id})`);
        service.setBusy(`QA 문서 ${running.input.appVersion} 생성 중 (${job.projectId})`);
        const live = createLiveLlm(undefined, { turnTimeoutMs: 600_000 });
        const awake = keepAwake();
        try {
          await processJob(
            {
              db,
              storage,
              api,
              uid: user.uid,
              host: host.name,
              llmFor: (j) =>
                createCassetteLlm({
                  dir: join(homedir(), '.qcard', 'jobs', `${j.projectId}-${j.id}`, 'llm'),
                  mode: 'resume',
                  inner: live,
                }),
              log: (l) => console.log(l),
            },
            running,
          );
        } finally {
          live.close?.();
          awake?.kill();
          service.setBusy(undefined);
        }
      }
    } while (again);
  } finally {
    busy = false;
  }
}

/** 처리 중에만 맥의 잠자기를 막는다 (잠들면 타이머·네트워크가 멈춰 생성이 15분씩 멈춘다) */
function keepAwake(): ChildProcess | undefined {
  if (process.platform !== 'darwin') return undefined;
  return spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
}

onSnapshot(
  query(collectionGroup(db, 'jobs'), where('requestedBy', '==', user.uid)),
  (snap) => {
    if (snap.docChanges().some((c) => c.doc.data().status === 'queued')) void drain();
  },
  (e) => console.error(`작업 구독 실패: ${e.message}`),
);
console.log('웹에서 요청한 작업을 기다립니다 (Ctrl+C로 종료)');
