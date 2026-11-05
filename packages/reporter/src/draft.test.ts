import { HARUKONG_REPO } from '@qcard/fixtures/github';
import { DEFAULT_ISSUE_TEMPLATE, parseIssueTemplate, renderIssueBody, type IssueTemplate } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { draftIssue, draftPrompt, type IssueFacts } from './draft';
import { fakeReporterLlm } from './fake';

// 하루콩 1.3.0 회귀의 D-1 (packages/fixtures defects130)
const facts: IssueFacts = {
  defect: {
    id: 'D-1',
    title: '사용법 안내 스텝 3에서 뒤로가기 시 앱이 백그라운드로 감',
    severity: 'major',
    repro: ['온보딩을 사용법 안내 스텝 1까지 진행', '스텝 3까지 넘긴다', '시스템 뒤로가기(제스처)'],
    expected: '사용법 안내 스텝 2가 노출된다 (FR-007, FR-016)',
    actual: '앱이 백그라운드로 간다',
  },
  case: {
    tcId: 'TC-ONBOARDING-034',
    sourceId: 'onboarding/TS-034',
    requirementIds: ['onboarding/FR-007', 'onboarding/FR-016'],
    title: '사용법 안내에서 뒤로가기',
    steps: [{ text: '스텝 3에서 시스템 뒤로가기', manual: false }],
    verificationPoints: [
      { id: 'VP-1', target: '사용법 안내', compare: 'visible', expected: '스텝 2가 보인다', method: 'tree' },
    ],
  },
  device: { label: 'Pixel 8 · Android 15', osBuild: 'AP4A.250105.002' },
  app: { version: '1.3.0', buildNumber: 130 },
  cycleName: '1.3.0 회귀',
};

const bugForm = (() => {
  const e = parseIssueTemplate(
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    HARUKONG_REPO.files['.github/ISSUE_TEMPLATE/bug_report.yml']!,
  );
  if ('error' in e) throw new Error(e.error);
  return e.template;
})();

describe('이슈 초안', () => {
  it('넘기는 것은 결함·케이스·환경 텍스트와 템플릿 칸뿐이다', () => {
    const p = draftPrompt(facts, bugForm);
    expect(p).toContain('3. 시스템 뒤로가기(제스처)');
    expect(p).toContain('TC ID: TC-ONBOARDING-034 · 출처: onboarding/TS-034');
    expect(p).toContain('앱 버전: 1.3.0 (빌드 130)');
    expect(p).toContain('id: severity · 드롭다운 "심각도"');
    expect(p).toContain('선택지: ["Critical","Major","Minor","Trivial"]');
    expect(p).not.toMatch(/screenshot|스크린샷 경로|<hierarchy/i);
  });

  it('이슈 폼: 선택지에 없는 값은 버리고, 채우지 못한 칸은 비운 칸으로 알린다', async () => {
    const { llm, calls } = fakeReporterLlm({
      title: '사용법 안내 스텝 3에서 뒤로가기 시 앱이 백그라운드로 감',
      fields: [
        { id: 'what', value: '스텝 3에서 뒤로가기를 하면 앱이 백그라운드로 간다.', picked: [] },
        { id: 'steps', value: '1. 온보딩을 사용법 안내 스텝 1까지 진행\n2. 스텝 3까지 넘긴다', picked: [] },
        { id: 'version', value: '1.3.0 (130)', picked: [] },
        { id: 'device', value: 'Pixel 8 · Android 15', picked: [] },
        { id: 'severity', value: '', picked: ['Major', 'Blocker'] },
        { id: 'logs', value: '  ', picked: [] },
        { id: 'cause', value: '', picked: [] },
        { id: 'checks', value: '', picked: ['없는 항목'] },
        { id: 'unknown', value: '무시', picked: [] },
      ],
    });
    const d = await draftIssue({ facts, template: bugForm, llm });
    expect(calls[0]!.model).toBe('claude-sonnet-5-5');
    expect(d.title).toBe('[Bug] 사용법 안내 스텝 3에서 뒤로가기 시 앱이 백그라운드로 감');
    expect(d.values.severity).toEqual(['Major']);
    expect(d.values).not.toHaveProperty('unknown');
    expect(d.empty).toEqual(['logs', 'cause', 'checks']);
    expect(renderIssueBody(bugForm, d.values)).toContain('### 추정 원인\n\n_No response_');
  });

  it('Markdown(기본 템플릿): 칸별 값, 비운 칸은 템플릿 원문이 남는다', async () => {
    const t: IssueTemplate = DEFAULT_ISSUE_TEMPLATE;
    const { llm } = fakeReporterLlm((prompt) => ({
      title: prompt.includes('[Bug]') ? '접두어 있음' : '[Bug] 이미 붙은 접두어',
      fields: t.fields.map((f) => ({ id: f.id, value: f.id === 's0' ? '뒤로가기 시 앱이 닫힌다' : '', picked: [] })),
    }));
    const d = await draftIssue({ facts, template: t, llm });
    expect(d.title).toBe('[Bug] 이미 붙은 접두어');
    expect(d.empty).toEqual(t.fields.slice(1).map((f) => f.id));
    expect(renderIssueBody(t, d.values)).toContain('## 요약\n\n뒤로가기 시 앱이 닫힌다\n\n## 환경\n\n- 앱 버전:');
  });

  it('형식이 틀리면 한 번 다시 묻는다', async () => {
    let n = 0;
    const { llm, calls } = fakeReporterLlm(() => {
      n++;
      return (n === 1 ? { title: 1 } : { title: '제목', fields: [] }) as never;
    });
    const d = await draftIssue({ facts, template: DEFAULT_ISSUE_TEMPLATE, llm });
    expect(calls).toHaveLength(2);
    expect(d.title).toBe('제목');
  });
});
