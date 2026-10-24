/**
 * 실기기에서 QA 문서 케이스를 실제 모델로 실행한다 (녹화 없음). 기본은 본인 Claude Code(플랜 사용량 차감),
 * LLM_PROVIDER=api면 API 키(비용 발생). 비용은 API 단가로 계산한 환산값이다.
 * 결과는 packages/agent/runs/<실행>/에 남는다 (커밋하지 않음):
 *   run.json(실행 메타·진행) · <TC>/result.json · <TC>/metrics.json(시간·비용) · <TC>/thoughts.txt · <TC>/obs-*.png
 *
 *   pnpm --filter @qcard/agent device-run TC-ONBOARDING-001 …   케이스 지정
 *   pnpm --filter @qcard/agent device-run --all                 자동 케이스 전체 (준비 상태별로 묶어서)
 *     --resume <실행 id>     끝난 케이스는 건너뛰고 이어서
 *     --budget 8             누적 환산 비용(USD)이 넘으면 멈춤
 *     --allow-network        set_network(네트워크 끄기) 허용. 케이스가 끝나면 다시 켠다
 *     --package <앱>  --serial <시리얼>   앱 기본값: qcard.local.json의 devApp (packages/device/src/devApp.ts)
 *
 * 플랜 사용 한도에 닿거나 Claude Code 로그인이 풀리면 일시정지한다(run.json status: paused).
 * 해소한 뒤 --resume <실행 id>로 이어 간다 (멈춘 케이스는 처음부터 다시).
 *
 * 앱 데이터 초기화(pm clear)는 --package로 지정한 앱에만 한다.
 * 수동 스텝: 터미널에서 Enter를 누르거나 실행 폴더에 MANUAL_DONE 파일을 만들면 이어 간다 (10분 넘으면 Blocked).
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { AdbDriver, execAdb, listDevices, requireDevApp } from '@qcard/device/node';
import { PREP_FLOWS, qaDocV130 } from '@qcard/fixtures';
import {
  assertClaudeCodeReady,
  ClaudeCodeSetupError,
  createLlm,
  llmProviderFromEnv,
  PlanLimitError,
  UsageMeter,
  type UsageTotals,
} from '@qcard/llm';
import type { TestCase } from '@qcard/shared';
import { runCase } from '../src';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    serial: { type: 'string' },
    package: { type: 'string' },
    all: { type: 'boolean', default: false },
    resume: { type: 'string' },
    budget: { type: 'string', default: '8' },
    'allow-network': { type: 'boolean', default: false },
  },
});
const appPackage = requireDevApp(values.package);
const MANUAL_TIMEOUT_MS = 10 * 60_000;
const MAX_ENV_ERRORS = 3;
const budget = Number(values.budget);

// 실행할 케이스: 지정한 것 또는 자동 케이스 전체. 준비 상태가 같은 것끼리 묶고 묶음 안에서는 문서 순서 (F-EX-11)
// 삭제된 케이스(change: removed)는 현재 버전에서 실행하지 않는다
const auto = qaDocV130.cases.filter((c) => c.mode === 'auto' && c.change !== 'removed');
const picked: TestCase[] = values.all
  ? auto
  : positionals.map((id) => {
      const c = qaDocV130.cases.find((x) => x.tcId === id);
      if (!c) throw new Error(`케이스 없음: ${id}`);
      return c;
    });
if (picked.length === 0) {
  console.error('사용법: device-run <TC-ID…> | --all [--resume <id>] [--budget 8] [--allow-network]');
  process.exit(1);
}
const groupOrder = [...new Set(picked.map((c) => c.prepFlowIds.join('+')))];
const cases = [...picked].sort(
  (a, b) => groupOrder.indexOf(a.prepFlowIds.join('+')) - groupOrder.indexOf(b.prepFlowIds.join('+')),
);

// LLM: 본인 Claude Code가 준비됐는지 먼저 본다 (F-EX-17)
if (llmProviderFromEnv() === 'claude-cli') {
  const s = await assertClaudeCodeReady().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
  console.log(
    `LLM: Claude Code ${s.version} · ${s.authMethod}${s.subscriptionType ? ` · ${s.subscriptionType} 플랜` : ''}`,
  );
  if (s.authMethod !== 'claude.ai') console.warn('⚠ 플랜 로그인이 아닙니다. API 크레딧으로 과금될 수 있습니다');
}

const serial = values.serial ?? (await listDevices()).find((d) => d.state === 'device')?.serial;
if (!serial) throw new Error('연결된 디바이스가 없습니다');
const device = new AdbDriver(serial, { allowDestructive: true });
const info = await device.info();
{
  const screen = await device.screenState();
  if (!screen.awake || screen.locked) {
    console.error(`디바이스 화면이 ${screen.awake ? '잠겨' : '꺼져'} 있습니다. 잠금을 풀고 화면을 켜 둔 채 다시 실행하세요`);
    process.exit(1);
  }
}

// 시작 전 네트워크 상태 (복구 기준). 꺼져 있으면 TC-031류 결과가 달라지므로 알린다
const sh = async (...a: string[]) => (await execAdb()(['-s', serial, 'shell', ...a])).toString().trim();
const net = {
  wifi: await sh('settings', 'get', 'global', 'wifi_on'),
  data: await sh('settings', 'get', 'global', 'mobile_data'),
};
if (net.wifi === '0' && net.data === '0') console.warn('⚠ 디바이스 네트워크가 모두 꺼져 있습니다');

const id = values.resume ?? new Date().toISOString().replace(/[:.]/g, '-');
const runDir = resolve(import.meta.dirname, '..', 'runs', id);
await mkdir(runDir, { recursive: true });
// 출력은 run.log에도 바로 쓴다 (파이프로 넘기면 버퍼에 쌓여 진행이 늦게 보이므로)
const log = (...a: unknown[]) => {
  const line = a.map(String).join(' ');
  console.log(line);
  appendFileSync(join(runDir, 'run.log'), line + '\n');
};
const metaFile = join(runDir, 'run.json');
const prev = existsSync(metaFile)
  ? (JSON.parse(await readFile(metaFile, 'utf8')) as { startedAt?: string; costUsd?: number })
  : {};
const meta = {
  id,
  startedAt: prev.startedAt ?? new Date().toISOString(),
  device: info,
  appPackage: appPackage,
  docId: qaDocV130.id,
  allowNetwork: values['allow-network'],
};
let total = prev.costUsd ?? 0;
const writeMeta = (extra: object = {}) =>
  writeFile(metaFile, JSON.stringify({ ...meta, costUsd: total, ...extra }, null, 2) + '\n');
await writeMeta({ status: 'running', planned: cases.length });
log(
  `${info.model} · Android ${info.osMajor} · ${appPackage} · ${cases.length}케이스 · 예산 $${budget} → ${runDir}`,
);

const notify = (msg: string) =>
  execFile('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "qcard"`], () => {});

/** 수동 스텝: 알리고 Enter 또는 MANUAL_DONE 파일을 기다린다 */
async function waitManual(tcId: string, instruction: string): Promise<'done' | 'timeout'> {
  const flag = join(runDir, 'MANUAL_DONE');
  await rm(flag, { force: true });
  log(
    `\n🖐  수동 스텝 (${tcId}): ${instruction}\n   디바이스에서 직접 수행한 뒤 Enter (또는 ${flag} 생성). 10분 안에 없으면 Blocked.`,
  );
  notify(`수동 스텝 ${tcId}: ${instruction}`);
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin }) : undefined;
  try {
    return await new Promise((done) => {
      const timer = setTimeout(() => finish('timeout'), MANUAL_TIMEOUT_MS);
      const poll = setInterval(() => existsSync(flag) && finish('done'), 1000);
      rl?.once('line', () => finish('done'));
      function finish(r: 'done' | 'timeout') {
        clearTimeout(timer);
        clearInterval(poll);
        done(r);
      }
    });
  } finally {
    rl?.close();
    await rm(flag, { force: true });
  }
}

const diff = (a: UsageTotals, b: UsageTotals) => ({
  calls: a.calls - b.calls,
  tokens: a.tokens - b.tokens,
  costUsd: a.costUsd - b.costUsd,
});

let envErrors = 0;
let stopped: string | undefined;
let paused: { reason: 'plan_limit' | ClaudeCodeSetupError['reason']; message: string } | undefined;
/** 플랜 한도·로그인 오류면 일시정지로 기록하고 undefined, 아니면 다시 던진다 */
const pauseOn = (e: unknown): undefined => {
  if (e instanceof PlanLimitError) paused = { reason: 'plan_limit', message: e.message };
  else if (e instanceof ClaudeCodeSetupError) paused = { reason: e.reason, message: e.message };
  else throw e;
  return undefined;
};
for (const [i, testCase] of cases.entries()) {
  const tcId = testCase.tcId;
  const dir = join(runDir, tcId);
  if (existsSync(join(dir, 'result.json'))) continue; // --resume
  if (total >= budget) {
    stopped = `예산 초과 (환산 $${total.toFixed(2)} ≥ $${budget})`;
    break;
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  log(`\n[${i + 1}/${cases.length}] ${tcId} ${testCase.title} (${testCase.prepFlowIds.join('+')})`);

  const meter = new UsageMeter({ maxCallsPerCase: 40, maxTokensPerCase: 600_000 });
  const thoughts: string[] = [];
  const phases: Record<string, { ms: number; calls: number; tokens: number; costUsd: number }> = {};
  let phase: { name: string; at: number; usage: UsageTotals } | undefined;
  const closePhase = () => {
    if (!phase) return;
    phases[phase.name] = { ms: Date.now() - phase.at, ...diff(meter.run, phase.usage) };
  };
  const t0 = Date.now();
  const result = await runCase(
    {
      device,
      llm: createLlm({ mode: 'live', cassetteDir: '', meter }),
      appPackage: appPackage,
      allowNetworkToggle: values['allow-network'],
      saveScreenshot: async (png, { index, treeText, foreground }) => {
        const file = `obs-${String(index).padStart(2, '0')}.png`;
        await writeFile(join(dir, file), png);
        await writeFile(join(dir, file.replace('.png', '.txt')), `# fg=${foreground ?? ''}\n${treeText}\n`);
        return { kind: 'url', url: file, w: info.size.w, h: info.size.h };
      },
      onThought: (t) => {
        const line = `${(t.at / 1000).toFixed(1).padStart(5)}s [${t.kind}] ${t.text}`;
        thoughts.push(line);
        if (t.kind !== 'observe') log(`  ${line}`);
      },
      onManual: (instruction) => waitManual(tcId, instruction),
    },
    {
      testCase,
      prepFlows: PREP_FLOWS,
      deviceId: `${info.model}-${info.osMajor}`,
      meter,
      onPhase: (name) => {
        closePhase();
        phase = { name, at: Date.now(), usage: { ...meter.run } };
      },
    },
  ).catch(pauseOn);
  closePhase();
  const ms = Date.now() - t0;
  total += meter.run.costUsd;
  if (!result) {
    // 멈춘 케이스는 결과를 남기지 않는다 → --resume 때 처음부터 다시 실행
    log(`⏸ ${tcId}: 일시정지 — ${paused!.message}`);
    break;
  }
  const metrics = {
    tcId,
    approval: testCase.approval.status,
    prep: testCase.prepFlowIds,
    verdict: result.verdict,
    ms,
    ...meter.run,
    byRole: Object.fromEntries(['executor', 'locator', 'verifier'].map((r) => [r, meter.forRole(r)])),
    phases,
    actions: result.steps.length,
  };
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  await writeFile(join(dir, 'thoughts.txt'), thoughts.join('\n') + '\n');
  await writeMeta({ status: 'running', planned: cases.length });
  log(
    `■ ${tcId}: ${result.verdict}${result.blockedReason ? ` — ${result.blockedReason}` : ''} · ${(ms / 1000).toFixed(0)}초 · 호출 ${meter.run.calls} · 환산 $${meter.run.costUsd.toFixed(3)} · 누적 $${total.toFixed(2)}`,
  );

  // 디바이스 연결 끊김·서버 무응답이 이어지면 멈춘다
  envErrors = result.blockedReason?.startsWith('환경 오류') ? envErrors + 1 : 0;
  if (envErrors >= MAX_ENV_ERRORS) {
    stopped = `환경 오류 ${envErrors}회 연속: ${result.blockedReason}`;
    break;
  }
}

if (paused) {
  await writeMeta({ status: 'paused', pauseReason: paused.reason, pausedMessage: paused.message });
  log(
    `\n일시정지: ${paused.message}\n해결한 뒤 이어서 실행: device-run … --resume ${id} · 환산 합계 $${total.toFixed(2)}`,
  );
  notify(`실행 일시정지: ${paused.reason === 'plan_limit' ? '플랜 사용 한도' : paused.reason === 'outdated' ? 'Claude Code 업데이트 필요' : 'Claude Code 로그인 필요'}`);
} else {
  await writeMeta({
    status: stopped ? 'stopped' : 'done',
    stoppedReason: stopped,
    finishedAt: new Date().toISOString(),
  });
  log(`\n${stopped ? `중단: ${stopped}` : '완료'} · 환산 합계 $${total.toFixed(2)} · ${runDir}`);
  notify(stopped ? `실행 중단: ${stopped}` : `실행 완료 · 환산 $${total.toFixed(2)}`);
}
