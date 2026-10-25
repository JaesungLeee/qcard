import { cachedSystem, LlmOutputError, MODELS, outputFormat, parseOutput, type LlmClient } from '@qcard/llm';
import { CaseBody, type PrepFlow, type SpecQuestion, type TestCase } from '@qcard/shared';
import type { SpecDoc } from '@qcard/spec';
import { nameChecker, unmarkUnknownNames } from './names';
import { bodyOf, flowText, rowText, specSources } from './parts';
import { REVISE_SYSTEM, ReviseOutput } from './prompts';

/*
 * 답변 기반 케이스 수정안 (PRD F-QD-17): 케이스 하나 + 출처 스펙 행 + 답변된 확인 질문 → 수정안 또는 "수정 불필요".
 * 케이스를 바꾸지 않는다 — 결과를 돌려주면 호출한 쪽(호스트)이 작업 결과로 저장하고, 사람이 웹에서 diff를 보고 적용한다.
 * 준비 플로우·TC ID·검증 포인트 ID 규칙은 코드가 정한다.
 */

export type ReviseInput = {
  current: TestCase;
  /** 케이스의 출처 스펙 (케이스를 만든 스펙 묶음의 것) */
  spec: SpecDoc;
  /** 반영할 답변된 질문 */
  questions: SpecQuestion[];
  prepFlows: PrepFlow[];
  llm: LlmClient;
  model?: string;
};

export type ReviseResult =
  | { kind: 'revise'; reason: string; body: CaseBody; /** 근거 없어 `(추정)`으로 바꾼 버튼 이름 */ guessed: string[] }
  | { kind: 'no_change'; reason: string };

export async function reviseCase(input: ReviseInput): Promise<ReviseResult> {
  const { current, spec, questions } = input;
  const rowId = current.sourceId.split('/').at(-1)!;
  const row = spec.rows.find((r) => r.id === rowId);
  if (!row) throw new Error(`출처 행이 스펙에 없습니다: ${current.sourceId}`);
  const answered = questions.filter((q) => q.status === 'answered' && q.answer);
  if (!answered.length) throw new Error('반영할 답변이 없습니다');

  const out = await ask(input.llm, input.model ?? MODELS.generator, revisePrompt(input, rowText(row, spec), answered));
  if (out.decision === 'no_change' || !out.case) return { kind: 'no_change', reason: out.reason };

  // 버튼 이름 근거: 스펙 본문 + 준비 플로우 + 사람이 검토한 지금 케이스
  const known = nameChecker([
    ...specSources(spec),
    ...input.prepFlows.flatMap((f) => [f.check, ...f.steps]),
    ...current.steps.map((s) => s.text),
  ]);
  const guessed: string[] = [];
  const steps = out.case.steps.map((s) => {
    const r = unmarkUnknownNames(s.text, known);
    guessed.push(...r.guessed);
    return { ...s, text: r.text };
  });
  const body = bodyOf({ ...out.case, steps, row_id: rowId, questions: [] }, current.tcId, {
    prepFlowIds: current.prepFlowIds,
    cleanState: current.cleanState,
    ...(current.restoreFlowId ? { restoreFlowId: current.restoreFlowId } : {}),
  });
  // 모델이 revise라고 했어도 바뀐 것이 없으면 수정 불필요다
  if (JSON.stringify(body) === JSON.stringify(CaseBody.parse(current))) return { kind: 'no_change', reason: out.reason };
  return { kind: 'revise', reason: out.reason, body, guessed };
}

function revisePrompt(input: ReviseInput, row: string, answered: SpecQuestion[]): string {
  const c = input.current;
  const flows = c.prepFlowIds.map((id) => input.prepFlows.find((f) => f.id === id)).filter((f) => f !== undefined);
  const now = {
    title: c.title,
    preconditions: c.preconditions,
    data: c.data ?? null,
    account_kind: c.accountKind ?? null,
    steps: c.steps.map((s) => ({ text: s.text, manual: s.manual, risk: s.risk ?? null })),
    points: c.verificationPoints.map(({ id: _, ...p }) => p),
    priority: c.priority,
    type: c.type,
    platform: c.platform,
    mode: c.mode,
  };
  return [
    `# 스펙: ${input.spec.name} — ${input.spec.title}`,
    '',
    '## 출처 행',
    row,
    '',
    '## 케이스 시작 전 수행하는 준비 플로우',
    flows.length ? flows.map(flowText).join('\n') : '(없음 — 앱 실행 직후)',
    '',
    `## 지금 케이스 ${c.tcId} (사람이 고쳤을 수 있음)`,
    JSON.stringify(now),
    '',
    '## 답변된 스펙 확인 질문',
    ...answered.map((q) => `- ${q.id} (${q.requirementId.split('/').at(-1)}): ${q.text}\n  → 답변: ${q.answer}`),
  ].join('\n');
}

/** 구조화 출력 호출. 형식이 틀리면 한 번 다시 묻는다. 플랜 한도·로그인 오류는 그대로 던진다 */
async function ask(llm: LlmClient, model: string, prompt: string): Promise<ReviseOutput> {
  let note = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await llm.create(
        {
          model,
          max_tokens: 16000,
          output_config: { effort: 'medium', format: outputFormat(ReviseOutput) },
          system: cachedSystem(REVISE_SYSTEM),
          messages: [{ role: 'user', content: prompt + note }],
        },
        { role: 'generator' },
      );
      const out = parseOutput(res, ReviseOutput);
      if (out.decision === 'revise' && !out.case) throw new LlmOutputError('revise인데 case가 비었다');
      return out;
    } catch (e) {
      if (attempt || !(e instanceof LlmOutputError)) throw e;
      note = `\n\n(이전 응답 형식 오류: ${e.message}. 스키마대로 다시 낸다.)`;
    }
  }
}
