// 결함의 GitHub 이슈 칸: 발행한 이슈 링크·상태, 또는 [이슈 발행] (docs/product/issues.md)
import { canPublishIssue, specNameOf, type Defect, type Project, type TestCase, type TestCycle } from '@qcard/shared';
import { Button, Icons, textClass } from '@qcard/ui';
import { useState } from 'react';
import { useApi, useMembers, useProject } from '../../data/hooks';
import { issueStateLabel } from './model';
import { PublishIssueModal } from './PublishIssueModal';
import './issues.css';

export function IssueCell({
  projectId,
  cycle,
  defect,
  cases,
  canEdit,
}: {
  projectId: string;
  cycle: Pick<TestCycle, 'id' | 'name'>;
  defect: Defect;
  /** 사이클 케이스 사본 (결함의 스펙 이름을 찾는다) */
  cases: Pick<TestCase, 'tcId' | 'sourceId'>[];
  canEdit: boolean;
}) {
  const api = useApi();
  const project = useProject(projectId).data;
  const members = useMembers(projectId);
  const [open, setOpen] = useState(false);
  const issue = defect.issue;
  const publishable = canPublishIssue(defect);
  const sourceId = cases.find((c) => c.tcId === defect.tcId)?.sourceId ?? defect.tcId;
  const requester = members.data?.find((m) => m.uid === api.currentUid)?.github ?? api.currentUser;
  return (
    <span className="qi-stack" style={{ gap: 'var(--qc-space-4)' }}>
      {issue && (
        <span className={`qi-row ${textClass('label1')}`} style={{ flexWrap: 'nowrap' }}>
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="qi-link qc-mono"
            aria-label={`GitHub 이슈 ${issue.repo}#${issue.number}`}
          >
            #{issue.number}
          </a>
          <span className={`${textClass('caption1', 'medium')} qi-state`}>{issueStateLabel(issue)}</span>
        </span>
      )}
      {publishable && canEdit && project && <PublishAction project={project} onOpen={() => setOpen(true)} again={!!issue} />}
      {!issue && !canEdit && <span className="qi-faint">—</span>}
      {open && project && (
        <PublishIssueModal
          open={open}
          onOpenChange={setOpen}
          project={project}
          cycle={cycle}
          defect={defect}
          specName={specNameOf(sourceId)}
          requester={requester}
        />
      )}
    </span>
  );
}

function PublishAction({ project, onOpen, again }: { project: Project; onOpen: () => void; again: boolean }) {
  if (!project.repo)
    return (
      <span className={`${textClass('caption1')} qi-faint`} style={{ maxWidth: 160 }}>
        Admin이 저장소를 연결하면 발행할 수 있습니다
      </span>
    );
  if (project.repo.status !== 'active')
    return <span className={`${textClass('caption1')} qi-faint`}>저장소 연결이 끊겨 발행할 수 없습니다</span>;
  return (
    <Button
      size="small"
      variant="outlined"
      color="assistive"
      leadingContent={<Icons.IconUpload aria-hidden />}
      onClick={onOpen}
    >
      {again ? '다시 발행' : '이슈 발행'}
    </Button>
  );
}
