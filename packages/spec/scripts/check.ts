/**
 * 실제 스펙 폴더 점검 (읽기 전용, LLM 없음). 스펙마다 요구사항·TS·EC 개수와 경고를 보이고,
 * onboarding-flow는 fixture(packages/fixtures/src/data/onboarding-flow.json)와 비교한다.
 *
 *   pnpm --filter @qcard/spec check <docs/specs 폴더> [--prev <이전 버전 docs/specs 폴더>]
 *     --prev를 주면 이전 버전과 출처 ID로 매칭해 스펙별 동일·변경·신규·삭제 개수를 보인다 (F-QD-08)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { TestCase } from '@qcard/shared';
import { parseArgs } from 'node:util';
import { matchVersions, readBundle, type BundleFile } from '../src';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { prev: { type: 'string' } } });
const root = positionals[0];
if (!root) {
  console.error('사용법: check <docs/specs 폴더>');
  process.exit(1);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const load = async (dir: string): Promise<BundleFile[]> =>
  Promise.all((await walk(dir)).map(async (p) => ({ path: relative(dir, p), content: await readFile(p, 'utf8') })));
const bundle = readBundle(await load(root));
let ts = 0;
let ec = 0;
for (const s of bundle.specs) {
  const n = (k: string) => s.rows.filter((r) => r.kind === k).length;
  ts += n('TS');
  ec += n('EC');
  console.log(
    `${s.name.padEnd(24)} v${(s.version ?? '?').padEnd(6)} FR ${String(s.requirements.filter((r) => r.kind === 'FR').length).padStart(3)} UX ${String(s.requirements.filter((r) => r.kind === 'UX').length).padStart(2)} TS ${String(n('TS')).padStart(3)} EC ${String(n('EC')).padStart(3)} 플로우 ${s.flows.length}${bundle.warnings[s.name] ? ` · 경고 ${bundle.warnings[s.name]!.length}` : ''}`,
  );
  for (const w of bundle.warnings[s.name] ?? []) console.log(`    ⚠ ${w}`);
}
console.log(`\n스펙 ${bundle.specs.length}개 · TS ${ts} · EC ${ec} · 입력 아닌 파일 ${bundle.ignored}개`);

// fixture와 비교 (fixture를 만든 시점 이후 스펙이 바뀌었으면 차이가 날 수 있다)
const fixture = JSON.parse(
  await readFile(resolve(import.meta.dirname, '../../fixtures/src/data/onboarding-flow.json'), 'utf8'),
) as {
  requirements: { id: string; text: string }[];
  rows: { id: string; title: string; given: string; when: string; then: string; frs: string[]; flow: string }[];
};
const onb = bundle.specs.find((s) => s.name === 'onboarding-flow');
if (onb) {
  const diffs: string[] = [];
  for (const f of fixture.rows) {
    const r = onb.rows.find((x) => x.id === f.id);
    if (!r) diffs.push(`${f.id}: 파서 결과에 없음`);
    else
      for (const k of ['title', 'given', 'when', 'then', 'flow'] as const)
        if (r[k] !== f[k]) diffs.push(`${f.id}.${k}: 「${f[k]}」 ≠ 「${r[k]}」`);
  }
  for (const f of fixture.requirements) {
    const r = onb.requirements.find((x) => x.id === f.id);
    if (!r) diffs.push(`${f.id}: 파서 결과에 없음`);
    else if (r.text !== f.text) diffs.push(`${f.id}: 본문 다름`);
  }
  console.log(
    `\nonboarding-flow ↔ fixture: 행 ${fixture.rows.length}·요구사항 ${fixture.requirements.length} 비교, 차이 ${diffs.length}`,
  );
  for (const d of diffs.slice(0, 20)) console.log(`    ${d}`);
}

// 이전 버전과 매칭: 이전 버전 스펙으로 케이스를 "만든" 것처럼 출처 ID·해시·TC ID만 채운 문서를 꾸민다
if (values.prev) {
  const prevPlan = matchVersions(readBundle(await load(values.prev)));
  const prevDoc = {
    cases: prevPlan.rows.map(
      (r) => ({ tcId: r.tcId, sourceId: r.sourceId, sourceHash: r.sourceHash, change: 'new' }) as TestCase,
    ),
  };
  const plan = matchVersions(bundle, prevDoc);
  console.log(`\n이전 버전 대비 (동일 / 변경 / 신규 / 삭제)`);
  const names = [
    ...new Set([...plan.rows.map((r) => r.spec.name), ...plan.removed.map((c) => c.sourceId.split('/')[0]!)]),
  ];
  for (const name of names) {
    const rs = plan.rows.filter((r) => r.spec.name === name);
    const n = (d: string) => String(rs.filter((r) => r.decision === d).length).padStart(3);
    const removed = String(plan.removed.filter((c) => c.sourceId.startsWith(`${name}/`)).length).padStart(3);
    console.log(`${name.padEnd(24)} ${n('same')} / ${n('changed')} / ${n('new')} / ${removed}`);
  }
  const c = plan.counts;
  console.log(`합계 ${c.same} / ${c.changed} / ${c.new} / ${c.removed} → LLM 변환 대상 ${c.changed + c.new}행`);
}
