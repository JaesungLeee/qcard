/**
 * 웹 ui:snap용 고정 "로컬 실행" 샘플을 만든다 (녹화 재생, API 호출 없음).
 * 출력: apps/web/e2e/runs-sample/<실행>/<TC>/result.json + run.json. 합성 화면이라 스크린샷은 목업 키다.
 *
 *   pnpm --filter @qcard/agent sample-runs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { E2E_CASES, runE2E } from '../e2e/onboarding';

const ID = '2026-10-20T09-00-00-000Z';
const root = resolve(import.meta.dirname, '../../../apps/web/e2e/runs-sample');
const dir = join(root, ID);
await rm(root, { recursive: true, force: true });

// 같은 TC가 두 번(정상·버그 앱) 있으면 버그 앱(Fail) 쪽을 쓴다
const picks = E2E_CASES.filter((c) => c.tcId !== 'TC-ONBOARDING-001' || 'buggy' in c);
for (const c of picks) {
  const { result } = await runE2E(c, 'replay');
  await mkdir(join(dir, c.tcId), { recursive: true });
  await writeFile(join(dir, c.tcId, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
await writeFile(
  join(dir, 'run.json'),
  JSON.stringify(
    {
      id: ID,
      startedAt: '2026-10-20T09:00:00.000Z',
      finishedAt: '2026-10-20T09:04:00.000Z',
      device: { serial: 'FAKE-S24', model: 'SM-S921N', osMajor: 15, size: { w: 1080, h: 2400 }, density: 420 },
      appPackage: 'com.example.harukong',
      docId: 'doc-130',
    },
    null,
    2,
  ) + '\n',
);
console.log(`${picks.length}개 → ${dir}`);
