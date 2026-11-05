import {
  DEFAULT_ISSUE_TEMPLATE,
  defaultAssignees,
  initialIssueValues,
  issueFooter,
  pickAssignees,
  pickLabels,
  renderIssueBody,
  traceUrlOf,
  type Defect,
  type DefectIssue,
  type IssueContext,
  type IssueDraftJob,
  type IssueTemplate,
  type IssueTemplateEntry,
  type IssueValues,
  type Project,
} from '@qcard/shared';

/*
 * 이슈 발행 팝업의 계산 (docs/product/issues.md#발행-팝업). 화면과 떼어 테스트한다.
 */

/** 템플릿 목록: 저장소 템플릿 + 맨 아래 qcard 기본 템플릿 */
export const templateChoices = (ctx: Pick<IssueContext, 'templates'>): IssueTemplateEntry[] => [
  ...ctx.templates,
  { file: '', template: DEFAULT_ISSUE_TEMPLATE },
];

export type IssueForm = {
  title: string;
  /** 이슈 폼 칸 값 (Markdown 템플릿이면 칸별 초안, 편집은 body로) */
  values: IssueValues;
  /** Markdown 템플릿의 본문 (사람이 통째로 고친다) */
  body: string;
  labels: string[];
  assignees: string[];
};

/** 팝업 편집의 시작 값: 초안(없으면 템플릿 원문) + 저장소에 있는 템플릿 라벨 + 담당자 기본값 */
export function initialForm(p: {
  template: IssueTemplate;
  draft?: IssueDraftJob['result'];
  defect: Pick<Defect, 'title'>;
  ctx: Pick<IssueContext, 'labels' | 'assignees'>;
  assigneeMap: Project['assigneeMap'];
  specName: string;
}): IssueForm {
  const values = p.draft?.values ?? initialIssueValues(p.template);
  return {
    title: p.draft?.title ?? `${p.template.title}${p.defect.title}`,
    values,
    body: p.template.kind === 'markdown' ? renderIssueBody(p.template, values) : '',
    labels: pickLabels(p.template.labels, p.ctx.labels).ok,
    assignees: pickAssignees(defaultAssignees(p.assigneeMap, p.specName, p.template.assignees), p.ctx.assignees).ok,
  };
}

/** 저장소에 없어 뺀 템플릿 라벨, 지정할 수 없어 뺀 기본 담당자 (팝업에 알린다) */
export function droppedDefaults(p: {
  template: IssueTemplate;
  ctx: Pick<IssueContext, 'labels' | 'assignees'>;
  assigneeMap: Project['assigneeMap'];
  specName: string;
}) {
  return {
    labels: pickLabels(p.template.labels, p.ctx.labels).missing,
    assignees: pickAssignees(defaultAssignees(p.assigneeMap, p.specName, p.template.assignees), p.ctx.assignees)
      .missing,
  };
}

/** 발행할 본문 (끝줄은 서버가 붙인다) */
export const bodyOf = (t: IssueTemplate, f: IssueForm) =>
  t.kind === 'markdown' ? f.body : renderIssueBody(t, f.values);

/** 팝업에 미리 보이는 끝줄 (고칠 수 없다). 요청자 사용자명은 서버가 로그인 정보로 다시 넣는다 */
export function footerPreview(p: {
  projectId: string;
  cycleId: string;
  cycleName: string;
  defect: Pick<Defect, 'id' | 'tcId' | 'deviceId'>;
  requester: string;
}): string {
  return issueFooter({
    defectId: p.defect.id,
    cycleName: p.cycleName,
    traceUrl: traceUrlOf({
      projectId: p.projectId,
      cycleId: p.cycleId,
      tcId: p.defect.tcId,
      deviceId: p.defect.deviceId,
    }),
    requester: p.requester,
  });
}

/** 결함 행의 이슈 표시: 링크 + 상태 글자 */
export function issueStateLabel(issue: DefectIssue): string {
  if (issue.link === 'deleted') return '삭제됨';
  if (issue.link === 'transferred') return '옮겨짐 · 동기화 안 됨';
  if (issue.state === 'open') return '열림';
  return issue.closeReason === 'not_planned'
    ? '닫힘 · 안 함'
    : issue.closeReason === 'duplicate'
      ? '닫힘 · 중복'
      : '닫힘';
}

/** 초안 작업이 이 템플릿의 것인가 (같은 파일·이름) */
export const draftFor = (job: IssueDraftJob | null | undefined, t: IssueTemplate) =>
  !!job && job.input.template.file === t.file && job.input.template.name === t.name;

/** 목록·선택에 쓰는 템플릿 키 */
export const templateKey = (t: Pick<IssueTemplate, 'file' | 'name'>) => `${t.file}#${t.name}`;
