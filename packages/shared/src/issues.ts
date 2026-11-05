import type { Defect, DefectIssue, DefectStatus, DefectStatusChange, IssueCloseReason, Project } from './domain';
import type { IssueTemplateEntry } from './issueTemplate';

/*
 * GitHub 이슈 발행·상태 동기화 규칙 (docs/product/issues.md). Functions와 메모리 구현이 같은 함수를 쓴다.
 */

/** 판정 추적 링크와 이슈 끝줄에 쓰는 qcard 주소 */
export const QCARD_ORIGIN = 'https://qcard.dev';

/** 담당자는 이슈 하나에 최대 10명 (GitHub 제한) */
export const MAX_ISSUE_ASSIGNEES = 10;

/** GitHub 사용자명 (영숫자·하이픈, 39자 이하) */
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** 결함의 스펙 이름: 케이스 출처 ID의 앞부분 (`room-list/TS-003` → `room-list`) */
export const specNameOf = (sourceId: string) => sourceId.split('/')[0] ?? sourceId;

/** 판정 추적 화면 주소 (qcard 멤버만 열 수 있다) */
export const traceUrlOf = (p: { projectId: string; cycleId: string; tcId: string; deviceId: string }) =>
  `${QCARD_ORIGIN}/p/${p.projectId}/cycles/${p.cycleId}/results/${encodeURIComponent(p.tcId)}/${encodeURIComponent(p.deviceId)}`;

/** 본문 끝에 코드가 붙이는 줄. 팝업에서 고칠 수 없다 */
export function issueFooter(p: { defectId: string; cycleName: string; traceUrl: string; requester: string }): string {
  return [
    '---',
    `qcard 결함 ${p.defectId} · 사이클 "${p.cycleName}" · 판정 추적: ${p.traceUrl}`,
    `reported by @${p.requester} via qcard`,
  ].join('\n');
}

/** 본문 + 끝줄. `---` 앞에 빈 줄이 없으면 바로 위 줄이 제목(setext)이 된다 */
export const withIssueFooter = (body: string, footer: string) => `${body.trimEnd()}\n\n${footer}\n`;

/** GitHub 이름은 대소문자를 가리지 않는다. 있는 것은 저장소 표기로, 없는 것은 따로 */
function pick(wanted: string[], available: string[]): { ok: string[]; missing: string[] } {
  const byLower = new Map(available.map((a) => [a.toLowerCase(), a]));
  const ok: string[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const hit = byLower.get(w.toLowerCase());
    if (hit) {
      if (!ok.includes(hit)) ok.push(hit);
    } else if (!missing.includes(w)) missing.push(w);
  }
  return { ok, missing };
}

/** 템플릿 라벨 중 저장소에 있는 것만 미리 고른다. qcard는 라벨을 만들지 않는다 */
export const pickLabels = (wanted: string[], repoLabels: string[]) => pick(wanted, repoLabels);

/** 저장소의 지정 가능한 사람만 남긴다 */
export const pickAssignees = (wanted: string[], assignable: string[]) => pick(wanted, assignable);

/** 담당자 기본값: 그 스펙의 담당자 매핑, 없으면 템플릿 assignees */
export function defaultAssignees(map: Project['assigneeMap'], specName: string, templateAssignees: string[]): string[] {
  const mapped = map?.[specName] ?? [];
  return (mapped.length > 0 ? mapped : templateAssignees).slice(0, MAX_ISSUE_ASSIGNEES);
}

/** 담당자 매핑 검사: 사용자명 형식, 스펙마다 최대 10명. 빈 스펙은 지운다 */
export function normalizeAssigneeMap(map: Record<string, string[]>): Record<string, string[]> | string {
  const out: Record<string, string[]> = {};
  for (const [spec, users] of Object.entries(map)) {
    const names = [...new Set(users.map((u) => u.trim().replace(/^@/, '')).filter(Boolean))];
    const bad = names.find((n) => !GITHUB_LOGIN.test(n));
    if (bad) return `GitHub 사용자명이 올바르지 않습니다: ${bad}`;
    if (names.length > MAX_ISSUE_ASSIGNEES) return `${spec}: 담당자는 ${MAX_ISSUE_ASSIGNEES}명까지입니다.`;
    if (names.length > 0) out[spec] = names;
  }
  return out;
}

/** 이 결함의 상태를 이슈와 맞추는가: 저장소가 연결돼 있고, 같은 저장소의 이슈가 삭제·이전되지 않았다 */
export function issueSyncs(project: Pick<Project, 'repo' | 'deletedAt'>, defect: Pick<Defect, 'issue'>): boolean {
  const { repo } = project;
  return (
    !!repo &&
    repo.status === 'active' &&
    !project.deletedAt &&
    defect.issue?.link === 'linked' &&
    defect.issue.repoId === repo.repoId
  );
}

/** 이슈를 (다시) 발행할 수 있는가: 연결된 이슈가 없거나 GitHub에서 지웠다 */
export const canPublishIssue = (defect: Pick<Defect, 'issue'>) => !defect.issue || defect.issue.link === 'deleted';

export type IssueEvent = { kind: 'closed'; reason: IssueCloseReason } | { kind: 'reopened' };

/**
 * GitHub → qcard: 이슈 이벤트로 바뀔 결함 상태. 그대로면 undefined.
 * qcard가 바꾼 이슈 상태가 웹훅으로 돌아와도 여기서 "그대로"가 되어 되돌아가지 않는다
 */
export function statusOnIssueEvent(status: DefectStatus, e: IssueEvent): DefectStatus | undefined {
  if (e.kind === 'reopened') return status === 'open' ? undefined : 'open';
  if (e.reason === 'completed') return status === 'open' ? 'fixed' : undefined;
  return status === 'closed' ? undefined : 'closed';
}

export type IssueAction = { state?: { to: 'open' | 'closed'; reason?: 'completed' }; comment: string };

/** qcard → GitHub: 결함 상태를 바꿀 때 이슈에 할 일. `by`는 바꾼 사람의 GitHub 사용자명 */
export function issueActionFor(to: DefectStatus, issueState: 'open' | 'closed', by: string): IssueAction {
  switch (to) {
    case 'closed':
      return {
        ...(issueState === 'open' ? { state: { to: 'closed' as const, reason: 'completed' as const } } : {}),
        comment: `QA 확인 완료 (@${by})`,
      };
    case 'open':
      return {
        ...(issueState === 'closed' ? { state: { to: 'open' as const } } : {}),
        comment: `QA에서 다시 열림 (@${by})`,
      };
    case 'fixed':
      return { comment: `qcard에서 fixed로 표시 (@${by})` };
  }
}

/**
 * qcard에서 이슈가 연결된 결함의 상태를 바꿀 때 (Functions setDefectStatus·메모리 구현 공용):
 * 동기화 중이면 이슈에 할 일(`action`), 그 일이 성공한 뒤 결함에 쓸 이슈(`issue`)와 상태 기록(`change`)
 */
export function linkedStatusChange(input: {
  project: Pick<Project, 'repo' | 'deletedAt'>;
  defect: Pick<Defect, 'issue'> & { issue: DefectIssue };
  to: DefectStatus;
  by: { name: string; github: string };
  at: string;
}): { action?: IssueAction; issue: DefectIssue; change: DefectStatusChange } {
  const { defect, to, by, at } = input;
  const change: DefectStatusChange = { to, by: by.name, via: 'qcard', at };
  if (!issueSyncs(input.project, defect)) return { issue: defect.issue, change };
  const action = issueActionFor(to, defect.issue.state, by.github);
  const { closeReason: _c, ...rest } = defect.issue;
  const issue: DefectIssue = !action.state
    ? defect.issue
    : action.state.to === 'closed'
      ? { ...rest, state: 'closed', closeReason: 'completed' }
      : { ...rest, state: 'open' };
  return { action, issue, change };
}

/** 이슈 색인 문서 id (`issueLinks/{id}`): 웹훅은 저장소 ID + 이슈 번호로 결함을 찾는다 */
export const issueLinkId = (repoId: number, number: number) => `${repoId}_${number}`;

/** 저장소 연결 화면에서 고를 수 있는 저장소 (연결하는 사람이 접근할 수 있는 것만) */
export type ConnectableRepo = { installationId: number; repoId: number; owner: string; name: string; private: boolean };

/** GitHub에서 돌아온 뒤 고를 저장소 목록 */
export type ConnectableRepos = { projectId: string; projectName: string; login: string; repos: ConnectableRepo[] };

/** 발행 팝업을 열 때 읽는 저장소 정보. qcard 기본 템플릿은 화면이 목록 끝에 붙인다 */
export type IssueContext = {
  repo: { owner: string; name: string; private: boolean; url: string };
  templates: IssueTemplateEntry[];
  labels: string[];
  assignees: string[];
};

/** 이슈 초안 작업 id: 결함마다 요청자의 마지막 초안 하나만 남는다 */
/**
 * 이슈 초안 작업을 두는 하위 컬렉션 (`projects/{p}/issueDrafts/{id}`). 작업(`jobs`)과 따로 둔다 — 이슈 초안을 모르는
 * 예전 호스트는 `jobs`에서 모르는 작업을 QA 문서 생성으로 맡는다
 */
export const ISSUE_DRAFTS = 'issueDrafts';

export const issueDraftJobId = (cycleId: string, defectId: string, uid: string) => `draft-${cycleId}-${defectId}-${uid}`;
