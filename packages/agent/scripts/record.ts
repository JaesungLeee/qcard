/**
 * 온보딩 e2e 케이스를 실제 모델로 녹화한다 (cassettes/). 요청이 바뀌면 다시 녹화해야 재생 테스트가 돈다.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @qcard/agent record [TC-ID…]
 */
import { E2E_CASES, runE2E } from '../e2e/onboarding';

const only = process.argv.slice(2);
let total = 0;
for (const c of E2E_CASES) {
  if (only.length && !only.includes(c.tcId)) continue;
  const { result, thoughts, usage } = await runE2E(c, 'record');
  total += usage.costUsd;
  const name = `${c.tcId}${'buggy' in c ? ' (버그 앱)' : ''}`;
  console.log(
    `\n■ ${name}: ${result.verdict} (기대 ${c.expect})${result.blockedReason ? ` — ${result.blockedReason}` : ''}`,
  );
  console.log(thoughts.map((t) => `  ${t}`).join('\n'));
  for (const p of result.points) console.log(`  · ${p.pointId} ${p.result}: ${p.observed} / ${p.reason}`);
  console.log(`  호출 ${usage.calls}회 · 토큰 ${usage.tokens} · $${usage.costUsd.toFixed(4)}`);
}
console.log(`\n합계 $${total.toFixed(4)}`);
