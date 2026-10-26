import type { SpecQuestion } from '@qcard/shared';
import { readBundle } from '@qcard/spec';
import { describe, expect, it } from 'vitest';
import { fakeGeneratorLlm, fakeReviseLlm } from './fake';
import { generateQaDoc } from './generate';
import type { ReviseOutput } from './prompts';
import { reviseCase } from './revise';

// 합성 스펙 (generate.test.ts와 같은 모양)
const SPEC = `# 스펙 명세서: 샘플 기능

## 1. 유저 시나리오

### 유저 플로우 1 - 처음 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-001 | 첫 화면 | 처음 설치함 | 앱을 연다 | 하단에서 40px 위에 \`시작하기\`가 보인다 | FR-001 |
| TS-002 | 시작 | 첫 화면 | [시작하기] | 홈으로 이동한다 | FR-002 |

## 2. 요구사항

### 2.1 기능적 요구사항

- **FR-001**: 첫 화면을 보여 준다.
- **FR-002**: 시작하면 홈을 연다.
`;

const bundle = readBundle([{ path: 'sample/spec.md', content: SPEC }]);
const spec = bundle.specs[0]!;
const { doc, prepFlows } = await generateQaDoc({
  bundle,
  prepFlows: [],
  llm: fakeGeneratorLlm().llm,
  meta: { id: 'doc-1', projectId: 'p', appVersion: '1.0.0', specBundleId: 'b-1', createdAt: '2026-10-25T10:00:00Z' },
});
const current = doc.cases.find((c) => c.sourceId === 'sample/TS-001')!;

const question = (over: Partial<SpecQuestion> = {}): SpecQuestion => ({
  id: 'Q-1',
  requirementId: 'sample/FR-001',
  caseIds: [current.tcId],
  text: '40px은 내비게이션 바 위가 기준인가요?',
  assignee: '',
  status: 'answered',
  answer: '내비게이션 바 위 기준입니다.',
  comments: [],
  ...over,
});

const revised: ReviseOutput = {
  decision: 'revise',
  reason: 'Q-1 답변대로 위치 기준을 내비게이션 바 위로 바꿨다.',
  case: {
    title: current.title,
    preconditions: current.preconditions,
    data: null,
    account_kind: null,
    steps: [
      { text: '앱을 연다', manual: false, risk: null },
      { text: '[계속]을 누른다', manual: false, risk: null },
    ],
    points: [
      { target: '시작하기 버튼', compare: 'visible', expected: '내비게이션 바 위 40px에 보인다', method: 'vision' },
    ],
    priority: 'medium',
    type: 'ui',
    platform: 'common',
    mode: 'auto',
  },
};

describe('reviseCase', () => {
  it('출처 행·지금 케이스·답변을 넘기고, 수정안을 케이스 본문으로 돌려준다', async () => {
    const { llm, prompts } = fakeReviseLlm(revised);
    const r = await reviseCase({ current, spec, questions: [question()], prepFlows, llm });
    expect(prompts[0]).toContain('[TS-001] 첫 화면');
    expect(prompts[0]).toContain(`## 지금 케이스 ${current.tcId}`);
    expect(prompts[0]).toContain('- Q-1 (FR-001): 40px은 내비게이션 바 위가 기준인가요?\n  → 답변: 내비게이션 바 위 기준입니다.');
    expect(r.kind).toBe('revise');
    if (r.kind !== 'revise') return;
    // 준비 플로우·포인트 ID는 코드가 정하고, 근거 없는 버튼 이름은 추정으로 바꾼다
    expect(r.body.prepFlowIds).toEqual(current.prepFlowIds);
    expect(r.body.cleanState).toBe(current.cleanState);
    expect(r.body.verificationPoints[0]!.id).toBe(`${current.tcId}-P1`);
    expect(r.body.steps[1]!.text).toBe('계속(추정)을 누른다');
    expect(r.guessed).toEqual(['계속']);
  });

  it('수정 불필요는 이유만, revise여도 바뀐 것이 없으면 수정 불필요', async () => {
    const none = await reviseCase({
      current,
      spec,
      questions: [question()],
      prepFlows,
      llm: fakeReviseLlm({ decision: 'no_change', reason: '이미 그렇게 쓰여 있다.', case: null }).llm,
    });
    expect(none).toEqual({ kind: 'no_change', reason: '이미 그렇게 쓰여 있다.' });

    const same: ReviseOutput = {
      decision: 'revise',
      reason: '그대로',
      case: {
        title: current.title,
        preconditions: current.preconditions,
        data: current.data ?? null,
        account_kind: current.accountKind ?? null,
        steps: current.steps.map((s) => ({ text: s.text, manual: s.manual, risk: s.risk ?? null })),
        points: current.verificationPoints.map(({ id: _, ...p }) => p),
        priority: current.priority,
        type: current.type,
        platform: current.platform,
        mode: current.mode,
      },
    };
    const r = await reviseCase({ current, spec, questions: [question()], prepFlows, llm: fakeReviseLlm(same).llm });
    expect(r.kind).toBe('no_change');
  });

  it('형식이 틀리면 한 번 다시 묻고, 답변이 없거나 출처 행이 없으면 부르지 않는다', async () => {
    const { llm, prompts } = fakeReviseLlm('{"decision":"revise","reason":"x","case":null}', revised);
    const r = await reviseCase({ current, spec, questions: [question()], prepFlows, llm });
    expect(r.kind).toBe('revise');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('이전 응답 형식 오류');

    const idle = fakeReviseLlm(revised);
    await expect(
      reviseCase({ current, spec, questions: [question({ status: 'proceed' })], prepFlows, llm: idle.llm }),
    ).rejects.toThrow('반영할 답변이 없습니다');
    await expect(
      reviseCase({
        current: { ...current, sourceId: 'sample/TS-099' },
        spec,
        questions: [question()],
        prepFlows,
        llm: idle.llm,
      }),
    ).rejects.toThrow('출처 행이 스펙에 없습니다');
    expect(idle.prompts).toHaveLength(0);
  });
});
