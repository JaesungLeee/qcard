import {
  CHANGE_LABEL,
  JOB_ERROR_LABEL,
  JOB_EVENT_LABEL,
  JOB_STATUS_LABEL,
  type JobEventKind,
  type JobPlanRow,
  type QaDocJob,
  type QaDocJobDraft,
  type QaDocJobSpec,
} from '@qcard/shared';
import { Button, Chip, IconButton, Icons, Pagination, SectionMessage, textClass, token } from '@qcard/ui';
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CheckLabel } from '../../components/CheckLabel';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime, fmtNumber } from '../../components/format';
import {
  useApi,
  useJobDrafts,
  useJobEvents,
  useJobSpecs,
  useJobs,
  useMyRole,
  usePrepFlows,
  useQaDocs,
  useRetryJob,
} from '../../data/hooks';
import { ChangeBadge, Tag, type Tone } from './Badges';
import { Block, CaseBodyBlocks } from './CaseDetail';
import { CaseDiff } from './CaseDiff';
import { JOB_STATUS_TONE, PhaseSteps } from './Jobs';
import {
  fmtDuration,
  initialPage,
  jobTiming,
  paged,
  ROW_STATUS_LABEL,
  rowStatus,
  type RowStatus,
} from './jobProgress';
import { diffCase, shortReq } from './logic';
import { RichText } from './RichText';
import './qa-doc.css';
import './job-progress.css';

/*
 * QA 문서 생성 작업 상세 (docs/product/qa-doc.md): 호스트가 만드는 동안 무엇을 어떻게 만들고 있는지 본다.
 * 생성 계획(이전 문서와 매칭한 행) → 행마다 상태·초안 → 진행 기록. 대기·생성 중이면 3초마다 갱신한다.
 * 주소: `?spec=<스펙>&row=<행 ID>&page=<행 페이지>&log=<기록 페이지>`
 */

const ROWS_PER_PAGE = 12;
const EVENTS_PER_PAGE = 10;

const ROW_TONE: Record<RowStatus, Tone> = {
  wait: 'quiet',
  active: 'brand',
  draft: 'blue',
  saved: 'pass',
  copy: 'neutral',
};
const EVENT_TONE: Record<JobEventKind, Tone> = {
  start: 'neutral',
  plan: 'brand',
  prep_flow: 'violet',
  cases: 'pass',
  question: 'check',
  warning: 'blocked',
  stop: 'blocked',
  done: 'pass',
};

export function JobProgressPage() {
  const { projectId = '', jobId = '' } = useParams();
  const jobs = useJobs(projectId);
  const role = useMyRole(projectId);
  const canEdit = role.data === 'admin' || role.data === 'qa';
  return (
    <div className="qc-page">
      <QueryState query={jobs}>
        {(list) => {
          const job = list.find((j): j is QaDocJob => j.id === jobId && j.kind === 'qa_doc_generate');
          if (!job)
            return (
              <SectionMessage variant="negative" description="삭제됐거나 이 프로젝트의 작업이 아닙니다.">
                작업을 찾을 수 없습니다
              </SectionMessage>
            );
          return <JobProgress job={job} projectId={projectId} canEdit={canEdit} />;
        }}
      </QueryState>
    </div>
  );
}

function JobProgress({ job, projectId, canEdit }: { job: QaDocJob; projectId: string; canEdit: boolean }) {
  const api = useApi();
  const navigate = useNavigate();
  const retry = useRetryJob(projectId);
  const active = job.status === 'queued' || job.status === 'running';
  const specs = useJobSpecs(projectId, job.id, active);
  const events = useJobEvents(projectId, job.id, active);
  const docs = useQaDocs(projectId);
  const mine = job.requestedBy === api.currentUid;
  const stopped = job.status === 'paused' || job.status === 'failed';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'QA 문서', to: `/p/${projectId}/docs` }]}
        title={`QA 문서 ${job.input.appVersion} 생성`}
        meta={
          <span className={`${textClass('label2')} qd-meta`}>
            <span>
              <Tag tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Tag>
            </span>
            <span>
              {job.requestedByName} · <span className="qd-num">{fmtDateTime(job.createdAt)}</span>
            </span>
            {job.host && <span>{job.host}</span>}
            {job.input.prevDocId && (
              <span>
                이전 문서{' '}
                <Link className="qd-link" to={`/p/${projectId}/docs/${job.input.prevDocId}`}>
                  {docs.data?.find((d) => d.id === job.input.prevDocId)?.appVersion ?? job.input.prevDocId}
                </Link>
              </span>
            )}
          </span>
        }
        actions={
          job.status === 'done' && job.result ? (
            <Button
              variant="solid"
              color="primary"
              onClick={() => void navigate(`/p/${projectId}/docs/${job.result!.docId}`)}
            >
              QA 문서 열기
            </Button>
          ) : stopped && mine && canEdit ? (
            <Button variant="solid" color="primary" loading={retry.isPending} onClick={() => retry.mutate(job.id)}>
              다시 시도
            </Button>
          ) : undefined
        }
      />

      {stopped && job.error && (
        <SectionMessage
          variant={job.status === 'paused' ? 'cautionary' : 'negative'}
          description={
            <span>
              {job.error.message}
              <br />
              {mine
                ? '다시 시도하면 끝난 모델 호출은 녹화에서 건너뛰고, 남은 행만 만듭니다. 지금까지 만든 초안은 그대로 볼 수 있습니다.'
                : `${job.requestedByName}님이 다시 시도할 수 있습니다. 지금까지 만든 초안은 그대로 볼 수 있습니다.`}
            </span>
          }
        >
          {JOB_STATUS_LABEL[job.status]} · {JOB_ERROR_LABEL[job.error.kind]}
        </SectionMessage>
      )}
      {job.status === 'queued' && (
        <SectionMessage
          variant="info"
          description={`${mine ? '내' : `${job.requestedByName}님의`} 호스트 에이전트가 작업을 받으면 이전 문서와 비교해 바뀐 행을 찾고, 스펙마다 계획을 세운 뒤 행을 8개씩 묶어 케이스로 바꿉니다.`}
        >
          호스트 대기
        </SectionMessage>
      )}

      <Summary job={job} questions={events.data?.filter((e) => e.kind === 'question').length} />

      <QueryState query={specs}>
        {(list) =>
          list.length ? (
            <Rows job={job} specs={list} projectId={projectId} active={active} />
          ) : (
            <div className="qc-card qd-muted">
              {active
                ? '호스트가 작업을 받으면 생성 계획(바뀐 행)이 여기에 보입니다.'
                : '이 작업에는 생성 계획이 남아 있지 않습니다. 진행 화면이 생기기 전에 처리한 작업입니다.'}
            </div>
          )
        }
      </QueryState>

      <QueryState query={events}>{(list) => <Timeline events={list} />}</QueryState>
    </>
  );
}

// ---------------------------------------------------------------- 요약

function Summary({ job, questions }: { job: QaDocJob; questions?: number }) {
  const plan = job.plan;
  const sum = (k: 'new' | 'changed' | 'same') => plan?.specs.reduce((n, s) => n + s[k], 0) ?? 0;
  const drafted = Object.values(job.progress?.drafted ?? {}).reduce((n, x) => n + x, 0);
  const { elapsedMs, etaMs } = jobTiming(job);
  const stats: { label: string; value: number | string; sub: string }[] = plan
    ? [
        { label: '전체 행', value: sum('new') + sum('changed') + sum('same'), sub: `스펙 ${plan.specs.length}개` },
        { label: CHANGE_LABEL.new, value: sum('new'), sub: '새 TC ID' },
        { label: CHANGE_LABEL.changed, value: sum('changed'), sub: '같은 TC ID로 다시 생성' },
        { label: CHANGE_LABEL.same, value: sum('same'), sub: '이전 케이스 사용' },
        { label: '초안', value: drafted, sub: `만들 행 ${sum('new') + sum('changed')}개 중` },
        { label: '확인 질문', value: questions ?? '–', sub: '저장하면 승인 보류' },
      ]
    : [];
  return (
    <section className="qc-card qd-stack" aria-label="생성 요약">
      <div className="qd-row" style={{ justifyContent: 'space-between', gap: token('space-12') }}>
        <PhaseSteps job={job} />
        <span className={`${textClass('label2')} qd-muted`}>
          {[
            elapsedMs !== undefined && `${job.status === 'done' ? '걸린 시간' : '경과'} ${fmtDuration(elapsedMs)}`,
            etaMs !== undefined && `남은 시간 약 ${fmtDuration(etaMs)}`,
            job.progress?.tokens !== undefined && `토큰 ${fmtNumber(job.progress.tokens)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      {stats.length > 0 && (
        <dl className="qd-job-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className={`${textClass('caption1', 'medium')} qd-faint`}>{s.label}</dt>
              <dd className={`${textClass('title3', 'bold')} qd-num`}>{s.value}</dd>
              <dd className={`${textClass('caption1')} qd-faint`}>{s.sub}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 행

function Rows({
  job,
  specs,
  projectId,
  active,
}: {
  job: QaDocJob;
  specs: QaDocJobSpec[];
  projectId: string;
  active: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const set = (next: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(next)) if (v === null) p.delete(k);
        else p.set(k, v);
        return p;
      },
      { replace: true },
    );
  // 처음에는 지금 만들고 있는 스펙
  const specName =
    params.get('spec') ??
    (job.progress?.spec && specs.some((s) => s.spec === job.progress!.spec) ? job.progress.spec : specs[0]!.spec);
  const spec = specs.find((s) => s.spec === specName) ?? specs[0]!;
  const hideSame = params.get('same') === 'hide';
  const drafts = useJobDrafts(projectId, job.id, spec.spec, active);
  // 만든 문서가 생기면 그 버전의 플로우, 그 전에는 이어받을 이전 버전의 플로우로 이름을 보인다
  const prepFlows = usePrepFlows(projectId, job.result?.docId ?? job.input.prevDocId);
  const prepName = useMemo(() => {
    const byId = new Map((prepFlows.data ?? []).map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [prepFlows.data]);

  const draftOf = useMemo(() => new Map((drafts.data ?? []).map((d) => [d.rowId, d])), [drafts.data]);
  const drafted = useMemo(() => new Set(draftOf.keys()), [draftOf]);
  const visible = spec.rows.filter((r) => !(hideSame && r.change === 'same'));
  const statuses = visible.map((r) => rowStatus(job, spec.spec, r, drafted));
  const page = paged(
    visible.map((r, i) => ({ row: r, status: statuses[i]! })),
    Number(params.get('page') ?? initialPage(statuses, ROWS_PER_PAGE)),
    ROWS_PER_PAGE,
  );
  const current = spec.rows.find((r) => r.id === params.get('row'));

  return (
    <section className="qd-stack" aria-label="행">
      <div className="qd-toolbar">
        <h2 className={textClass('headline2', 'bold')}>행</h2>
        <CheckLabel
          className={`${textClass('label1')} qd-check`}
          checked={hideSame}
          onCheckedChange={(v) => set({ same: v ? 'hide' : null, page: null })}
        >
          동일 행 숨기기
        </CheckLabel>
      </div>
      {specs.length > 1 && (
        <div className="qd-row" role="group" aria-label="스펙">
          {specs.map((s) => {
            const targets = s.rows.filter((r) => r.change !== 'same').length;
            return (
              <Chip
                key={s.spec}
                size="small"
                variant="outlined"
                active={s.spec === spec.spec}
                onClick={() => set({ spec: s.spec, row: null, page: null })}
              >
                {s.spec} <span className="qc-mono">{`${job.progress?.drafted?.[s.spec] ?? 0}/${targets}`}</span>
              </Chip>
            );
          })}
        </div>
      )}

      <div className={`qd-split${current ? ' has-panel' : ''}`}>
        <div className="qc-card qd-jobrows">
          <div className={`${textClass('label2')} qd-jobrows-head`}>
            <span className={textClass('label1', 'bold')}>{spec.spec}</span>
            <span className="qd-faint">
              {spec.title} · 행 {spec.rows.length} · 만들 행 {spec.rows.filter((r) => r.change !== 'same').length} · 초안{' '}
              {drafted.size}
            </span>
          </div>
          {page.items.length === 0 && (
            <p className={`${textClass('label1')} qd-muted qd-jobrows-empty`}>
              이 스펙은 모두 이전 문서와 같아 이전 케이스를 그대로 씁니다.
            </p>
          )}
          <ul className="qd-jobrows-list">
            {page.items.map(({ row, status }, i) => (
              <li key={row.id}>
                {(i === 0 || page.items[i - 1]!.row.flow !== row.flow) && (
                  <div className={`${textClass('caption1', 'medium')} qd-jobrows-flow`}>{row.flow}</div>
                )}
                <button
                  type="button"
                  className={`qd-jobrow${row.id === current?.id ? ' is-current' : ''}`}
                  aria-current={row.id === current?.id ? 'true' : undefined}
                  onClick={() => set({ row: row.id })}
                >
                  <span className={`${textClass('label2')} qc-mono qd-muted qd-jobrow-id`}>{row.id}</span>
                  <span
                    className={`${textClass('label1')} qd-cell-title`}
                    style={{ flex: 1, color: row.change === 'same' ? token('foreground-neutral-tertiary') : undefined }}
                  >
                    {row.title}
                  </span>
                  <ChangeBadge change={row.change} />
                  <Tag tone={ROW_TONE[status]}>{ROW_STATUS_LABEL[status]}</Tag>
                </button>
              </li>
            ))}
          </ul>
          {page.pages > 1 && (
            <div className={`${textClass('label2')} qd-jobpager`}>
              <span className="qd-faint qd-num">
                {page.from}–{page.to} / {visible.length}
              </span>
              <Pagination
                variant="compact"
                page={page.page}
                totalPages={page.pages}
                onChange={(p) => set({ page: String(p ?? 1), row: null })}
              />
            </div>
          )}
        </div>
        {current && (
          <RowPanel
            job={job}
            spec={spec.spec}
            row={current}
            status={rowStatus(job, spec.spec, current, drafted)}
            draft={draftOf.get(current.id)}
            projectId={projectId}
            prepName={prepName}
            onClose={() => set({ row: null })}
          />
        )}
      </div>
    </section>
  );
}

const STATUS_NOTE: Record<RowStatus, string> = {
  wait: '아직 만들지 않은 행입니다. 차례가 되면 같은 스펙의 행을 8개씩 묶어 모델에 보냅니다.',
  active: '지금 이 행이 든 묶음을 만들고 있습니다. 끝나면 초안이 여기에 보입니다.',
  draft: 'QA 문서에 저장되기 전 초안입니다. 스펙에 없는 버튼 이름 표시와 iOS 전용 제외는 저장할 때 합니다.',
  saved: 'QA 문서에 저장됐습니다. 검토·승인은 문서에서 합니다.',
  copy: '스펙 행과 관련 요구사항이 이전 문서와 같아 모델을 거치지 않고 이전 케이스를 그대로 씁니다. 사람의 수정과 승인도 남습니다.',
};

function RowPanel({
  job,
  spec,
  row,
  status,
  draft,
  projectId,
  prepName,
  onClose,
}: {
  job: QaDocJob;
  spec: string;
  row: JobPlanRow;
  status: RowStatus;
  draft?: QaDocJobDraft;
  projectId: string;
  prepName: (id: string) => string;
  onClose: () => void;
}) {
  const diffs = useMemo(
    () => (draft && row.previous ? diffCase(row.previous, draft.body, prepName) : []),
    [draft, row.previous, prepName],
  );
  const caseLink =
    status === 'saved' && job.result
      ? `/p/${projectId}/docs/${job.result.docId}?case=${row.tcId}`
      : status === 'copy' && job.input.prevDocId
        ? `/p/${projectId}/docs/${job.input.prevDocId}?case=${row.tcId}`
        : undefined;
  return (
    <aside className="qc-card qd-panel" aria-label={`${row.tcId} 생성 상세`}>
      <div className="qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <span className="qd-row">
            <span className={`${textClass('label1', 'bold')} qc-mono`}>{row.tcId}</span>
            <ChangeBadge change={row.change} />
            <Tag tone={ROW_TONE[status]}>{ROW_STATUS_LABEL[status]}</Tag>
          </span>
          <IconButton aria-label="상세 닫기" size="medium" onClick={onClose}>
            <Icons.IconClose />
          </IconButton>
        </div>
        <h2 className={textClass('headline2', 'bold')}>{draft?.body.title ?? row.title}</h2>
        <div className={`${textClass('label2')} qd-faint`}>
          <span className="qc-mono">
            {spec}/{row.id}
          </span>
          <span className="qd-dot-sep" />
          {row.requirementIds.map(shortReq).join(', ')}
        </div>
      </div>

      <p className={`${textClass('label2')} qd-muted`} style={{ margin: 0 }}>
        {STATUS_NOTE[status]}
        {caseLink && (
          <>
            {' '}
            <Link className="qd-link" to={caseLink}>
              {status === 'saved' ? 'QA 문서에서 보기' : '이전 문서에서 보기'}
            </Link>
          </>
        )}
      </p>

      {draft && draft.questions.length > 0 && (
        <SectionMessage variant="cautionary" description={draft.questions.join(' / ')}>
          확인 질문 — 저장되면 이 케이스는 승인 보류
        </SectionMessage>
      )}

      <Block title="스펙 원문">
        <dl className={`${textClass('label1')} qd-fields`}>
          {row.kind === 'TS' ? (
            <>
              <dt>Given</dt>
              <dd>{row.given ? <RichText text={row.given} /> : <span className="qd-faint">없음</span>}</dd>
              <dt>When</dt>
              <dd>
                <RichText text={row.when} />
              </dd>
              <dt>Then</dt>
              <dd>
                <RichText text={row.then} />
              </dd>
            </>
          ) : (
            <>
              <dt>상황</dt>
              <dd>
                <RichText text={row.when} />
              </dd>
              <dt>처리</dt>
              <dd>
                <RichText text={row.then} />
              </dd>
            </>
          )}
        </dl>
      </Block>

      {draft && row.previous && (
        <Block title="이전 버전 대비 변경">
          <CaseDiff diffs={diffs} />
        </Block>
      )}
      {draft && <CaseBodyBlocks body={draft.body} tcId={row.tcId} prepName={prepName} />}
    </aside>
  );
}

// ---------------------------------------------------------------- 진행 기록

function Timeline({ events }: { events: { id: string; at: string; kind: JobEventKind; text: string }[] }) {
  const [params, setParams] = useSearchParams();
  const newest = [...events].reverse();
  const page = paged(newest, Number(params.get('log') ?? 1), EVENTS_PER_PAGE);
  return (
    <section className="qc-card qd-stack" aria-label="진행 기록">
      <div className="qd-row" style={{ justifyContent: 'space-between' }}>
        <h2 className={textClass('headline2', 'bold')}>진행 기록</h2>
        {events.length > 0 && <span className={`${textClass('label2')} qd-faint`}>최근 것부터 · {events.length}개</span>}
      </div>
      {events.length === 0 ? (
        <p className={`${textClass('label1')} qd-muted`} style={{ margin: 0 }}>
          아직 기록이 없습니다.
        </p>
      ) : (
        <ol className={`${textClass('label2')} qd-timeline`}>
          {page.items.map((e) => (
            <li key={e.id}>
              <span className="qd-num qd-faint">{fmtDateTime(e.at)}</span>
              <span>
                <Tag tone={EVENT_TONE[e.kind]}>{JOB_EVENT_LABEL[e.kind]}</Tag>
              </span>
              <span className={e.kind === 'warning' || e.kind === 'stop' ? 'qd-muted' : undefined}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      {page.pages > 1 && (
        <div className={`${textClass('label2')} qd-jobpager`} style={{ padding: 0 }}>
          <span className="qd-faint qd-num">
            {page.from}–{page.to} / {events.length}
          </span>
          <Pagination
            variant="compact"
            page={page.page}
            totalPages={page.pages}
            onChange={(p) =>
              setParams(
                (x) => {
                  x.set('log', String(p ?? 1));
                  return x;
                },
                { replace: true },
              )
            }
          />
        </div>
      )}
    </section>
  );
}
