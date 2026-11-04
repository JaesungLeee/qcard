/**
 * 실기기 실행 리포트: runs/<실행>/report.md를 만든다.
 * 판정 분포, 시간·비용, 단계별 비용, 실행 한도 보정 제안, Blocked 사유, 불일치·판단불가 포인트,
 * 스펙과 앱이 다를 가능성이 있는 Agent 판단을 모은다.
 *
 *   pnpm --filter @qcard/agent report <실행 id>   (생략하면 가장 최근 실행)
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { qaDocV130 } from '@qcard/fixtures';
import { VERDICT_LABEL, type CaseResult, type Verdict } from '@qcard/shared';

type Phase = { ms: number; calls: number; tokens: number; costUsd: number };
type Metrics = {
  tcId: string;
  approval: string;
  prep: string[];
  verdict: Verdict;
  ms: number;
  calls: number;
  tokens: number;
  costUsd: number;
  cacheReadTokens: number;
  phases: Partial<Record<'prep' | 'steps' | 'verify', Phase>>;
  actions: number;
};

const root = resolve(import.meta.dirname, '..', 'runs');
const id = process.argv[2] ?? (await readdir(root)).sort().at(-1);
if (!id) throw new Error('실행이 없습니다');
const dir = join(root, id);
const meta = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as Record<string, unknown> & {
  device: { model: string; osMajor: number };
  appPackage: string;
};

const rows: { r: CaseResult; m: Metrics; thoughts: string[] }[] = [];
for (const e of await readdir(dir, { withFileTypes: true })) {
  if (!e.isDirectory() || !existsSync(join(dir, e.name, 'metrics.json'))) continue;
  const read = (f: string) => readFile(join(dir, e.name, f), 'utf8');
  rows.push({
    r: JSON.parse(await read('result.json')) as CaseResult,
    m: JSON.parse(await read('metrics.json')) as Metrics,
    thoughts: (await read('thoughts.txt').catch(() => '')).split('\n').filter(Boolean),
  });
}
rows.sort((a, b) => a.r.tcId.localeCompare(b.r.tcId));
if (rows.length === 0) throw new Error(`결과가 없습니다: ${dir}`);

const title = (tcId: string) => qaDocV130.cases.find((c) => c.tcId === tcId)?.title ?? '';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))]!;
const stat = (xs: number[], f: (n: number) => string) =>
  `${f(sum(xs) / xs.length)} · ${f(pct(xs, 0.5))} · ${f(pct(xs, 0.9))} · ${f(Math.max(...xs))}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(0)}초`;
const usd = (n: number) => `$${n.toFixed(3)}`;
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const VERDICTS: Verdict[] = ['pass', 'fail', 'check', 'blocked', 'na', 'nt'];
const dist = (list: typeof rows) =>
  VERDICTS.filter((v) => list.some((x) => x.r.verdict === v))
    .map((v) => `${VERDICT_LABEL[v]} ${list.filter((x) => x.r.verdict === v).length}`)
    .join(' · ');
const groupBy = <K extends string>(f: (x: (typeof rows)[number]) => K) => {
  const g = new Map<K, typeof rows>();
  for (const x of rows) g.set(f(x), [...(g.get(f(x)) ?? []), x]);
  return [...g];
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const ms = rows.map((x) => x.m.ms);
const cost = rows.map((x) => x.m.costUsd);
const calls = rows.map((x) => x.m.calls);
const tokens = rows.map((x) => x.m.tokens);
const actions = rows.map((x) => x.m.actions);
const phaseTotal = (p: 'prep' | 'steps' | 'verify') => ({
  ms: sum(rows.map((x) => x.m.phases[p]?.ms ?? 0)),
  cost: sum(rows.map((x) => x.m.phases[p]?.costUsd ?? 0)),
});
const totalCost = sum(cost);
const totalMs = sum(ms);

const out: string[] = [];
out.push(`# 실기기 실행 리포트 · ${id}`, '');
out.push(
  `${meta.device.model} · Android ${meta.device.osMajor} · ${meta.appPackage} · 케이스 ${rows.length}개` +
    `${meta.planned ? ` / 계획 ${String(meta.planned)}` : ''} · 총 ${sec(totalMs)} · ${usd(totalCost)}` +
    `${meta.status && meta.status !== 'done' ? ` · 상태 ${String(meta.status)}${meta.stoppedReason ? ` (${String(meta.stoppedReason)})` : ''}` : ''}`,
  '',
);

out.push('## 판정 분포', '', `**전체** ${dist(rows)}`, '');
out.push('| 준비 상태 | 케이스 | 판정 |', '|---|---|---|');
for (const [k, list] of groupBy((x) => x.m.prep.join('+'))) out.push(`| ${k} | ${list.length} | ${dist(list)} |`);
out.push('', '| 승인 상태 | 케이스 | 판정 |', '|---|---|---|');
for (const [k, list] of groupBy((x) => x.m.approval)) out.push(`| ${k} | ${list.length} | ${dist(list)} |`);

out.push('', '## 시간·비용 (케이스당: 평균 · 중앙값 · p90 · 최대)', '');
out.push('| 항목 | 값 |', '|---|---|');
out.push(`| 시간 | ${stat(ms, sec)} |`);
out.push(`| 비용 | ${stat(cost, usd)} |`);
out.push(`| LLM 호출 | ${stat(calls, int)} |`);
out.push(`| 토큰 | ${stat(tokens, int)} |`);
out.push(`| 디바이스 액션 | ${stat(actions, int)} |`);
out.push(
  `| 캐시 읽기 비율 | ${((sum(rows.map((x) => x.m.cacheReadTokens)) / Math.max(1, sum(tokens))) * 100).toFixed(0)}% |`,
);
out.push('', '| 단계 | 시간 | 비용 | 비용 비중 |', '|---|---|---|---|');
for (const p of ['prep', 'steps', 'verify'] as const) {
  const t = phaseTotal(p);
  out.push(
    `| ${{ prep: '준비(초기화·준비 플로우)', steps: '본 단계', verify: '검증' }[p]} | ${sec(t.ms)} | ${usd(t.cost)} | ${((t.cost / Math.max(totalCost, 1e-9)) * 100).toFixed(0)}% |`,
  );
}

const avgTokens = sum(tokens) / tokens.length;
out.push('', '## 실행 한도 보정 제안', '');
out.push(
  `- 케이스당 토큰: 평균 ${int(avgTokens)}, 최대 ${int(Math.max(...tokens))} → **PoC 평균의 3배 = ${int(avgTokens * 3)}**`,
);
out.push(`- 케이스당 LLM 호출: 최대 ${Math.max(...calls)} (현재 상한 40)`);
const maxStepsRule = rows.map((x) => ({
  tc: x.r.tcId,
  used: x.m.actions,
  cap: (qaDocV130.cases.find((c) => c.tcId === x.r.tcId)?.steps.length ?? 1) * 3 + 10,
}));
const tight = maxStepsRule.filter((x) => x.used > x.cap * 0.7);
out.push(
  `- 본 단계 최대 스텝(단계 수 × 3 + 10) 대비 액션: 최대 ${Math.max(...actions)}${tight.length ? ` — 70% 넘은 케이스 ${tight.map((x) => `${x.tc}(${x.used}/${x.cap})`).join(', ')}` : ' — 모두 여유 있음'}`,
);
out.push(`- 60케이스 예상: ${sec((totalMs / rows.length) * 60)} · ${usd((totalCost / rows.length) * 60)}`);

const blocked = rows.filter((x) => x.r.verdict === 'blocked');
if (blocked.length) {
  out.push('', '## Blocked', '', '| 케이스 | 사유 |', '|---|---|');
  for (const x of blocked) out.push(`| ${x.r.tcId} ${cell(title(x.r.tcId))} | ${cell(x.r.blockedReason ?? '')} |`);
}

const misses = rows.flatMap((x) => x.r.points.filter((p) => p.result !== 'match').map((p) => ({ x, p })));
if (misses.length) {
  out.push(
    '',
    '## 불일치·판단불가 포인트',
    '',
    '| 케이스 | 판정 | 기대 | 결과 | 관찰 · 이유 |',
    '|---|---|---|---|---|',
  );
  for (const { x, p } of misses) {
    out.push(
      `| ${x.r.tcId} | ${VERDICT_LABEL[x.r.verdict]} | ${cell(p.expected)} | ${p.result === 'mismatch' ? '불일치' : '판단불가'} | ${cell(`${p.observed} — ${p.reason}`)} |`,
    );
  }
}

// Agent가 사전조건·화면이 기대와 다르다고 말한 곳 = 스펙과 앱이 다를 가능성
const SPEC_HINT = /사전조건|스펙|기대와 다르|예상과 다르|없습니다|보이지 않|다른 화면|추가로|확인 팝업|팝업이 떴/;
const hints = rows.flatMap((x) =>
  x.thoughts
    .filter((t) => t.includes('[decide]') && SPEC_HINT.test(t))
    .map((t) => ({ tc: x.r.tcId, t: t.replace(/^.*\[decide\] /, '') })),
);
if (hints.length) {
  out.push('', '## 스펙·앱 차이 후보 (Agent 판단 기록)', '');
  for (const h of hints) out.push(`- **${h.tc}** ${h.t}`);
}

out.push(
  '',
  '## 케이스별',
  '',
  '| 케이스 | 판정 | 시간 | 호출 | 비용 | 액션 | 승인 |',
  '|---|---|---|---|---|---|---|',
);
for (const x of rows) {
  out.push(
    `| ${x.r.tcId} ${cell(title(x.r.tcId))} | ${VERDICT_LABEL[x.r.verdict]} | ${sec(x.m.ms)} | ${x.m.calls} | ${usd(x.m.costUsd)} | ${x.m.actions} | ${x.m.approval} |`,
  );
}

const file = join(dir, 'report.md');
await writeFile(file, out.join('\n') + '\n');
console.log(out.slice(0, 40).join('\n'));
console.log(`\n→ ${file}`);
