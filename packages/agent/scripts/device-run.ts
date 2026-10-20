/**
 * 실기기에서 QA 문서 케이스를 실제 모델로 실행한다 (녹화 없음, 비용 발생).
 * 결과(result.json)와 관찰 스크린샷은 packages/agent/runs/<시각>/에 남긴다 (커밋하지 않음).
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @qcard/agent device-run TC-ONBOARDING-001 [--serial S] [--package com.example.harukong.qa]
 *
 * 앱 데이터 초기화(pm clear)는 --package로 지정한 앱에만 한다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AdbDriver, listDevices } from '@qcard/device/node';
import { PREP_FLOWS, qaDocV130 } from '@qcard/fixtures';
import { createLlm, UsageMeter } from '@qcard/llm';
import { runCase } from '../src';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { serial: { type: 'string' }, package: { type: 'string', default: 'com.example.harukong.qa' } },
});
if (positionals.length === 0) {
  console.error('사용법: device-run <TC-ID…> [--serial S] [--package P]');
  process.exit(1);
}
const serial = values.serial ?? (await listDevices()).find((d) => d.state === 'device')?.serial;
if (!serial) throw new Error('연결된 디바이스가 없습니다');

const runDir = resolve(import.meta.dirname, '..', 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
const device = new AdbDriver(serial, { allowDestructive: true });
const info = await device.info();
console.log(`${info.model} · Android ${info.osMajor} · ${values.package} → ${runDir}`);

// 웹 개발 서버가 /__runs/로 읽어 "로컬 실행" 사이클로 보여 준다 (apps/web/vite/local-runs.ts)
const meta = {
  id: runDir.split('/').at(-1)!,
  startedAt: new Date().toISOString(),
  device: info,
  appPackage: values.package,
  docId: qaDocV130.id,
};
await mkdir(runDir, { recursive: true });
const writeMeta = (extra: object = {}) =>
  writeFile(join(runDir, 'run.json'), JSON.stringify({ ...meta, ...extra }, null, 2) + '\n');
await writeMeta();

let total = 0;
for (const tcId of positionals) {
  const testCase = qaDocV130.cases.find((c) => c.tcId === tcId);
  if (!testCase) throw new Error(`케이스 없음: ${tcId}`);
  const dir = join(runDir, tcId);
  await mkdir(dir, { recursive: true });
  const meter = new UsageMeter({ maxCallsPerCase: 40, maxTokensPerCase: 600_000 });
  const t0 = Date.now();
  const result = await runCase(
    {
      device,
      llm: createLlm({ mode: 'live', cassetteDir: '', meter }),
      appPackage: values.package,
      saveScreenshot: async (png, { index }) => {
        const file = `obs-${String(index).padStart(2, '0')}.png`;
        await writeFile(join(dir, file), png);
        return { kind: 'url', url: file, w: info.size.w, h: info.size.h };
      },
      onThought: (t) => console.log(`  ${(t.at / 1000).toFixed(1).padStart(5)}s [${t.kind}] ${t.text}`),
    },
    { testCase, prepFlows: PREP_FLOWS, deviceId: `${info.model}-${info.osMajor}`, meter },
  );
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  total += meter.run.costUsd;
  console.log(
    `■ ${tcId}: ${result.verdict}${result.blockedReason ? ` — ${result.blockedReason}` : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}초 · 호출 ${meter.run.calls}회 · 토큰 ${meter.run.tokens} (캐시 읽기 ${meter.run.cacheReadTokens}) · $${meter.run.costUsd.toFixed(4)}`,
  );
  for (const p of result.points) console.log(`  · ${p.pointId} ${p.result}: ${p.observed} / ${p.reason}`);
}
await writeMeta({ finishedAt: new Date().toISOString(), costUsd: total });
console.log(`합계 $${total.toFixed(4)}`);
