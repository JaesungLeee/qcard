/**
 * 스펙 행(Given·When·Then)에서 검증 포인트를 만든다 (QA 문서 생성기의 시험판, Opus 5.5).
 * 결과는 packages/fixtures/src/data/onboarding-points.json에 저장하고 fixture가 그대로 쓴다 (재현 가능하도록 커밋).
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @qcard/agent gen-points
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SPEC_INPUT } from '@qcard/fixtures';
import { cachedSystem, createLlm, outputFormat, parseOutput, UsageMeter } from '@qcard/llm';
import { PointCompare, PointMethod } from '@qcard/shared';
import { z } from 'zod';

const MODEL = 'claude-opus-5-5';
const OUT = resolve(import.meta.dirname, '../../fixtures/src/data/onboarding-points.json');

const GenPoint = z.object({
  target: z
    .string()
    .describe('화면에서 찾을 대상 이름 (명사구). 예: 취소 확인 모달, 튜토리얼 스텝 화면, 바텀 네비게이션'),
  compare: PointCompare,
  expected: z.string().describe('이 포인트 하나의 기대 결과 (한 문장)'),
  method: PointMethod,
});
const GenOutput = z.object({ cases: z.array(z.object({ row_id: z.string(), points: z.array(GenPoint) })) });
export type GenPoint = z.infer<typeof GenPoint>;

const SYSTEM = `너는 Android 앱 QA 문서 작성자다. 스펙의 테스트 시나리오(Given·When·Then)를 받아 Then을 검증 포인트로 나눈다.
검증 포인트는 실행 후 화면 한 장(접근성 트리, 필요하면 스크린샷)으로 판정된다. 판정은 다른 Agent가 한다.

규칙
1. 한 포인트에는 확인 하나만 담는다. "A로 이동한다. B는 띄우지 않는다"는 두 포인트다.
2. target은 화면에서 찾을 대상의 이름(명사구)이다. 문장 조각을 쓰지 않는다. 예: "취소 확인 모달", "튜토리얼 스텝 화면", "첫 습관 만들기 스텝 화면", "복사 완료 토스트".
3. compare
   - screen: 특정 화면·스텝이 열려 있다 (이동한다, 연다, 머무른다, 되돌아가지 않는다 → 결과로 보여야 할 화면을 target으로)
   - visible: 특정 요소가 보인다
   - not_visible: 특정 요소가 보이면 안 된다. 보이면 안 되는 "그 요소"를 target으로 한다. 동작을 부정하는 문장("이동하지 않는다")에는 쓰지 않는다 — 대신 남아 있어야 할 화면을 screen으로 쓴다
   - text_exists: 정확한 문구가 보인다. 문구를 백틱으로 expected에 넣는다
   - count: 요소 개수 (숫자를 expected에 넣는다)
   - size_dp: 크기. 기대값이 dp일 때만. px 위치·간격은 visible + vision으로 쓴다
   - state: 화면으로 알 수 없는 앱 내부 상태·기록·저장·클립보드·서버 데이터 (자동으로 사람 확인으로 넘어간다)
4. method: tree가 기본이다. 위치·간격·색·이미지·레이아웃처럼 픽셀을 봐야 하면 vision.
5. 화면 한 장으로 판단할 수 없는 것(이전 상태와의 비교, 동작 이력)은 결과 화면으로 바꿔 쓸 수 있으면 screen/visible로, 아니면 state로 쓴다.
6. Then에 없는 기대를 지어내지 않는다. Given·When은 맥락으로만 쓴다.`;

type Item = { id: string; title: string; given: string; when: string; then: string; frs: string[] };
const reqText = new Map(SPEC_INPUT.requirements.map((r) => [r.id, r.text]));
const items: Item[] = [
  ...SPEC_INPUT.rows,
  // 1.2.0의 이전 기대 결과 (변경 케이스의 diff용)
  ...Object.entries(SPEC_INPUT.previousThen).map(([id, then]) => {
    const row = SPEC_INPUT.rows.find((r) => r.id === id)!;
    return { ...row, id: `${id}@prev`, then };
  }),
];

const meter = new UsageMeter();
const llm = createLlm({ mode: 'live', cassetteDir: '', meter });
const out: Record<string, GenPoint[]> = {};
const BATCH = 8;
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  const text = batch
    .map(
      (r) =>
        `[${r.id}] ${r.title}\nGiven: ${r.given || '—'}\nWhen: ${r.when}\nThen: ${r.then}\n관련 요구사항: ${r.frs.map((f) => `${f} ${reqText.get(f) ?? ''}`).join(' / ')}`,
    )
    .join('\n\n');
  const res = await llm.create(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: outputFormat(GenOutput) },
      system: cachedSystem(SYSTEM),
      messages: [{ role: 'user', content: `스펙: ${SPEC_INPUT.spec}\n\n시나리오 ${batch.length}개:\n\n${text}` }],
    },
    { role: 'helper' },
  );
  for (const c of parseOutput(res, GenOutput).cases) out[c.row_id] = c.points;
  const missing = batch.filter((r) => !out[r.id]).map((r) => r.id);
  console.log(
    `${Math.min(i + BATCH, items.length)}/${items.length}${missing.length ? ` · 누락 ${missing.join(', ')}` : ''}`,
  );
  if (missing.length) throw new Error(`응답에 없는 시나리오: ${missing.join(', ')}`);
}

await writeFile(
  OUT,
  JSON.stringify({ generatedBy: MODEL, generatedAt: new Date().toISOString(), points: out }, null, 2) + '\n',
);
console.log(`저장: ${OUT} · 호출 ${meter.run.calls} · $${meter.run.costUsd.toFixed(3)}`);
