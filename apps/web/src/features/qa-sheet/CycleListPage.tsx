// 사이클 목록 (docs/product/cycles.md). 사이클마다 빌드·문서 버전·기간·대상 디바이스·진행·판정·실행 중 Run을 보인다.
import { Button, Chip, ContentBadge, Icons, textClass, token } from '@qcard/ui';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CycleSummary } from '../../data/api';
import { useCycles, useMyRole } from '../../data/hooks';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDate, fmtDateTime, fmtPercent } from '../../components/format';
import { Mono, RunState, SERVER_ENV_LABEL, VerdictBar, VerdictCountList, periodLabel, useNow } from './parts';
import { isRunStale } from '@qcard/shared';
import { isActiveCycle } from '@qcard/data';
import { CycleDeletedMessage, CycleMenu, DELETE_PARAM, useDeleteBlocker } from './CycleDelete';
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
      <CycleDeletedMessage />
      <QueryState query={cycles}>
        {(list) =>
          list.length === 0 ? (
            <div className="qc-card qs-empty">
              <span className={textClass('headline2', 'bold')}>아직 사이클이 없습니다</span>
              <span className={`${textClass('label1')} qs-muted`}>승인된 QA 문서와 빌드로 사이클을 만드세요.</span>
            </div>
          ) : (
            <CycleSections list={list} projectId={projectId} canEdit={canEdit} />
          )
        }
      </QueryState>
    </div>
  );
}

type CycleGroupKey = 'ready' | 'active' | 'done' | 'local';
const GROUPS: CycleGroupKey[] = ['ready', 'active', 'done', 'local'];
const GROUP_LABEL: Record<CycleGroupKey, string> = {
  ready: '시작 전',
  active: '진행 중',
  done: '완료',
  local: '로컬 실행',
};
const GROUP_EMPTY: Record<Exclude<CycleGroupKey, 'local'>, [string, string]> = {
  ready: ['시작 전인 사이클이 없습니다', '새로 만든 사이클은 Run을 시작하거나 결과를 입력하기 전까지 여기에 있습니다.'],
  active: ['진행 중인 사이클이 없습니다', '시작 전 사이클에서 Run을 시작하거나, 새 빌드로 사이클을 만드세요.'],
  done: ['완료된 사이클이 없습니다', '사이클 요약에서 사이클 완료를 누르면 여기로 옮겨집니다.'],
};

/** 판정된 칸도 실행 중인 Run도 없는, 아직 아무도 시작하지 않은 사이클 */
const isNotStarted = (s: CycleSummary) => isActiveCycle(s.cycle) && s.done === 0 && s.activeRuns.length === 0;

/**
 * 시작 전·진행 중·완료를 칩으로 나눠 하나씩 보인다. 완료 기록은 사이클 간 비교·놓친 결함의 기준이라
 * 지우지 않고 칩 뒤에 둔다. 로컬 실행(개발 서버 전용)은 사람이 완료한 사이클이 아니라 따로 둔다
 */
function CycleSections({ list, projectId, canEdit }: { list: CycleSummary[]; projectId: string; canEdit: boolean }) {
  const recent = [...list].sort((a, b) => b.cycle.period.start.localeCompare(a.cycle.period.start));
  const groups: Record<CycleGroupKey, CycleSummary[]> = {
    ready: recent.filter(isNotStarted),
    active: recent.filter((s) => isActiveCycle(s.cycle) && !isNotStarted(s)),
    done: recent.filter((s) => s.cycle.period.end && s.cycle.origin !== 'local_run'),
    local: recent.filter((s) => s.cycle.origin === 'local_run'),
  };
  // 진행 중이 없으면 시작 전부터 보인다 (새로 만든 사이클이 빈 칩 뒤에 숨지 않게)
  const [group, setGroup] = useState<CycleGroupKey>(() =>
    groups.active.length === 0 && groups.ready.length > 0 ? 'ready' : 'active',
  );
  const items = groups[group];
  return (
    <div className="qs-stack">
      <div className="qs-row" role="group" aria-label="사이클 묶음">
        {GROUPS.filter((g) => g !== 'local' || groups.local.length > 0).map((g) => (
          <Chip key={g} size="small" active={group === g} onClick={() => setGroup(g)}>
            {GROUP_LABEL[g]} {groups[g].length}
          </Chip>
        ))}
      </div>
      {items.length > 0 ? (
        <CycleList label={`${GROUP_LABEL[group]} 사이클`} items={items} projectId={projectId} canEdit={canEdit} />
      ) : (
        group !== 'local' && (
          <div className="qc-card qs-empty">
            <span className={textClass('headline2', 'bold')}>{GROUP_EMPTY[group][0]}</span>
            <span className={`${textClass('label1')} qs-muted`}>{GROUP_EMPTY[group][1]}</span>
          </div>
        )
      )}
    </div>
  );
}

function CycleList({
  label,
  items,
  projectId,
  canEdit,
}: {
  label: string;
  items: CycleSummary[];
  projectId: string;
  canEdit: boolean;
}) {
  return (
    <ul className="qs-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={label}>
      {items.map((s) => (
        <li key={s.cycle.id} className="qs-cycle-item">
          <CycleCard s={s} projectId={projectId} />
          {canEdit && s.cycle.origin !== 'local_run' && <CycleCardMenu s={s} projectId={projectId} />}
        </li>
      ))}
    </ul>
  );
}

/** 카드의 [⋯]. 카드 전체가 링크라 그 위에 겹쳐 둔다. 확인은 QA 시트에서 지워질 건수를 보며 한다 */
function CycleCardMenu({ s, projectId }: { s: CycleSummary; projectId: string }) {
  const navigate = useNavigate();
  const blocker = useDeleteBlocker(s.cycle, s.activeRuns);
  return (
    <span className="qs-cycle-menu">
      <CycleMenu
        blocker={blocker}
        onDelete={() => void navigate(`/p/${projectId}/cycles/${s.cycle.id}?${DELETE_PARAM}=1`)}
      />
    </span>
  );
}

function CycleCard({ s, projectId }: { s: CycleSummary; projectId: string }) {
  const now = useNow();
  const { cycle, build } = s;
  const completed = Boolean(cycle.period.end);
  const notStarted = isNotStarted(s);
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
              variant={completed || notStarted ? 'outlined' : 'solid'}
              color={completed || notStarted ? 'neutral' : 'accent'}
            >
              {completed ? '완료' : notStarted ? '시작 전' : '진행 중'}
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
        <span>{notStarted ? `${fmtDate(cycle.period.start)} 생성` : `기간 ${periodLabel(cycle.period)}`}</span>
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
          {s.unlinkedFails > 0 && (
            <span className={textClass('label2', 'medium')} style={{ color: token('qcard-verdict-fail-fg') }}>
              결함 없는 Fail {s.unlinkedFails}칸
            </span>
          )}
        </section>

        <section aria-label="통과율과 대상 디바이스">
          <span className={`${textClass('label2', 'medium')} qs-faint`}>통과율</span>
          <span className={`${textClass('title3', 'bold')} qs-big`}>{notStarted ? '—' : fmtPercent(s.passRate)}</span>
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
