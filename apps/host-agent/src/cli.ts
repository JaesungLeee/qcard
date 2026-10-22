/**
 * 호스트 에이전트: 사이클의 케이스를 연결된 실기기에서 실행하고 결과·증거를 Firebase에 올린다.
 * LLM은 이 PC에 로그인된 Claude Code(본인 플랜)로 부른다 (PRD §8 옵션 D).
 *
 *   pnpm --filter @qcard/host-agent run-cycle --project haru --cycle cycle-130-1 --user jaesung-lee [TC-ID…]
 *     --package com.example.harukong.qa   실행할 앱 (앱 데이터 초기화는 이 앱에만)
 *     --serial <시리얼>            디바이스가 여러 대일 때
 *     --resume <run id>            일시정지된 Run을 이어서 (이미 결과가 있는 칸은 건너뜀)
 *     --allow-network              set_network(네트워크 끄기) 허용
 *
 * 결과·증거는 업로드 큐(~/.qcard/upload-queue)를 거친다. 네트워크가 끊겨도 로컬에 남았다가 다음 실행 때 이어서 보낸다.
 *
 * 지금은 에뮬레이터(`pnpm emu`)에만 연결한다. --user는 시드 사용자(GitHub 사용자명)다.
 * 실제 Firebase 연결·GitHub 로그인은 배포 준비 때 붙인다.
 */
import { parseArgs } from 'node:util';
import { AdbDriver, listDevices } from '@qcard/device/node';
import { assertClaudeCodeReady, createLlm, llmProviderFromEnv, UsageMeter } from '@qcard/llm';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connectEmulator } from './connect';
import { UploadQueue } from './queue';
import { firestoreApply, runSink } from './sink';
import { runCycle } from './runCycle';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    cycle: { type: 'string' },
    user: { type: 'string' },
    package: { type: 'string', default: 'com.example.harukong.qa' },
    serial: { type: 'string' },
    resume: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
  },
});
if (!values.project || !values.cycle || !values.user) {
  console.error('사용법: run-cycle --project <id> --cycle <id> --user <GitHub 사용자명> [TC-ID…]');
  process.exit(1);
}

// ---------------------------------------------------------------- Firebase 로그인 (에뮬레이터)
const { db, storage, api, user: seed } = await connectEmulator(values.user);

// ---------------------------------------------------------------- LLM (본인 Claude Code)
if (llmProviderFromEnv() === 'claude-cli') {
  const s = await assertClaudeCodeReady();
  console.log(
    `LLM: Claude Code ${s.version} · ${s.authMethod}${s.subscriptionType ? ` · ${s.subscriptionType} 플랜` : ''}`,
  );
}

// ---------------------------------------------------------------- 디바이스 → 사이클 대상 (모델 + OS 메이저, F-CY-01)
const serial = values.serial ?? (await listDevices()).find((d) => d.state === 'device')?.serial;
if (!serial) throw new Error('연결된 디바이스가 없습니다');
const device = new AdbDriver(serial, { allowDestructive: true });
const info = await device.info();
const { cycle } = await api.getCycle({ projectId: values.project, cycleId: values.cycle });
const target = cycle.targets.find((t) => t.model === info.model && t.osMajor === info.osMajor);
if (!target) {
  console.error(
    `이 디바이스(${info.model} · Android ${info.osMajor})는 사이클 대상이 아닙니다. 대상: ${cycle.targets.map((t) => t.label).join(', ')}`,
  );
  process.exit(1);
}

// 업로드 큐: 지난 실행에서 못 보낸 작업이 있으면 먼저 보내기 시작한다 (F-EX-13)
const queue = await new UploadQueue(join(homedir(), '.qcard', 'upload-queue'), firestoreApply(db, storage)).open();
const leftover = await queue.pending();
if (leftover) console.log(`지난 실행에서 남은 업로드 ${leftover}건을 보냅니다`);

const runId = values.resume ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const meter = new UsageMeter({ maxCallsPerCase: 40, maxTokensPerCase: 600_000 });
console.log(`${cycle.name} · ${target.label} · ${seed.name} · Run ${runId}`);

const out = await runCycle({
  api,
  sink: runSink(queue, {
    projectId: values.project,
    cycleId: values.cycle,
    deviceId: target.id,
    runId,
    executor: seed.name,
    screen: info.size,
  }),
  drainTimeoutMs: 60_000,
  env: {
    device,
    llm: createLlm({ mode: 'live', cassetteDir: '', meter }),
    appPackage: values.package,
    allowNetworkToggle: values['allow-network'],
    onThought: (t) =>
      t.kind !== 'observe' && console.log(`  ${(t.at / 1000).toFixed(1).padStart(5)}s [${t.kind}] ${t.text}`),
  },
  projectId: values.project,
  cycleId: values.cycle,
  deviceId: target.id,
  runId,
  tcIds: positionals.length ? positionals : undefined,
  skipDone: Boolean(values.resume),
  meter,
  onCase: (tc, r) =>
    console.log(`■ ${tc.tcId} ${tc.title}: ${r.verdict}${r.blockedReason ? ` — ${r.blockedReason}` : ''}`),
});

if (out.pendingUploads) {
  console.log(`업로드 ${out.pendingUploads}건이 아직 남았습니다 — 로컬 큐에 보관했고 다음 실행 때 이어서 보냅니다`);
}
if (out.status === 'paused') {
  console.log(`\n일시정지: ${out.message}\n해결한 뒤 이어서: run-cycle … --resume ${runId}`);
} else {
  console.log(`\n완료 · ${out.results.length}케이스 · 환산 $${meter.run.costUsd.toFixed(2)}`);
}
process.exit(0);
