/**
 * 온보딩 e2e 케이스를 실제 모델로 녹화한다 (cassettes/). 요청이 바뀌면 다시 녹화해야 재생 테스트가 돈다.
 * 기본은 본인 Claude Code(플랜 사용량 차감), LLM_PROVIDER=api면 API 키.
 *
 *   pnpm --filter @qcard/agent record [TC-ID…]
 *   pnpm --filter @qcard/agent record --live [TC-ID…]   녹화 파일을 쓰지 않고 실제 모델로만 돌려 본다
 */
import { E2E_CASES, runE2E } from '../e2e/onboarding';

const args = process.argv.slice(2);
const live = args.includes('--live');
const only = args.filter((a) => a !== '--live');
let total = 0;
for (const c of E2E_CASES) {
  if (only.length && !only.includes(c.tcId)) continue;
  const { result, thoughts, usage } = await runE2E(c, live ? 'live' : 'record');
  total += usage.costUsd;
  const name = `${c.tcId}${'buggy' in c ? ' (버그 앱)' : ''}`;
  console.log(
    `\n■ ${name}: ${result.verdict} (기대 ${c.expect})${result.blockedReason ? ` — ${result.blockedReason}` : ''}`,
  );
  console.log(thoughts.map((t) => `  ${t}`).join('\n'));
  for (const p of result.points) console.log(`  · ${p.pointId} ${p.result}: ${p.observed} / ${p.reason}`);
  console.log(`  호출 ${usage.calls}회 · 토큰 ${usage.tokens} · 환산 $${usage.costUsd.toFixed(4)}`);
}
console.log(`\n환산 합계 $${total.toFixed(4)}`);
