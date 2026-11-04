/**
 * 답변 기반 케이스 수정안을 실제 모델로 만들어 본다 (본인 Claude Code·Opus — 플랜 사용량 차감).
 * 웹·호스트 흐름 전에 수정안 품질을 확인하는 개발용 명령이다. 결과는 화면에 출력만 한다(Firestore에 올리지 않음).
 *
 *   pnpm --filter @qcard/qadoc revise <docs/specs 폴더> --doc <generate 결과.json> --tc <TC ID> [옵션]
 *     --answer Q-1=<답변>    아직 답이 없는 질문에 답을 넣어 본다 (여러 번 쓸 수 있다)
 *     --cassettes <폴더>     호출 녹화 폴더. 같은 요청은 다시 부르지 않고 재생한다
 *
 * 실제 팀 스펙과 결과·녹화는 저장소 밖(../qcard-specs/)에 둔다.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertClaudeCodeReady,
  createCassetteLlm,
  createLiveLlm,
  llmProviderFromEnv,
  MODELS_FOR,
  UsageMeter,
  withUsage,
} from '@qcard/llm';
import { CaseBody, type PrepFlow, type QADocument } from '@qcard/shared';
import { readBundle, type BundleFile } from '@qcard/spec';
import { reviseCase } from '../src';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    doc: { type: 'string' },
    tc: { type: 'string' },
    answer: { type: 'string', multiple: true },
    cassettes: { type: 'string' },
  },
});
const root = positionals[0];
if (!root || !values.doc || !values.tc) {
  console.error('사용법: revise <docs/specs 폴더> --doc <결과.json> --tc <TC ID> [--answer Q-1=답변]');
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

/** 저장소 밖 qcard-specs: 위로 올라가며 찾는다 (워크트리에서 돌려도 본 저장소 옆 폴더를 찾는다) */
function specsDir(): string {
  for (let dir = import.meta.dirname; dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, 'qcard-specs'))) return join(dir, 'qcard-specs');
  }
  return resolve(import.meta.dirname, '../../../../qcard-specs');
}

const saved = JSON.parse(await readFile(values.doc, 'utf8')) as { doc: QADocument; prepFlows: PrepFlow[] };
const current = saved.doc.cases.find((c) => c.tcId === values.tc);
if (!current) throw new Error(`케이스 없음: ${values.tc}`);
const answers = new Map(
  (values.answer ?? []).map((a) => {
    const i = a.indexOf('=');
    return [a.slice(0, i), a.slice(i + 1)] as const;
  }),
);
const questions = saved.doc.questions
  .filter((q) => q.caseIds.includes(current.tcId))
  .map((q) => (answers.has(q.id) ? { ...q, status: 'answered' as const, answer: answers.get(q.id)! } : q));

const files: BundleFile[] = await Promise.all(
  (await walk(root)).map(async (p) => ({ path: relative(root, p), content: await readFile(p, 'utf8') })),
);
const spec = readBundle(files).specs.find((s) => s.name === current.sourceRef.spec);
if (!spec) throw new Error(`스펙 없음: ${current.sourceRef.spec}`);

if (llmProviderFromEnv() === 'claude-cli') {
  const s = await assertClaudeCodeReady(MODELS_FOR.qadoc);
  console.log(
    `LLM: Claude Code ${s.version} · ${s.authMethod}${s.subscriptionType ? ` · ${s.subscriptionType} 플랜` : ''}`,
  );
}
const meter = new UsageMeter();
const llm = withUsage(
  createCassetteLlm({
    dir: resolve(values.cassettes ?? join(specsDir(), 'cassettes/qadoc')),
    mode: 'resume',
    inner: createLiveLlm(undefined, { turnTimeoutMs: 600_000 }),
  }),
  meter,
);

const started = Date.now();
const r = await reviseCase({ current, spec, questions, prepFlows: saved.prepFlows, llm });
console.log(`\n${current.tcId} ${current.title}`);
for (const q of questions.filter((x) => x.status === 'answered'))
  console.log(`  ${q.id}: ${q.text}\n    → ${q.answer}`);
console.log(`\n결과: ${r.kind === 'revise' ? '수정안' : '수정 불필요'}\n근거: ${r.reason}`);
if (r.kind === 'revise') {
  const before = CaseBody.parse(current);
  for (const key of Object.keys(r.body) as (keyof CaseBody)[]) {
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(r.body[key]);
    if (a !== b) console.log(`\n[${key}]\n  지금:   ${a}\n  수정안: ${b}`);
  }
  if (r.guessed.length) console.log(`\n추정으로 바꾼 버튼 이름: ${r.guessed.join(', ')}`);
}
console.log(
  `\n토큰 ${meter.run.tokens.toLocaleString()} · 환산 $${meter.run.costUsd.toFixed(3)} · ${Math.round((Date.now() - started) / 1000)}초`,
);
