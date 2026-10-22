/**
 * 실제 스펙 폴더로 QA 문서를 만든다 (QA Doc Generator, 본인 Claude Code·Opus — 플랜 사용량 차감).
 * 웹 Job 흐름 전에 생성 품질을 확인하는 개발용 명령이다. 결과는 JSON 파일로만 쓴다(Firestore에 올리지 않음).
 *
 *   pnpm --filter @qcard/qadoc generate <docs/specs 폴더> --out <결과.json> [옵션]
 *     --only a,b             이 스펙만
 *     --prev-doc <json>      이전 버전 결과(이 명령의 출력). 동일 행은 복사하고 변경·신규만 생성한다
 *     --prev <폴더>          이전 버전 스펙 폴더 (변경 행에 이전 행 본문을 함께 넘긴다)
 *     --cassettes <폴더>     호출 녹화 폴더. 같은 요청은 다시 부르지 않고 재생한다(중단 후 이어 하기)
 *     --app-version <버전>
 *
 * 하루콩 스펙과 결과·녹화는 저장소 밖(../qcard-specs/)에 둔다.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertClaudeCodeReady,
  createCassetteLlm,
  createLiveLlm,
  llmProviderFromEnv,
  UsageMeter,
  withUsage,
  type LlmClient,
} from '@qcard/llm';
import type { PrepFlow, QADocument } from '@qcard/shared';
import { readBundle, type BundleFile } from '@qcard/spec';
import { generateQaDoc } from '../src';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    only: { type: 'string' },
    'prev-doc': { type: 'string' },
    prev: { type: 'string' },
    cassettes: { type: 'string' },
    'app-version': { type: 'string', default: 'dev' },
  },
});
const root = positionals[0];
if (!root || !values.out) {
  console.error(
    '사용법: generate <docs/specs 폴더> --out <결과.json> [--only a,b] [--prev-doc <json>] [--prev <폴더>]',
  );
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
const load = async (dir: string) => {
  const files: BundleFile[] = await Promise.all(
    (await walk(dir)).map(async (p) => ({ path: relative(dir, p), content: await readFile(p, 'utf8') })),
  );
  const b = readBundle(files);
  const only = values.only?.split(',');
  return only ? { ...b, specs: b.specs.filter((s) => only.includes(s.name)) } : b;
};

type Saved = { doc: QADocument; prepFlows: PrepFlow[] };
const prevSaved = values['prev-doc'] ? (JSON.parse(await readFile(values['prev-doc'], 'utf8')) as Saved) : undefined;

if (llmProviderFromEnv() === 'claude-cli') {
  const s = await assertClaudeCodeReady();
  console.log(
    `LLM: Claude Code ${s.version} · ${s.authMethod}${s.subscriptionType ? ` · ${s.subscriptionType} 플랜` : ''}`,
  );
}

// 녹화가 있으면 재생, 없으면 실제로 부르고 녹화한다
// 스펙 계획은 행이 많으면 응답이 2~3분 걸린다 (실측 place-detail 76행 143초)
const live = createLiveLlm(undefined, { turnTimeoutMs: 600_000 });
const cassetteDir = resolve(values.cassettes ?? join(import.meta.dirname, '../../../../qcard-specs/cassettes/qadoc'));
// 녹화가 있으면 재생, 없으면 실제로 부르고 녹화한다 (실제 호출 수를 세어 재생 수를 보인다)
let liveCalls = 0;
const counted: LlmClient = { create: (req, meta) => (liveCalls++, live.create(req, meta)) };
const meter = new UsageMeter();
const llm = withUsage(createCassetteLlm({ dir: cassetteDir, mode: 'resume', inner: counted }), meter);

const started = Date.now();
const bundle = await load(root);
const result = await generateQaDoc({
  bundle,
  prev: prevSaved?.doc,
  prevBundle: values.prev ? await load(values.prev) : undefined,
  prepFlows: prevSaved?.prepFlows ?? [],
  llm,
  meta: {
    id: `doc-${values['app-version']}`,
    projectId: 'local',
    appVersion: values['app-version'],
    specBundleId: `bundle-${values['app-version']}`,
    createdAt: new Date().toISOString(),
  },
  onProgress: (e) =>
    console.log(
      e.kind === 'plan'
        ? `계획 ${e.spec} · 대상 ${e.targets}행`
        : `  ${e.done}/${e.total} ${e.spec} ${e.rows.join(' ')} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
    ),
});
live.close?.();

const prepFlows = [...(prevSaved?.prepFlows ?? []), ...result.prepFlows];
await writeFile(values.out, JSON.stringify({ ...result, prepFlows }, null, 2) + '\n');

const { doc } = result;
const n = (k: string) => doc.cases.filter((c) => c.change === k).length;
console.log(
  `\n케이스 ${doc.cases.length} (동일 ${n('same')} · 변경 ${n('changed')} · 신규 ${n('new')} · 삭제 ${n('removed')}) · 제외 ${result.skipped.length}`,
);
console.log(
  `준비 플로우 +${result.prepFlows.length} · 질문 ${doc.questions.length} · 보강 제안 ${doc.suggestions.length} · Manual ${doc.cases.filter((c) => c.mode === 'manual').length}`,
);
for (const w of result.warnings) console.log(`  ⚠ ${w}`);
console.log(
  `호출 ${meter.run.calls} (재생 ${meter.run.calls - liveCalls}) · 토큰 ${meter.run.tokens.toLocaleString()} · 환산 $${meter.run.costUsd.toFixed(2)} · ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
console.log(`저장: ${values.out}`);
process.exit(0);
