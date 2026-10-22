import { hash, type QADocument, type TestCase } from '@qcard/shared';
import { readBundle } from '@qcard/spec';
import { describe, expect, it } from 'vitest';
import { fakeGeneratorLlm } from './fake';
import { CLEAN_FLOW, generateQaDoc, type GenerateInput } from './generate';

// 팀 스펙 템플릿 모양의 합성 문서 (실제 스펙 원문은 저장소에 두지 않는다)
const SPEC = `# 스펙 명세서: 샘플 기능

**버전**: 1.0.0

## 1. 유저 시나리오

### 유저 플로우 1 - 처음 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-001 | 첫 화면 | 처음 설치함 | 앱을 연다 | \`시작하기\`가 보인다 | FR-001 |
| TS-002 | 시작 | 첫 화면 | [시작하기] | 홈으로 이동한다 | FR-002 |
| TS-003 | iOS 스와이프 | 첫 화면 | 왼쪽 가장자리 스와이프 | 앱이 닫힌다 | FR-002 |

| ID | 상황 | 처리 | 관련 FR |
|---|---|---|---|
| EC-001 | 네트워크가 없다 | 재시도 안내를 띄운다 | FR-001 |

## 2. 요구사항

### 2.1 기능적 요구사항

- **FR-001**: 첫 화면을 보여 준다.
- **FR-002**: 시작하면 홈을 연다.
`;

const bundleOf = (md: string) => readBundle([{ path: 'sample/spec.md', content: md }]);
const META = {
  id: 'doc-1',
  projectId: 'p',
  appVersion: '1.0.0',
  specBundleId: 'b-1',
  createdAt: '2026-10-22T10:00:00+09:00',
};


const run = (over: Partial<GenerateInput> & Pick<GenerateInput, 'llm'>) =>
  generateQaDoc({ bundle: bundleOf(SPEC), prepFlows: [], meta: META, ...over });

describe('generateQaDoc — 첫 버전', async () => {
  const { llm, calls } = fakeGeneratorLlm();
  const { doc, prepFlows, skipped, warnings } = await run({ llm });
  const byId = (src: string) => doc.cases.find((c) => c.sourceId === `sample/${src}`)!;

  it('스펙 계획 1번 + 케이스 변환 묶음으로 부르고, 모든 행이 신규 케이스가 된다', () => {
    expect(calls.map((c) => c.kind)).toEqual(['plan', 'case']);
    expect(doc.cases.map((c) => [c.tcId, c.sourceId, c.change])).toEqual([
      ['TC-SAMPLE-001', 'sample/TS-001', 'new'],
      ['TC-SAMPLE-002', 'sample/TS-002', 'new'],
      ['TC-SAMPLE-004', 'sample/EC-001', 'new'],
    ]);
  });

  it('iOS 전용 행은 만들지 않는다 (F-QD-06)', () => {
    expect(skipped).toEqual([{ sourceId: 'sample/TS-003', reason: expect.stringContaining('iOS') }]);
  });

  it('출처·해시·준비 플로우·포인트 ID를 코드가 채운다', () => {
    const c = byId('TS-001');
    expect(c).toMatchObject({
      requirementIds: ['sample/FR-001'],
      feature: '샘플 기능',
      subFeature: '처음 연다',
      sourceRef: {
        file: 'docs/specs/sample/spec.md',
        lineStart: SPEC.split('\n').findIndex((l) => l.startsWith('| TS-001')) + 1,
      },
      prepFlowIds: ['pf-clean', 'pf-home'],
      cleanState: true,
      rev: 1,
      approval: { status: 'pending' },
      updatedBy: 'QA Doc Generator',
    });
    expect(c.verificationPoints).toEqual([
      { id: 'TC-SAMPLE-001-P1', target: '버튼 개수', compare: 'count', expected: '버튼 개수 2개', method: 'tree' },
    ]);
    const { tcId: _, ...rest } = c;
    expect(c.contentHash).toBe(hash(Object.fromEntries(Object.entries(rest).filter(([k]) => BODY.includes(k)))));
    // 앱 데이터 초기화는 코드가 제공하는 플로우다 (모델은 env를 만들 수 없다)
    expect(prepFlows.map((f) => [f.id, f.kind])).toEqual([
      ['pf-clean', 'env'],
      ['pf-home', 'data_state'],
    ]);
    expect(warnings.join('\n')).toContain('pf-nope');
  });

  it('질문이 생긴 케이스는 보류, 질문은 요구사항·케이스에 연결된다 (F-QD-03)', () => {
    expect(byId('EC-001').approval.status).toBe('held');
    expect(doc.questions).toEqual([
      expect.objectContaining({
        id: 'Q-1',
        requirementId: 'sample/FR-001',
        caseIds: ['TC-SAMPLE-004'],
        status: 'open',
      }),
    ]);
    expect(byId('EC-001').questionIds).toEqual(['Q-1']);
    expect(doc.suggestions).toEqual([
      { id: 'S-1', requirementId: 'sample/FR-002', technique: 'negative', text: '뒤로가기 TS가 없습니다.' },
    ]);
    expect(doc.requirements[0]).toMatchObject({
      id: 'sample/FR-001',
      sourceRef: { headingPath: ['스펙 명세서: 샘플 기능', '2. 요구사항', '2.1 기능적 요구사항'] },
    });
  });
});

const BODY = [
  'title',
  'preconditions',
  'prepFlowIds',
  'cleanState',
  'accountRole',
  'data',
  'steps',
  'verificationPoints',
  'priority',
  'type',
  'platform',
  'mode',
];

describe('generateQaDoc — 다음 버전 (F-QD-08)', async () => {
  const first = (await run({ llm: fakeGeneratorLlm().llm })).doc;
  // 사람이 TS-001을 고치고 승인, TS-002도 승인, 질문에는 답했다
  const edited: QADocument = {
    ...first,
    cases: first.cases.map((c): TestCase =>
      c.sourceId === 'sample/TS-001'
        ? { ...c, title: '사람이 고친 제목', rev: 3, approval: { status: 'approved', by: 'qa', contentHash: 'h' } }
        : { ...c, approval: { status: 'approved', by: 'qa', contentHash: c.contentHash } },
    ),
    questions: first.questions.map((q) => ({ ...q, status: 'answered', answer: '모달입니다' })),
  };
  const next = SPEC.replace('홈으로 이동한다', '홈 탭이 선택된 채로 열린다') // TS-002 변경
    .replace(/\| EC-001 .*\n/, '') // EC-001 삭제
    .replace('| TS-003 |', '| TS-004 | 다시 연다 | 첫 화면 | 앱을 다시 연다 | 첫 화면이 보인다 | FR-001 |\n| TS-003 |'); // TS-004 신규
  const { llm, calls } = fakeGeneratorLlm();
  const { doc } = await run({
    llm,
    bundle: bundleOf(next),
    prev: edited,
    prevBundle: bundleOf(SPEC),
    meta: { ...META, id: 'doc-2' },
  });
  const byId = (src: string) => doc.cases.find((c) => c.sourceId === `sample/${src}`)!;

  it('동일 행은 LLM 없이 사람의 수정·승인을 그대로 복사한다', () => {
    expect(byId('TS-001')).toMatchObject({
      change: 'same',
      title: '사람이 고친 제목',
      rev: 3,
      approval: { status: 'approved' },
    });
    expect(
      calls.filter((c) => c.kind === 'case').flatMap((c) => [...c.prompt.matchAll(/^\[(\S+)\]/gm)].map((m) => m[1])),
    ).toEqual(['TS-002', 'TS-004', 'TS-003']);
  });

  it('변경 행은 같은 TC ID로 다시 만들고 이전 블록·이전 행을 넘긴다, 재승인 필요', () => {
    expect(byId('TS-002')).toMatchObject({
      tcId: 'TC-SAMPLE-002',
      change: 'changed',
      rev: 2,
      approval: { status: 'pending' },
      previous: { title: 'TS-002 제목' },
    });
    const prompt = calls.find((c) => c.kind === 'case')!.prompt;
    expect(prompt).toContain('이전 버전 행:');
    expect(prompt).toContain('  Then: 홈으로 이동한다');
    expect(prompt).toContain('이전 케이스 (사람이 고쳤을 수 있음)');
  });

  it('신규는 다음 번호, 사라진 출처는 삭제로 남기고 그 질문은 빠진다', () => {
    expect(byId('TS-004')).toMatchObject({ tcId: 'TC-SAMPLE-005', change: 'new' });
    expect(byId('EC-001')).toMatchObject({ tcId: 'TC-SAMPLE-004', change: 'removed' });
    expect(doc.questions).toEqual([]);
    expect(doc.prevDocId).toBe('doc-1');
  });
});

describe('generateQaDoc — 응답 확인', () => {
  it('묶음 응답에서 행이 빠지면 한 번 다시 묻는다', async () => {
    const { llm, calls } = fakeGeneratorLlm({ drop: 'TS-002' });
    const { doc } = await run({ llm });
    expect(calls.filter((c) => c.kind === 'case')).toHaveLength(2);
    expect(calls.at(-1)!.prompt).toContain('TS-002가 빠졌다');
    expect(doc.cases).toHaveLength(3);
  });

  it('기존 준비 플로우가 있으면 다시 만들지 않는다', async () => {
    const home = { id: 'pf-home', name: '홈', kind: 'data_state' as const, check: '홈', steps: [] };
    const { prepFlows } = await run({ llm: fakeGeneratorLlm().llm, prepFlows: [CLEAN_FLOW, home] });
    expect(prepFlows).toEqual([]);
  });
});
