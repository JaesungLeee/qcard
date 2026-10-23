import {
  HOST_ONLINE_MS,
  JOB_ERROR_LABEL,
  JOB_STATUS_LABEL,
  type Host,
  type JobStatus,
  type QaDocJob,
} from '@qcard/shared';
import { Button, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { Link } from 'react-router';
import { DEV_COMMAND_NOTE } from '../hosts/model';
import { fmtDateTime, fmtNumber } from '../../components/format';
import { useApi, useMyHosts, useRetryJob } from '../../data/hooks';
import { Progress, Tag, type Tone } from './Badges';

/*
 * QA 문서 생성 작업 (PRD §5.2, §6.2): 요청자 본인의 호스트 에이전트가 처리한다.
 * 호스트 연결 상태(F-DB-09)와 작업 진행·결과를 보여 준다.
 */

export const isOnline = (h: Host, now = Date.now()) => now - Date.parse(h.lastSeen) < HOST_ONLINE_MS;

/** 호스트 에이전트를 켜는 명령. 처음 쓰는 PC는 먼저 connect로 계정에 연결한다 (F-TM-14, /hosts 안내) */
export const SERVE_COMMAND = 'pnpm --filter @qcard/host-agent serve';

/** 내 호스트 연결 상태. 꺼져 있으면 켜는 방법을 안내한다 */
export function HostStatus() {
  const api = useApi();
  const hosts = useMyHosts();
  if (hosts.isPending) return null;
  const online = (hosts.data ?? []).filter((h) => isOnline(h));
  const host = online[0];
  if (!host) {
    return (
      <SectionMessage
        variant="cautionary"
        description={
          <span className="qd-stack" style={{ gap: token('space-6') }}>
            <span>생성은 내 PC의 호스트 에이전트가 내 Claude 플랜으로 합니다. 터미널에서 켜 두면 바로 시작합니다.</span>
            <code className="qd-code">{SERVE_COMMAND}</code>
            <span className={textClass('caption1')}>{DEV_COMMAND_NOTE}</span>
            <span>
              처음 쓰는 PC면 먼저 계정에 연결하세요 — <Link to="/hosts">연결된 PC</Link>
            </span>
          </span>
        }
      >
        내 호스트 에이전트가 꺼져 있습니다
      </SectionMessage>
    );
  }
  const cc = host.claudeCode;
  if (cc && !cc.loggedIn) {
    return (
      <SectionMessage
        variant="cautionary"
        description="터미널에서 `claude`를 실행해 로그인하세요. 그 전에는 작업이 일시정지됩니다."
      >
        {host.name} · Claude Code 로그인 필요
      </SectionMessage>
    );
  }
  return (
    <div className={`${textClass('label2')} qd-row`} style={{ gap: token('space-8') }}>
      <Tag tone="pass">
        <Icons.IconCheck aria-hidden style={{ width: 12, height: 12 }} />
        호스트 연결됨
      </Tag>
      <span>{host.name}</span>
      {cc?.version && (
        <span className="qd-faint">
          Claude Code {cc.version}
          {cc.subscriptionType ? ` · ${cc.subscriptionType} 플랜` : ''}
        </span>
      )}
    </div>
  );
}

const STATUS_TONE: Record<JobStatus, Tone> = {
  queued: 'neutral',
  running: 'brand',
  done: 'pass',
  failed: 'fail',
  paused: 'blocked',
};

const PHASE_LABEL = { plan: '스펙 계획', cases: '케이스 변환', save: '저장' } as const;

/** 생성 작업 목록 (최근 것부터). 진행 중이면 진행률, 끝났으면 결과·문서 링크, 멈췄으면 이유와 다시 시도 */
export function JobList({ jobs, projectId, canEdit }: { jobs: QaDocJob[]; projectId: string; canEdit: boolean }) {
  if (!jobs.length) return null;
  return (
    <section className="qd-stack" style={{ gap: token('space-8') }} aria-label="QA 문서 생성 작업">
      <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
        생성 작업
      </h2>
      <div className="qd-stack" style={{ gap: token('space-8') }}>
        {jobs.slice(0, 5).map((j) => (
          <JobCard key={j.id} job={j} projectId={projectId} canEdit={canEdit} />
        ))}
      </div>
    </section>
  );
}

function JobCard({ job, projectId, canEdit }: { job: QaDocJob; projectId: string; canEdit: boolean }) {
  const api = useApi();
  const retry = useRetryJob(projectId);
  const mine = job.requestedBy === api.currentUid;
  const p = job.progress;
  return (
    <article className="qc-card qd-stack" style={{ gap: token('space-8') }}>
      <div className="qd-row" style={{ gap: token('space-8') }}>
        <span className={textClass('label1', 'bold')}>QA 문서 {job.input.appVersion}</span>
        <Tag tone={STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Tag>
        {job.error && job.status !== 'done' && <Tag tone="quiet">{JOB_ERROR_LABEL[job.error.kind]}</Tag>}
        <span className={`${textClass('label2')} qd-faint`} style={{ marginLeft: 'auto' }}>
          {job.requestedByName} · {fmtDateTime(job.createdAt)}
          {job.host ? ` · ${job.host}` : ''}
        </span>
      </div>

      {job.status === 'queued' && (
        <span className={`${textClass('label2')} qd-muted`}>
          {mine
            ? '내 호스트 에이전트가 받기를 기다리고 있습니다.'
            : `${job.requestedByName}님의 호스트 에이전트가 받기를 기다리고 있습니다.`}
        </span>
      )}

      {(job.status === 'running' || job.status === 'paused') && p && (
        <div className={`${textClass('label2')} qd-row`} style={{ gap: token('space-12') }}>
          <Progress value={p.done} total={p.total} label="생성 진행" />
          <span>
            {PHASE_LABEL[p.phase]}
            {p.spec && <span className="qd-faint"> · {p.spec}</span>}
          </span>
        </div>
      )}

      {job.error && job.status !== 'done' && (
        <div className="qd-row" style={{ gap: token('space-12'), alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <span className={`${textClass('label2')} qd-muted`} style={{ flex: 1, minWidth: 0 }}>
            {job.error.message}
          </span>
          {mine && canEdit && (
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={retry.isPending}
              onClick={() => retry.mutate(job.id)}
            >
              다시 시도
            </Button>
          )}
        </div>
      )}

      {job.status === 'done' && job.result && (
        <div className={`${textClass('label2')} qd-row`} style={{ gap: token('space-12') }}>
          <Link to={`/p/${projectId}/docs/${job.result.docId}`} className={`${textClass('label2', 'bold')} qd-link`}>
            QA 문서 열기
          </Link>
          <span>
            케이스 <span className="qd-num">{job.result.cases}</span>
            <span className="qd-faint"> (생성 {job.result.generated})</span>
          </span>
          <span>
            확인 질문 <span className="qd-num">{job.result.questions}</span>
          </span>
          {job.result.newPrepFlows > 0 && (
            <span>
              새 준비 플로우 <span className="qd-num">{job.result.newPrepFlows}</span>
            </span>
          )}
          <span className="qd-faint">
            토큰 {fmtNumber(job.result.tokens)} · API 환산 ${job.result.costUsd.toFixed(2)}
          </span>
        </div>
      )}
    </article>
  );
}
