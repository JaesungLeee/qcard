/**
 * 가상 앱 하루콩의 온보딩 스펙(spec/onboarding-flow/spec.md)을 파서로 읽어 fixture 데이터로 저장한다.
 * 스펙을 고치면 다시 돌린다. 검증 포인트(onboarding-points.json)는 행 ID에 맞춰 따로 고친다.
 *
 *   pnpm --filter @qcard/fixtures gen-spec
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSpec } from '@qcard/spec';

const root = resolve(import.meta.dirname, '..');
const markdown = await readFile(resolve(root, 'spec/onboarding-flow/spec.md'), 'utf8');
const { spec, warnings } = parseSpec('onboarding-flow', markdown);
if (warnings.length) throw new Error(`스펙 경고:\n${warnings.join('\n')}`);

const out = {
  spec: spec.name,
  feature: '[SCR-001] 첫 실행 온보딩',
  requirements: spec.requirements.map((r) => ({ id: r.id, text: r.text, line: r.line })),
  rows: spec.rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    title: r.title,
    given: r.given,
    when: r.when,
    then: r.then,
    frs: r.frs,
    flow: r.flow,
    line: r.line,
  })),
};
await writeFile(resolve(root, 'src/data/onboarding-flow.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`요구사항 ${out.requirements.length} · 행 ${out.rows.length}`);
