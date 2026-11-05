import { Button, Icons, SectionMessage, textClass } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { PolicyNotice } from '../legal';
import { QueryState } from '../../components/QueryState';
import { fmtDate } from '../../components/format';
import type { ProjectSummary } from '../../data/api';
import { useMyProjects, useRestoreProject } from '../../data/hooks';
import { PlainShell } from '../../shell/PlainShell';
import { ErrorMessage, RoleBadge } from './parts';
import './projects.css';

/** 내 프로젝트: 내가 멤버인 프로젝트만 보인다. 첫 화면 */
export function ProjectListPage() {
  const projects = useMyProjects();
  const navigate = useNavigate();
  return (
    <PlainShell>
      <PageHeader
        title="내 프로젝트"
        meta="앱마다 QA 대시보드를 하나씩 만들고 멤버를 초대합니다. 다른 프로젝트는 초대를 받아야 볼 수 있습니다."
        actions={
          <div className="qp-row">
            <Button
              variant="outlined"
              color="assistive"
              leadingContent={<Icons.IconCircleInfo />}
              onClick={() => void navigate('/guide')}
            >
              시작 가이드
            </Button>
            <Button
              variant="outlined"
              color="assistive"
              leadingContent={<Icons.IconDesktop />}
              onClick={() => void navigate('/hosts')}
            >
              연결된 PC
            </Button>
            <Button
              variant="solid"
              color="primary"
              leadingContent={<Icons.IconPlus />}
              onClick={() => void navigate('/projects/new')}
            >
              새 프로젝트
            </Button>
          </div>
        }
      />
      <PolicyNotice />
      <QueryState query={projects}>
        {(list) =>
          list.length === 0 ? (
            <SectionMessage
              variant="info"
              description="새 프로젝트를 만들거나, 받은 초대 링크를 열어 참여하세요. 처음이라면 시작 가이드에서 순서를 볼 수 있습니다."
            >
              아직 속한 프로젝트가 없습니다
            </SectionMessage>
          ) : (
            <div className="qp-grid">
              {list.map((s) => (
                <ProjectCard key={s.project.id} summary={s} />
              ))}
            </div>
          )
        }
      </QueryState>
    </PlainShell>
  );
}

function ProjectCard({ summary: s }: { summary: ProjectSummary }) {
  const { project: p } = s;
  const body = (
    <>
      <div className="qp-card-head">
        <span className={textClass('headline2', 'bold')}>{p.name}</span>
        <span className="qp-push">
          <RoleBadge role={s.role} />
        </span>
      </div>
      <span className={`${textClass('label2')} qp-muted`}>
        {p.appName} · <span className="qc-mono">{p.packageName}</span>
      </span>
      <div className={`qp-project-meta ${textClass('label2')} qp-faint`}>
        <span>멤버 {s.memberCount}명</span>
        <span>진행 중 사이클 {s.activeCycles}개</span>
        {p.createdAt && <span>{fmtDate(p.createdAt)} 생성</span>}
      </div>
    </>
  );
  if (p.deletedAt) return <DeletedCard summary={s}>{body}</DeletedCard>;
  return (
    <Link to={`/p/${p.id}/cycles`} className="qp-card qp-project" aria-label={`${p.name} 열기`}>
      {body}
    </Link>
  );
}

/** 삭제 예정: 유예 기간 동안 Admin이 복구할 수 있다 */
function DeletedCard({ summary: s, children }: { summary: ProjectSummary; children: ReactNode }) {
  const restore = useRestoreProject(s.project.id);
  return (
    <div className="qp-card qp-project" data-deleted>
      {children}
      <div className="qp-row" style={{ justifyContent: 'space-between' }}>
        <span className={`qp-row ${textClass('label2', 'medium')} qp-muted`} style={{ gap: 4 }}>
          <Icons.IconTrash aria-hidden style={{ width: 16, height: 16 }} />
          삭제 예정 · {fmtDate(s.project.purgeAt!)} 영구 삭제
        </span>
        {s.role === 'admin' && (
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconRefresh />}
            disabled={restore.isPending}
            onClick={() => restore.mutate(undefined)}
          >
            복구
          </Button>
        )}
      </div>
      <ErrorMessage error={restore.error} />
    </div>
  );
}
