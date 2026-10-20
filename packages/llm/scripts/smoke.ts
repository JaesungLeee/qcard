/**
 * 실제 API 연결 확인 (호출 2번, 1센트 미만). 도구 스키마(strict)와 structured output 스키마를
 * API가 받아들이는지, 응답이 Zod 검증을 통과하는지 본다. 녹화 파일은 만들지 않는다.
 *
 *   ANTHROPIC_API_KEY=… pnpm llm:smoke     (또는 `ant auth login` 후)
 */
import { FakeDevice, formatTree } from '@qcard/device';
import { onboardingScenario } from '@qcard/fixtures';
import { EXECUTOR_TOOL_INPUTS, VerifierOutput } from '@qcard/shared';
import {
  cachedSystem,
  createLlm,
  EXECUTOR_TOOLS,
  MODELS,
  outputFormat,
  parseOutput,
  parseToolUse,
  toolUses,
  UsageMeter,
} from '../src';

const meter = new UsageMeter({ maxCallsPerCase: 4 });
const llm = createLlm({ mode: 'live', cassetteDir: '', meter });
const tree = formatTree(await new FakeDevice({ ...onboardingScenario(), start: 'profile' }).dumpTree());

const exec = await llm.create(
  {
    model: MODELS.executor,
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    tools: EXECUTOR_TOOLS,
    system: cachedSystem(
      'Android 앱 QA Executor다. 케이스 단계를 디바이스 액션 도구로 수행한다. 매 턴 도구를 하나 이상 부른다.',
    ),
    messages: [
      {
        role: 'user',
        content: `단계 0: 닉네임 입력란에 "harukong01"을 입력한다.\n\n현재 화면 접근성 트리:\n${tree}`,
      },
    ],
  },
  { role: 'executor', caseId: 'smoke' },
);
console.log(`Executor stop_reason=${exec.stop_reason}`);
for (const t of toolUses(exec)) console.log('  도구', parseToolUse(t, EXECUTOR_TOOL_INPUTS));

const verify = await llm.create(
  {
    model: MODELS.verifier,
    max_tokens: 4000,
    output_config: { effort: 'medium', format: outputFormat(VerifierOutput) },
    messages: [
      {
        role: 'user',
        content: `검증 포인트: 하단에 [저장] 버튼이 보인다.\n\n접근성 트리:\n${tree}`,
      },
    ],
  },
  { role: 'verifier', caseId: 'smoke' },
);
console.log('Verifier', parseOutput(verify, VerifierOutput));

const t = meter.run;
console.log(`\n호출 ${t.calls}회 · 토큰 ${t.tokens} · $${t.costUsd.toFixed(4)}`);
