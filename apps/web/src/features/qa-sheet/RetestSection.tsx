// 결함 탭 위쪽: 이전 사이클 결함 재테스트 (docs/product/results.md#재테스트). 이전 사이클의 fixed 결함을 이 사이클의
// 같은 칸(TC ID × 같은 모델·OS 메이저) 결과로 사람이 closed로 확정하거나 다시 연다. 확정은 Functions가 서버에서 다시 확인한다
import { RETEST_CELL_LABEL, SEVERITY_LABEL } from '@qcard/shared';
import {
  Button,
  ContentBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  VerdictBadge,
  textClass,
  token,
} from '@qcard/ui';
import { Link } from 'react-router';
import { fmtDateTime } from '../../components/format';
import type { CycleDetail } from '../../data/api';
import { useConfirmRetest } from '../../data/hooks';
import { issueStateLabel } from '../issues/model';
import { ErrorMessage } from '../projects/parts';
import { retestAction, retestCounts, type RetestRow } from './model';
import { Card, Mono, traceUrl } from './parts';
import { DEFECT_STATUS_LABEL } from './SummaryTab';

export function RetestSection({
  d,
  rows,
  projectId,
  canEdit,
}: {
  d: CycleDetail;
  rows: RetestRow[];
  projectId: string;
  canEdit: boolean;
}) {
  const confirm = useConfirmRetest({ projectId, cycleId: d.cycle.id });
  const counts = retestCounts(rows);
  const closable = rows.filter((r) => retestAction(r) === 'close');
  const run = (items: RetestRow[], to: 'closed' | 'open') =>
    confirm.mutate(
      items.map((r) => ({ source: { cycleId: r.src.cycle.id, defectId: r.src.defect.id }, to, label: r.label })),
    );
  return (
    <Card
      id="retest"
      title={`이전 사이클 결함 재테스트 ${rows.length}건`}
      actions={
        canEdit && closable.length > 1 ? (
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            loading={confirm.isPending}
            onClick={() => run(closable, 'closed')}
          >
            재테스트 Pass {closable.length}건 모두 closed로 확정
          </Button>
        ) : undefined
      }
    >
      <span className={`${textClass('label1')} qs-muted`}>
        Pass {counts.pass} · Fail {counts.fail} · 남음 {counts.pending}. 이전 빌드에서 fixed가 된 결함을 이 빌드의 같은
        칸에서 다시 본 결과입니다. 상태는 사람이 확정합니다. Fail이어도 증상이 다르면 다시 열지 말고 이 칸에 새 결함을
        만드세요.
      </span>
      <ErrorMessage error={confirm.error} title="재테스트를 확정하지 못했습니다" />
      <div className="qs-scroll-x">
        <Table sx={{ minWidth: 1080 }}>
          <TableHead>
            <TableRow>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>결함</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>제목</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>심각도</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>GitHub 이슈</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>재테스트 칸</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>칸 판정</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>확정</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.src.cycle.id}/${r.src.defect.id}`}>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <span className="qs-stack" style={{ gap: token('space-2') }}>
                    <Link
                      to={`/p/${projectId}/cycles/${r.src.cycle.id}?tab=defects`}
                      className={`qs-link ${textClass('label1', 'bold')}`}
                    >
                      <Mono>{r.src.defect.id}</Mono>
                    </Link>
                    <span className={`${textClass('caption1')} qs-muted`} style={{ whiteSpace: 'nowrap' }}>
                      {r.src.cycle.name}
                    </span>
                  </span>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', minWidth: 200 }}>{r.src.defect.title}</TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {SEVERITY_LABEL[r.src.defect.severity]}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {r.src.defect.issue ? (
                    <span className="qs-row" style={{ gap: token('space-4') }}>
                      <a
                        href={r.src.defect.issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="qs-link qc-mono"
                        aria-label={`GitHub 이슈 ${r.src.defect.issue.repo}#${r.src.defect.issue.number}`}
                      >
                        #{r.src.defect.issue.number}
                      </a>
                      <span className={`${textClass('caption1', 'medium')} qs-muted`}>
                        {issueStateLabel(r.src.defect.issue)}
                      </span>
                    </span>
                  ) : (
                    <span className="qs-faint">—</span>
                  )}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <CellRef r={r} d={d} projectId={projectId} />
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {r.cell.kind !== 'found' ? (
                    <span className="qs-faint">—</span>
                  ) : r.result && r.result.verdict !== 'nt' ? (
                    <VerdictBadge verdict={r.result.verdict} />
                  ) : (
                    <span className={`${textClass('label2', 'medium')} qs-muted`}>남음</span>
                  )}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <Decision
                    r={r}
                    d={d}
                    projectId={projectId}
                    canEdit={canEdit}
                    pending={confirm.isPending}
                    onConfirm={(to) => run([r], to)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function CellRef({ r, d, projectId }: { r: RetestRow; d: CycleDetail; projectId: string }) {
  if (r.cell.kind !== 'found')
    return (
      <span className="qs-stack" style={{ gap: token('space-2') }}>
        <span className={textClass('label1', 'medium')}>{RETEST_CELL_LABEL[r.cell.kind]}</span>
        <span className={`${textClass('caption1')} qs-muted`}>
          <Mono>{r.src.defect.tcId}</Mono>
        </span>
      </span>
    );
  return (
    <span className="qs-stack" style={{ gap: token('space-2') }}>
      <Link to={traceUrl(projectId, d.cycle.id, r.cell.tcId, r.cell.deviceId)} className="qs-link">
        <Mono>{r.cell.tcId}</Mono>
      </Link>
      <span className={`${textClass('caption1')} qs-muted`} style={{ whiteSpace: 'nowrap' }}>
        {r.cell.deviceLabel}
      </span>
      {r.cell.caseChanged && (
        <span>
          <ContentBadge color="neutral" size="small" variant="outlined">
            케이스 바뀜
          </ContentBadge>
        </span>
      )}
    </span>
  );
}

function Decision({
  r,
  d,
  projectId,
  canEdit,
  pending,
  onConfirm,
}: {
  r: RetestRow;
  d: CycleDetail;
  projectId: string;
  canEdit: boolean;
  pending: boolean;
  onConfirm: (to: 'closed' | 'open') => void;
}) {
  const action = retestAction(r);
  const status = r.src.defect.status;
  // 이 사이클에서 확정했으면 확정한 결과를 보인다. 그 뒤 다시 fixed가 됐으면 다음 새 빌드 사이클에서 재테스트한다
  if (r.record)
    return (
      <span className="qs-stack" style={{ gap: token('space-2') }}>
        <span className={textClass('label1', 'medium')}>
          {r.record.to === 'closed' ? 'closed로 확정' : '다시 열림'}
          {status !== r.record.to ? ` · 지금 ${DEFECT_STATUS_LABEL[status]}` : ''}
        </span>
        <span className={`${textClass('caption1')} qs-muted`} style={{ whiteSpace: 'nowrap' }}>
          {r.record.by} · {fmtDateTime(r.record.at)}
        </span>
        {status === 'fixed' && (
          <span className={`${textClass('caption1')} qs-muted`}>다음 새 빌드 사이클에서 재테스트합니다</span>
        )}
      </span>
    );
  if (status !== 'fixed')
    return <span className={`${textClass('label2')} qs-muted`}>지금 {DEFECT_STATUS_LABEL[status]}</span>;
  if (r.cell.kind !== 'found')
    return (
      <span className={`${textClass('caption1')} qs-muted`}>
        재테스트로 확정할 수 없습니다. 결함 사이클에서 상태를 직접 바꾸세요.
      </span>
    );
  if (r.reading === 'fail_unconfirmed')
    return (
      <span className="qs-stack" style={{ gap: token('space-2') }}>
        <span className={textClass('label1', 'medium')}>Fail 확정 필요</span>
        <Link
          to={traceUrl(projectId, d.cycle.id, r.cell.tcId, r.cell.deviceId)}
          className={`qs-link ${textClass('caption1', 'medium')}`}
        >
          판정 추적에서 칸을 먼저 확정하세요
        </Link>
      </span>
    );
  if (r.reading === 'fail' && !action)
    return (
      <span className={`${textClass('caption1')} qs-muted`}>
        이 칸에 다른 결함 {r.result?.defectId}이(가) 있습니다. 같은 증상이면 결함 사이클에서 상태를 직접 바꾸세요.
      </span>
    );
  if (!action) return <span className="qs-faint">—</span>;
  if (!canEdit)
    return (
      <span className={`${textClass('label2')} qs-muted`}>
        {action === 'close' ? '재테스트 Pass' : '재테스트 Fail'}
      </span>
    );
  return action === 'close' ? (
    <Button size="small" variant="outlined" color="primary" disabled={pending} onClick={() => onConfirm('closed')}>
      closed로 확정
    </Button>
  ) : (
    <Button size="small" variant="outlined" color="assistive" disabled={pending} onClick={() => onConfirm('open')}>
      다시 열기
    </Button>
  );
}
