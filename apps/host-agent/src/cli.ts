/**
 * 호스트 에이전트: 사이클의 케이스를 연결된 실기기에서 실행하고 결과·증거를 Firebase에 올린다.
 * LLM은 이 PC에 로그인된 Claude Code(본인 플랜)로 부른다 (PRD §8 옵션 D).
 *
 * 개발·자동화용 명령. 사용자는 상주 모드(serve)의 로컬 콘솔에서 사이클을 골라 Run을 시작한다.
 *
 *   pnpm --filter @qcard/host run-cycle --project haru --cycle cycle-130-1 [TC-ID…]
 *     --user <시드 사용자>          개발용: 에뮬레이터에서 브라우저 없이 그 사용자 이름으로 연결
 *     --package <앱>               빌드 파일이 없는 사이클(개발 시드)에서 실행할 앱 (앱 데이터 초기화는 이 앱에만). 기본: qcard.local.json의 devApp
 *     --serial <시리얼>            디바이스가 여러 대일 때
 *     --resume <run id>            일시정지된 Run을 이어서 (이미 결과가 있는 칸은 건너뜀)
 *     --allow-network              set_network(네트워크 끄기) 허용
 *     --headless                   로컬 콘솔을 띄우지 않는다
 *
 * 로컬 콘솔: 127.0.0.1:4801(QCARD_CONSOLE_PORT)에 띄우고 일회용 주소를 출력한다. 실시간 화면(scrcpy), Agent 사고 로그,
 * 일시정지·Take over·건너뛰기·중단, 수동 스텝 [완료]. `pnpm dev`(Vite, /console-api를 넘긴다)가 떠 있으면 그 주소를,
 * 아니면 웹 빌드(apps/web/dist)를 이 서버가 직접 준다.
 *
 * 결과·증거는 업로드 큐(~/.qcard/upload-queue/<프로젝트>/<사용자>)를 거친다. 네트워크가 끊겨도 로컬에 남았다가 다음 실행 때 이어서 보낸다.
 *
 * 먼저 `connect`로 이 PC를 계정에 연결해 둔다(F-TM-14).
 */
import { parseArgs } from 'node:util';
import { AdbDriver, devAppPackage, listDevices } from '@qcard/device/node';
import { assertClaudeCodeReady, llmProviderFromEnv, MODELS_FOR } from '@qcard/llm';
import type { ClaudeCodeState } from '@qcard/shared';
import { HostDisconnectedError, openHostSession } from './connect';
import { attachScreen, hubBackend, launchConsole } from './console';
import { UploadQueue } from './queue';
import { CycleRunError, prepareCycleRun } from './run';
import { firestoreApply } from './sink';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    cycle: { type: 'string' },
    user: { type: 'string' },
    package: { type: 'string', default: devAppPackage() },
    serial: { type: 'string' },
    resume: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
  },
});
if (!values.project || !values.cycle) {
  console.error('사용법: run-cycle --project <id> --cycle <id> [--user <시드 사용자>] [TC-ID…]');
  process.exit(1);
}
const log = (l: string) => console.log(l);

// ---------------------------------------------------------------- Firebase 로그인 (호스트 연결)
const {
  db,
  storage,
  api,
  user: seed,
  account,
  queueDir,
  accounts,
} = await openHostSession({ seedUser: values.user }).catch((e: unknown) => {
  if (!(e instanceof HostDisconnectedError)) throw e;
  console.error(e.message);
  process.exit(1);
});

// ---------------------------------------------------------------- LLM (본인 Claude Code)
let claudeCode: ClaudeCodeState = { installed: true, loggedIn: true };
if (llmProviderFromEnv() === 'claude-cli') {
  const s = await assertClaudeCodeReady(MODELS_FOR.run);
  claudeCode = { installed: true, loggedIn: true, version: s.version, plan: s.subscriptionType };
  log(`LLM: Claude Code ${s.version} · ${s.authMethod}${s.subscriptionType ? ` · ${s.subscriptionType} 플랜` : ''}`);
}

// ---------------------------------------------------------------- 디바이스
const serial = values.serial ?? (await listDevices()).find((d) => d.state === 'device')?.serial;
if (!serial) throw new Error('연결된 디바이스가 없습니다');
const device = new AdbDriver(serial, { allowDestructive: true });
const info = await device.info();

// 업로드 큐: 지난 실행에서 못 보낸 작업이 있으면 먼저 보내기 시작한다 (F-EX-13)
const queue = await new UploadQueue(queueDir, firestoreApply(db, storage), {
  onDrop: (op, reason) => log(`보내지 못한 업로드를 뺐습니다 (${queueDir}/dropped): ${op.path} — ${reason}`),
}).open();
const leftover = await queue.pending();
if (leftover) log(`지난 실행에서 남은 업로드 ${leftover}건을 보냅니다`);

// ---------------------------------------------------------------- 대상 확인·빌드 설치 (F-CY-01, F-DV-05·06)
let prepared: Awaited<ReturnType<typeof prepareCycleRun>>;
try {
  prepared = await prepareCycleRun(
    { api, storage, queue, device, info, executor: seed.name, account, claudeCode, log, accounts },
    {
      projectId: values.project,
      cycleId: values.cycle,
      tcIds: positionals,
      resumeRunId: values.resume,
      fallbackPackage: values.package,
      allowNetworkToggle: values['allow-network'],
    },
  );
} catch (e) {
  if (!(e instanceof CycleRunError)) throw e;
  console.error(e.message);
  process.exit(1);
}

// ---------------------------------------------------------------- 로컬 콘솔 (F-DB-01·05)
const consoleUi = values.headless ? undefined : await launchConsole(hubBackend(prepared.hub), log);
const video = consoleUi ? await attachScreen(consoleUi.server, serial, log) : undefined;

const out = await prepared.start();
if (out.status === 'paused') {
  log(`\n일시정지: ${out.message}\n해결한 뒤 이어서: run-cycle … --resume ${out.runId}`);
} else if (out.status === 'aborted') {
  log(`\n실행자가 Run을 중단했습니다 · ${out.results.length}케이스 판정 · 환산 $${out.costUsd.toFixed(2)}`);
} else {
  log(`\n완료 · ${out.results.length}케이스 · 환산 $${out.costUsd.toFixed(2)}`);
}
if (consoleUi) {
  // 마지막 상태를 콘솔에서 볼 수 있게 잠시 둔다
  await video?.stop();
  const linger = Number(process.env.QCARD_CONSOLE_LINGER_MS ?? 15_000);
  if (linger > 0) log(`로컬 콘솔은 ${Math.round(linger / 1000)}초 뒤 닫힙니다`);
  await new Promise((r) => setTimeout(r, linger));
  await consoleUi.server.close();
}
process.exit(0);
