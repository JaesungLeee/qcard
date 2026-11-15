import { createFixtureDb, PEOPLE } from '@qcard/fixtures';
import { DEFAULT_ISSUE_TEMPLATE, type IssueTemplate } from '@qcard/shared';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryApi } from '../../data/memory';
import { bodyOf, droppedDefaults, initialForm, issueStateLabel, templateChoices } from './model';

const ctx = { labels: ['bug', 'triage'], assignees: ['minji-kim', 'seojun-choi'] };
const form: IssueTemplate = {
  file: '.github/ISSUE_TEMPLATE/bug.yml',
  kind: 'form',
  name: '버그',
  about: '',
  title: '[Bug] ',
  labels: ['bug', 'ui'],
  assignees: ['ghost'],
  fields: [{ type: 'input', id: 'version', label: '앱 버전', required: true, value: '1.0' }],
};

describe('발행 팝업 계산', () => {
  it('템플릿 목록 끝에 qcard 기본 템플릿이 늘 있다', () => {
    expect(templateChoices({ templates: [] })).toEqual([{ file: '', template: DEFAULT_ISSUE_TEMPLATE }]);
  });

  it('시작 값: 초안이 없으면 템플릿 원문, 라벨은 저장소에 있는 것만, 담당자는 매핑 → 템플릿', () => {
    const f = initialForm({ template: form, defect: { title: '버튼 없음' }, ctx, assigneeMap: {}, specName: 'x' });
    expect(f).toMatchObject({ title: '[Bug] 버튼 없음', values: { version: '1.0' }, labels: ['bug'], assignees: [] });
    expect(droppedDefaults({ template: form, ctx, assigneeMap: {}, specName: 'x' })).toEqual({
      labels: ['ui'],
      assignees: ['ghost'],
    });
    const mapped = initialForm({
      template: form,
      draft: { title: '[Bug] 초안', values: { version: '2.0' }, empty: [], tokens: 0, costUsd: 0 },
      defect: { title: '버튼 없음' },
      ctx,
      assigneeMap: { onboarding: ['Seojun-Choi'] },
      specName: 'onboarding',
    });
    expect(mapped).toMatchObject({ title: '[Bug] 초안', assignees: ['seojun-choi'] });
    expect(bodyOf(form, mapped)).toBe('### 앱 버전\n\n2.0\n');
  });

  it('Markdown 템플릿은 본문을 통째로 고친다', () => {
    const f = initialForm({
      template: DEFAULT_ISSUE_TEMPLATE,
      defect: { title: 't' },
      ctx,
      assigneeMap: {},
      specName: 'x',
    });
    expect(f.body.startsWith('## 요약')).toBe(true);
    expect(bodyOf(DEFAULT_ISSUE_TEMPLATE, { ...f, body: '고친 본문' })).toBe('고친 본문');
  });

  it('이슈 상태 글자', () => {
    const base = { repoId: 1, repo: 'o/r', number: 1, url: '', publishedBy: '', publishedAt: '' };
    expect(issueStateLabel({ ...base, state: 'open', link: 'linked' })).toBe('열림');
    expect(issueStateLabel({ ...base, state: 'closed', closeReason: 'not_planned', link: 'linked' })).toBe(
      '닫힘 · 안 함',
    );
    expect(issueStateLabel({ ...base, state: 'open', link: 'transferred' })).toBe('옮겨짐 · 동기화 안 됨');
  });
});

describe('메모리 구현의 이슈 발행 (pnpm dev)', () => {
  const cref = { projectId: 'haru', cycleId: 'cycle-130-1' };

  it('초안 → 발행 → 상태를 바꾸면 이슈도 맞춘다', async () => {
    vi.useFakeTimers();
    const api = createMemoryApi({ db: createFixtureDb(), currentUser: PEOPLE.lead });
    const ctx = await api.getIssueContext('haru');
    expect(ctx.templates.map((t) => t.file.split('/').at(-1))).toEqual(['bug_report.yml', 'feature.md', 'old.yml']);
    const bug = ctx.templates[0]!;
    if ('error' in bug) throw new Error(bug.error);

    await api.requestIssueDraft(cref, 'D-1', bug.template);
    expect((await api.getIssueDraft(cref, 'D-1'))?.status).toBe('queued');
    await vi.advanceTimersByTimeAsync(2000);
    const draft = await api.getIssueDraft(cref, 'D-1');
    expect(draft?.status).toBe('done');
    expect(draft?.result?.values.severity).toEqual(['Major']);
    expect(draft?.result?.empty).toContain('cause');
    vi.useRealTimers();

    const d = await api.publishIssue({
      ...cref,
      defectId: 'D-1',
      title: '[Bug] t',
      body: 'b',
      labels: [],
      assignees: [],
    });
    expect(d.issue).toMatchObject({ number: 13, state: 'open', link: 'linked' });
    await expect(
      api.publishIssue({ ...cref, defectId: 'D-1', title: 't', body: 'b', labels: [], assignees: [] }),
    ).rejects.toThrow('이미 이슈 #13');

    const closed = await api.updateDefect(cref, 'D-1', { status: 'closed' });
    expect([closed.status, closed.issue?.state, closed.statusLog?.at(-1)?.via]).toEqual(['closed', 'closed', 'qcard']);
  });

  it('저장소 연결은 Admin만, 공개 저장소는 확인을 받는다', async () => {
    const qa = createMemoryApi({ db: createFixtureDb(), currentUser: PEOPLE.qa });
    await expect(qa.startRepoConnect('haru')).rejects.toThrow();
    const api = createMemoryApi({ db: createFixtureDb(), currentUser: PEOPLE.lead });
    await api.disconnectRepo('haru');
    expect((await api.getProject('haru')).repo).toBeUndefined();
    const { installUrl } = await api.startRepoConnect('haru');
    const state = new URL(installUrl, 'http://x').searchParams.get('state')!;
    const list = await api.listConnectableRepos({ state, code: 'memory' });
    const pub = list.repos.find((r) => !r.private)!;
    await expect(api.connectRepo({ state, repoId: pub.repoId })).rejects.toThrow('공개 저장소');
    const p = await api.connectRepo({ state, repoId: pub.repoId, confirmPublic: true });
    expect(p.repo).toMatchObject({ name: 'harukong-feedback', private: false });
  });

  it('호스트가 꺼진 사람의 초안은 대기로 남는다', async () => {
    const api = createMemoryApi({ db: createFixtureDb(), currentUser: PEOPLE.qa });
    const job = await api.requestIssueDraft(cref, 'D-1', DEFAULT_ISSUE_TEMPLATE);
    expect(job.status).toBe('queued');
    await expect(api.requestIssueDraft(cref, 'D-2', DEFAULT_ISSUE_TEMPLATE)).rejects.toThrow('이미 이슈로 발행');
  });
});
