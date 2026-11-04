import { JOB_ERROR_LABEL, type CaseReviseJob, type QADocument, type TestCase } from '@qcard/shared';
import { Button, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { fmtDateTime } from '../../components/format';
import { useApi, useCaseRevisionAction, useMyHosts } from '../../data/hooks';
import { Tag } from './Badges';
import { CaseDiff } from './CaseDiff';
import { INSTALL_COMMAND } from '../hosts/model';
import { SERVE_COMMAND } from './Jobs';
import { diffCase, hostSupport, revisionView, toBody } from './logic';

/*
 * 답변 기반 케이스 수정안: 질문 탭의 케이스 묶음 아래에 붙는다.
 * 요청은 내 호스트가 처리하고, 수정안은 요청한 사람이 보고 적용하거나 버린다. 케이스는 적용할 때만 바뀐다
 */
export function CaseRevision({
  doc,
  c,
  jobs,
  canEdit,
}: {
  doc: QADocument;
  c: TestCase;
  jobs: CaseReviseJob[];
  canEdit: boolean;
}) {
  const api = useApi();
  const action = useCaseRevisionAction(doc);
  const hosts = useMyHosts();
  const support = hosts.data ? hostSupport(hosts.data, 'case_revise') : 'ok';
  const view = revisionView(c, doc.questions, jobs);
  if (view.kind === 'none') return null;
  const mine = 'job' in view && view.job.requestedBy === api.currentUid;
  const error = action.error ? (action.error as Error).message : null;

  if (view.kind === 'ready') {
    if (!canEdit) return null;
    return (
      <div className="qd-revision qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-row" style={{ justifyContent: 'space-between' }}>
          <span className={`${textClass('label1')} qd-muted`}>
            답변을 이 케이스에 반영한 수정안을 내 호스트가 만듭니다. 케이스는 적용할 때만 바뀝니다.
          </span>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            leadingContent={<Icons.IconSparkle />}
            // 켜진 호스트가 모두 옛 버전이면 요청해도 처리되지 않는다
            disabled={support === 'outdated'}
            loading={action.isPending}
            onClick={() => action.mutate({ kind: 'request', tcId: c.tcId })}
          >
            케이스 수정안 만들기
          </Button>
        </div>
        <HostHint support={support} />
        {error && <ErrorLine text={error} />}
      </div>
    );
  }

  if (view.kind === 'waiting') {
    const running = view.job.status === 'running';
    return (
      <div className="qd-revision qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-row">
          <Tag tone={running ? 'brand' : 'neutral'}>{running ? '수정안 만드는 중' : '호스트 대기'}</Tag>
          <span className={`${textClass('label2')} qd-faint`}>
            {view.job.requestedByName} · {fmtDateTime(view.job.createdAt)}
            {running && view.job.host ? ` · ${view.job.host}` : ''}
          </span>
        </div>
        {!running && mine && <HostHint support={support} />}
      </div>
    );
  }

  if (view.kind === 'stopped') {
    const e = view.job.error;
    return (
      <div className="qd-revision">
        <SectionMessage
          variant={view.job.status === 'paused' ? 'cautionary' : 'negative'}
          description={e?.message ?? '수정안을 만들지 못했습니다.'}
          bottomButton={
            mine && canEdit ? (
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                loading={action.isPending}
                onClick={() => action.mutate({ kind: 'retry', jobId: view.job.id })}
              >
                다시 시도
              </Button>
            ) : undefined
          }
        >
          케이스 수정안 {view.job.status === 'paused' ? '일시정지' : '실패'}
          {e ? ` · ${JOB_ERROR_LABEL[e.kind]}` : ''}
        </SectionMessage>
      </div>
    );
  }

  if (view.kind === 'no_change') {
    return (
      <div className="qd-revision">
        <SectionMessage
          variant="info"
          description={view.reason}
          bottomButton={
            mine ? (
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                loading={action.isPending}
                onClick={() => action.mutate({ kind: 'dismiss', jobId: view.job.id })}
              >
                확인
              </Button>
            ) : undefined
          }
        >
          수정할 것이 없습니다
        </SectionMessage>
      </div>
    );
  }

  // 수정안
  const { job, body, reason, guessed, stale } = view;
  return (
    <div className="qd-revision qd-stack" style={{ gap: token('space-12') }}>
      <div className="qd-stack" style={{ gap: token('space-4') }}>
        <div className="qd-row">
          <span className={textClass('label1', 'bold')}>케이스 수정안</span>
          <span className={`${textClass('label2')} qd-faint`}>
            {job.requestedByName} · {fmtDateTime(job.finishedAt ?? job.createdAt)}
          </span>
        </div>
        <p className={textClass('label1')} style={{ margin: 0 }}>
          {reason}
        </p>
        {guessed.length > 0 && (
          <p className={`${textClass('label2')} qd-muted`} style={{ margin: 0 }}>
            스펙에 없는 버튼 이름 {guessed.map((n) => `[${n}]`).join(' ')}은 추정으로 표시했습니다.
          </p>
        )}
      </div>
      {stale ? (
        <SectionMessage
          variant="cautionary"
          description={`요청한 뒤 케이스가 바뀌어(rev ${job.input.baseRev} → ${c.rev}) 이 수정안을 그대로 적용할 수 없습니다. 버리고 지금 케이스로 다시 만드세요.`}
        >
          케이스가 바뀌었습니다
        </SectionMessage>
      ) : (
        <CaseDiff diffs={diffCase(toBody(c), body)} labels={{ del: '지금', add: '수정안' }} />
      )}
      {mine ? (
        <div className="qd-row" style={{ justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            disabled={action.isPending}
            onClick={() => action.mutate({ kind: 'dismiss', jobId: job.id })}
          >
            버리기
          </Button>
          {stale ? (
            <Button
              size="small"
              variant="outlined"
              color="primary"
              loading={action.isPending}
              onClick={async () => {
                await action.mutateAsync({ kind: 'dismiss', jobId: job.id });
                action.mutate({ kind: 'request', tcId: c.tcId });
              }}
            >
              버리고 다시 만들기
            </Button>
          ) : (
            <Button
              size="small"
              variant="solid"
              color="primary"
              leadingContent={<Icons.IconCheck />}
              loading={action.isPending}
              onClick={() => action.mutate({ kind: 'apply', jobId: job.id, tcId: c.tcId, body, expectedRev: c.rev })}
            >
              적용
            </Button>
          )}
        </div>
      ) : (
        <span className={`${textClass('label2')} qd-faint`}>
          요청한 {job.requestedByName}님이 적용하거나 버릴 수 있습니다.
        </span>
      )}
      {error && <ErrorLine text={error} />}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <span className={textClass('label2')} role="alert" style={{ color: token('qcard-verdict-fail-fg') }}>
      {text}
    </span>
  );
}

/** 내 호스트가 꺼져 있으면 켜는 방법, 옛 버전이면 업데이트 방법 */
function HostHint({ support }: { support: 'ok' | 'offline' | 'outdated' }) {
  if (support === 'ok') return null;
  return (
    <span className={`${textClass('label2')} qd-muted`}>
      {support === 'offline' ? (
        <>
          내 호스트 에이전트가 꺼져 있습니다. 터미널에서 <code className="qd-code">{SERVE_COMMAND}</code>를 켜면
          시작합니다.
        </>
      ) : (
        <>
          내 호스트 에이전트가 수정안을 지원하지 않는 이전 버전입니다.{' '}
          <code className="qd-code">{INSTALL_COMMAND}</code>로 업데이트한 뒤 다시 켜세요.
        </>
      )}
    </span>
  );
}
