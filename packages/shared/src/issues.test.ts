import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISSUE_TEMPLATE,
  initialIssueValues,
  isIssueTemplateFile,
  missingRequired,
  parseIssueTemplate,
  renderIssueBody,
  type IssueTemplate,
} from './issueTemplate';
import {
  defaultAssignees,
  issueActionFor,
  issueFooter,
  issueSyncs,
  normalizeAssigneeMap,
  pickLabels,
  specNameOf,
  statusOnIssueEvent,
  withIssueFooter,
} from './issues';

const ok = (file: string, content: string): IssueTemplate => {
  const e = parseIssueTemplate(file, content);
  if ('error' in e) throw new Error(e.error);
  return e.template;
};

const FORM = `name: 버그 리포트
description: 앱 버그
title: "[Bug]: "
labels: ["bug", "triage"]
assignees:
  - octocat
body:
  - type: markdown
    attributes:
      value: 시간 내 주셔서 감사합니다
  - type: input
    id: version
    attributes:
      label: 앱 버전
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: 로그
      render: shell
  - type: dropdown
    id: severity
    attributes:
      label: 심각도
      options: [낮음, 보통, 높음]
      default: 1
  - type: checkboxes
    id: terms
    attributes:
      label: 확인
      options:
        - label: 중복이 아닌지 찾아봤다
          required: true
        - label: 최신 버전이다
`;

describe('이슈 템플릿 해석', () => {
  it('템플릿 폴더 바로 아래 md·yml만, config.yml은 뺀다', () => {
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE/bug.md')).toBe(true);
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE/bug.yaml')).toBe(true);
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE/config.yml')).toBe(false);
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE/sub/bug.md')).toBe(false);
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE.md')).toBe(false);
    expect(isIssueTemplateFile('.github/ISSUE_TEMPLATE/notes.txt')).toBe(false);
  });

  it('Markdown: frontmatter와 제목 줄마다 나눈 칸', () => {
    const t = ok(
      '.github/ISSUE_TEMPLATE/bug.md',
      `---
name: Bug
about: 버그 신고
title: "[BUG] "
labels: bug, ui
assignees: ''
---
설명을 적어 주세요.

## 재현
1.

\`\`\`
# 코드 안의 샵은 제목이 아니다
\`\`\`

## 기대 결과
`,
    );
    expect(t).toMatchObject({ kind: 'markdown', name: 'Bug', about: '버그 신고', title: '[BUG] ' });
    expect(t.labels).toEqual(['bug', 'ui']);
    expect(t.assignees).toEqual([]);
    expect(t.fields.map((f) => (f.type === 'section' ? f.heading : ''))).toEqual(['', '## 재현', '## 기대 결과']);
    const body = renderIssueBody(t, { s1: '1. 앱을 연다\n2. 시작을 누른다' });
    expect(body).toContain('설명을 적어 주세요.\n\n## 재현\n\n1. 앱을 연다\n2. 시작을 누른다\n\n## 기대 결과\n');
  });

  it('Markdown 비운 칸은 템플릿 원문을 남긴다', () => {
    const body = renderIssueBody(DEFAULT_ISSUE_TEMPLATE, { s0: '시작 버튼이 안 보인다' });
    expect(body.startsWith('## 요약\n\n시작 버튼이 안 보인다\n\n## 환경\n\n- 앱 버전:')).toBe(true);
    expect(body).toContain('## 재현 절차\n\n1.');
  });

  it('frontmatter·name이 없거나 YAML이 깨지면 읽을 수 없음', () => {
    expect(parseIssueTemplate('a.md', '## 그냥 본문')).toMatchObject({ error: expect.stringContaining('frontmatter') });
    expect(parseIssueTemplate('a.md', '---\nabout: x\n---\n')).toMatchObject({
      error: expect.stringContaining('name'),
    });
    expect(parseIssueTemplate('a.yml', 'name: [')).toMatchObject({ error: expect.stringContaining('YAML') });
    expect(
      parseIssueTemplate('a.yml', 'name: x\nbody:\n  - type: slider\n    attributes:\n      label: y'),
    ).toMatchObject({
      error: expect.stringContaining('slider'),
    });
  });

  it('이슈 폼: markdown 요소는 빼고 입력 요소를 필드로', () => {
    const t = ok('.github/ISSUE_TEMPLATE/bug.yml', FORM);
    expect(t).toMatchObject({ kind: 'form', about: '앱 버그', title: '[Bug]: ', labels: ['bug', 'triage'] });
    expect(t.assignees).toEqual(['octocat']);
    expect(t.fields.map((f) => f.type)).toEqual(['input', 'textarea', 'dropdown', 'checkboxes']);
    expect(initialIssueValues(t)).toEqual({ severity: ['보통'] });
  });

  it('이슈 폼 본문은 GitHub 웹과 같은 모양', () => {
    const t = ok('.github/ISSUE_TEMPLATE/bug.yml', FORM);
    const body = renderIssueBody(t, {
      version: '1.2.0',
      logs: 'E/Fatal',
      severity: ['높음', '없는 값'],
      terms: ['최신 버전이다'],
    });
    expect(body).toBe(
      [
        '### 앱 버전\n\n1.2.0',
        '### 로그\n\n```shell\nE/Fatal\n```',
        '### 심각도\n\n높음',
        '### 확인\n\n- [ ] 중복이 아닌지 찾아봤다\n- [x] 최신 버전이다',
      ].join('\n\n') + '\n',
    );
    expect(renderIssueBody(t, {})).toContain('### 앱 버전\n\n_No response_\n\n### 로그\n\n_No response_');
  });

  it('비어 있는 필수 필드와 필수 체크박스', () => {
    const t = ok('.github/ISSUE_TEMPLATE/bug.yml', FORM);
    expect(missingRequired(t, {})).toEqual(['앱 버전', '확인']);
    expect(missingRequired(t, { version: '1.0', terms: ['중복이 아닌지 찾아봤다'] })).toEqual([]);
  });
});

describe('이슈 발행 규칙', () => {
  it('끝줄은 빈 줄 뒤에 붙는다', () => {
    const footer = issueFooter({ defectId: 'D-3', cycleName: '1.2.0 회귀', traceUrl: 'https://x', requester: 'kim' });
    expect(withIssueFooter('본문\n\n', footer)).toBe(
      '본문\n\n---\nqcard 결함 D-3 · 사이클 "1.2.0 회귀" · 판정 추적: https://x\nreported by @kim via qcard\n',
    );
  });

  it('스펙 이름·담당자 기본값', () => {
    expect(specNameOf('room-list/TS-003')).toBe('room-list');
    expect(defaultAssignees({ 'room-list': ['a'] }, 'room-list', ['t'])).toEqual(['a']);
    expect(defaultAssignees({ 'room-list': ['a'] }, 'onboarding', ['t'])).toEqual(['t']);
  });

  it('라벨은 대소문자를 가리지 않고 저장소 표기로', () => {
    expect(pickLabels(['Bug', 'ui', 'bug'], ['bug', 'enhancement'])).toEqual({ ok: ['bug'], missing: ['ui'] });
  });

  it('담당자 매핑 검사', () => {
    expect(normalizeAssigneeMap({ a: [' @kim ', 'kim'], b: [] })).toEqual({ a: ['kim'] });
    expect(normalizeAssigneeMap({ a: ['bad name'] })).toMatch('올바르지');
  });

  it('동기화 조건: 같은 저장소, 연결 중, 이슈가 살아 있다', () => {
    const repo = {
      installationId: 1,
      repoId: 10,
      owner: 'o',
      name: 'r',
      private: true,
      status: 'active' as const,
      connectedBy: 'a',
      connectedAt: 't',
    };
    const issue = {
      repoId: 10,
      repo: 'o/r',
      number: 1,
      url: 'u',
      state: 'open' as const,
      link: 'linked' as const,
      publishedBy: 'a',
      publishedAt: 't',
    };
    expect(issueSyncs({ repo }, { issue })).toBe(true);
    expect(issueSyncs({ repo: { ...repo, status: 'broken' } }, { issue })).toBe(false);
    expect(issueSyncs({ repo, deletedAt: 't' }, { issue })).toBe(false);
    expect(issueSyncs({ repo }, { issue: { ...issue, repoId: 11 } })).toBe(false);
    expect(issueSyncs({ repo }, { issue: { ...issue, link: 'transferred' } })).toBe(false);
    expect(issueSyncs({}, { issue })).toBe(false);
  });
});

describe('상태 동기화 표', () => {
  it('GitHub → qcard', () => {
    const done = { kind: 'closed', reason: 'completed' } as const;
    const dropped = { kind: 'closed', reason: 'not_planned' } as const;
    const dup = { kind: 'closed', reason: 'duplicate' } as const;
    const reopened = { kind: 'reopened' } as const;
    expect([
      statusOnIssueEvent('open', done),
      statusOnIssueEvent('fixed', done),
      statusOnIssueEvent('closed', done),
    ]).toEqual(['fixed', undefined, undefined]);
    expect([
      statusOnIssueEvent('open', dropped),
      statusOnIssueEvent('fixed', dup),
      statusOnIssueEvent('closed', dup),
    ]).toEqual(['closed', 'closed', undefined]);
    expect([
      statusOnIssueEvent('open', reopened),
      statusOnIssueEvent('fixed', reopened),
      statusOnIssueEvent('closed', reopened),
    ]).toEqual([undefined, 'open', 'open']);
  });

  it('qcard → GitHub, 되돌아온 웹훅은 그대로', () => {
    expect(issueActionFor('closed', 'open', 'kim')).toEqual({
      state: { to: 'closed', reason: 'completed' },
      comment: 'QA 확인 완료 (@kim)',
    });
    expect(issueActionFor('closed', 'closed', 'kim')).toEqual({ comment: 'QA 확인 완료 (@kim)' });
    expect(issueActionFor('open', 'closed', 'kim').state).toEqual({ to: 'open' });
    expect(issueActionFor('fixed', 'open', 'kim')).toEqual({ comment: 'qcard에서 fixed로 표시 (@kim)' });
    // qcard closed → 이슈 닫힘(completed) 웹훅 → 결함 closed 그대로
    expect(statusOnIssueEvent('closed', { kind: 'closed', reason: 'completed' })).toBeUndefined();
    // qcard open → 이슈 다시 열림 웹훅 → 그대로
    expect(statusOnIssueEvent('open', { kind: 'reopened' })).toBeUndefined();
  });
});
