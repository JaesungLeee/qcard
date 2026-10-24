// 사이클 목록 (PRD §5.4). 사이클마다 빌드·문서 버전·기간·대상 디바이스·진행·판정·실행 중 Run을 보인다.
import { Button, ContentBadge, Icons, textClass, token } from '@qcard/ui';
import { Link, useNavigate, useParams } from 'react-router';
import type { CycleSummary } from '../../data/api';
import { useCycles, useMyRole } from '../../data/hooks';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime, fmtPercent } from '../../components/format';
import { Mono, RunState, SERVER_ENV_LABEL, VerdictBar, VerdictCountList, periodLabel, useNow } from './parts';
import { isRunStale } from '@qcard/shared';
import './qa-sheet.css';

export function CycleListPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const cycles = useCycles(projectId);
  const role = useMyRole(projectId);
  const canEdit = role.data === 'admin' || role.data === 'qa';
  return (
    <div className="qc-page">
      <PageHeader
        title="테스트 사이클"
        meta="QA 문서 버전 + 빌드 + 대상 디바이스로 묶은 실행 단위. 여러 실행자의 Run 결과가 한 사이클로 모입니다."
        actions={
          <Button
            variant="solid"
            color="primary"
            leadingContent={<Icons.IconPlus />}
            disabled={!canEdit}
            title={canEdit ? undefined : 'Admin·QA만 만들 수 있습니다'}
            onClick={() => void navigate(`/p/${projectId}/cycles/new`)}
          >
            사이클 만들기
          </Button>
        }
      />
      <QueryState query={cycles}>
        {(list) =>
          list.length === 0 ? (
            <div className="qc-card qs-empty">
              <span className={textClass('headline2', 'bold')}>아직 사이클이 없습니다</span>
              <span className={`${textClass('label1')} qs-muted`}>승인된 QA 문서와 빌드로 사이클을 만드세요.</span>
            </div>
          ) : (
            <ul className="qs-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="사이클 목록">
              {[...list]
                .sort((a, b) => b.cycle.period.start.localeCompare(a.cycle.period.start))
                .map((s) => (
                  <li key={s.cycle.id}>
                    <CycleCard s={s} projectId={projectId} />
                  </li>
                ))}
            </ul>
          )
        }
      </QueryState>
    </div>
  );
}

function CycleCard({ s, projectId }: { s: CycleSummary; projectId: string }) {
  const now = useNow();
  const { cycle, build } = s;
  const completed = Boolean(cycle.period.end);
  const progress = s.total ? s.done / s.total : 0;
  // 호스트에서 돌린 실행을 묶은 것: 빌드 대신 설치된 앱, 진행 상태 대신 "로컬 실행"
  const local = cycle.origin === 'local_run';
  const deviceLabel = (id: string) => cycle.targets.find((d) => d.id === id)?.label ?? id;
  return (
    <Link to={`/p/${projectId}/cycles/${cycle.id}`} className="qc-card qs-cycle">
      <div className="qs-card-head" style={{ alignItems: 'center' }}>
        <div className="qs-row" style={{ gap: token('space-10') }}>
          <h2 className={textClass('headline2', 'bold')}>{cycle.name}</h2>
          {local ? (
            <ContentBadge size="small" variant="outlined" color="neutral" leadingContent={<Icons.IconPhone />}>
              로컬 실행
            </ContentBadge>
          ) : (
            <ContentBadge
              size="small"
              variant={completed ? 'outlined' : 'solid'}
              color={completed ? 'neutral' : 'accent'}
            >
              {completed ? '완료' : '진행 중'}
            </ContentBadge>
          )}
        </div>
        <span className={`qs-row ${textClass('label2', 'medium')} qs-muted`} style={{ gap: token('space-2') }}>
          QA 시트 열기
          <Icons.IconChevronRightSmall aria-hidden />
        </span>
      </div>

      <div className={`qs-row ${textClass('label1')} qs-muted`} style={{ columnGap: token('space-16') }}>
        {local ? (
          <span>
            설치된 앱{' '}
            <b style={{ color: token('foreground-neutral-primary') }}>
              <Mono>{build.packageName}</Mono>
            </b>
          </span>
        ) : (
          <span>
            빌드{' '}
            <b className="qs-big" style={{ color: token('foreground-neutral-primary') }}>
              {build.version} ({build.buildNumber})
            </b>
          </span>
        )}
        <span>
          QA 문서 <b style={{ color: token('foreground-neutral-primary') }}>v{s.docVersion}</b>
        </span>
        <span>기간 {periodLabel(cycle.period)}</span>
        {!local && <span>서버 {SERVER_ENV_LABEL[cycle.serverEnv]}</span>}
      </div>

      <div className="qs-cycle-body">
        <section aria-label="진행">
          <div className="qs-card-head">
            <span className={`${textClass('label2', 'medium')} qs-faint`}>진행</span>
            <span className={`${textClass('label1', 'medium')} qs-big`}>
              {s.done} / {s.total}칸 · {fmtPercent(progress)}
            </span>
          </div>
          <VerdictBar counts={s.counts} total={s.total} label="판정 분포" />
          <VerdictCountList counts={s.counts} hideZero />
        </section>

        <section aria-label="통과율과 대상 디바이스">
          <span className={`${textClass('label2', 'medium')} qs-faint`}>통과율</span>
          <span className={`${textClass('title3', 'bold')} qs-big`}>{fmtPercent(s.passRate)}</span>
          <div className="qs-row" style={{ gap: token('space-4') }}>
            {cycle.targets.map((d) => (
              <ContentBadge
                key={d.id}
                size="small"
                variant="outlined"
                color="neutral"
                leadingContent={<Icons.IconPhone />}
              >
                {d.label}
              </ContentBadge>
            ))}
          </div>
        </section>

        <section aria-label="실행 중인 Run">
          <span className={`${textClass('label2', 'medium')} qs-faint`}>실행 중인 Run</span>
          {s.activeRuns.length === 0 ? (
            <span className={`${textClass('label1')} qs-muted`}>
              {completed ? `${fmtDateTime(cycle.period.end!)} 완료` : '없음'}
            </span>
          ) : (
            s.activeRuns.map((r) => (
              <div
                key={r.id}
                className={`qs-run ${textClass('label2')}`}
                style={{ flexDirection: 'column', alignItems: 'flex-start' }}
              >
                <span className="qs-row" style={{ gap: token('space-6') }}>
                  <RunState
                    paused={r.status === 'paused'}
                    reason={r.pauseReason}
                    stale={isRunStale(r, now)}
                    waiting={r.waiting?.level}
                  />
                  <b>{r.executor}</b>
                  <span className="qs-muted">{deviceLabel(r.deviceId)}</span>
                </span>
                {r.currentTcId && (
                  <span className="qs-muted">
                    현재 케이스 <Mono>{r.currentTcId}</Mono>
                  </span>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </Link>
  );
}
