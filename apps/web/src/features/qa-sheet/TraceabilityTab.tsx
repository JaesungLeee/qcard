// ④ 추적성 매트릭스 (docs/product/results.md): 요구사항 × TC, 요구사항별 커버리지·통과 여부
import { VERDICT_LABEL } from '@qcard/shared';
import {
  Chip,
  ContentBadge,
  Icons,
  SectionMessage,
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
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { fmtPercent } from '../../components/format';
import { resultKey, shortId, traceability, traceSummary, type TraceRow } from './model';
import { Card, Stat, TabBody, traceUrl } from './parts';
import type { SheetProps } from './QaSheetPage';

type Filter = 'all' | 'uncovered' | 'issue';

export function TraceabilityTab({ d, index, projectId }: SheetProps) {
  const rows = useMemo(
    () => traceability(d.doc.requirements, d.cases, d.cycle.targets, index),
    [d.doc.requirements, d.cases, d.cycle.targets, index],
  );
  const s = traceSummary(rows);
  const [filter, setFilter] = useState<Filter>('all');
  const issue = (r: TraceRow) => r.status === 'fail' || r.status === 'blocked' || r.status === 'check';
  const visible = rows.filter((r) =>
    filter === 'all' ? true : filter === 'uncovered' ? r.status === 'uncovered' : issue(r),
  );
  const firstDevice = d.cycle.targets[0]?.id ?? '';

  return (
    <TabBody>
      {s.uncovered > 0 && (
        <SectionMessage
          variant="cautionary"
          description="이 사이클 스냅샷에 연결된 케이스가 없는 요구사항입니다. QA 문서에서 케이스를 보강하거나 제외 사유를 남기세요."
        >
          미커버 요구사항 {s.uncovered}건
        </SectionMessage>
      )}
      <div className="qs-stat-row">
        <Stat label="요구사항" value={s.total} />
        <Stat label="커버리지" value={fmtPercent(s.coverage)} sub={`${s.covered} / ${s.total} 연결`} />
        <Stat label="모두 Pass" value={s.passed} sub="연결 케이스 전 디바이스 Pass" />
        <Stat label="Fail 포함" value={s.failing} />
      </div>
      <Card
        title="요구사항별 연결 케이스"
        actions={
          <div className="qs-row" role="group" aria-label="요구사항 필터">
            <Chip size="small" active={filter === 'all'} onClick={() => setFilter('all')}>
              전체 {rows.length}
            </Chip>
            <Chip size="small" active={filter === 'issue'} onClick={() => setFilter('issue')}>
              문제 있음 {rows.filter(issue).length}
            </Chip>
            <Chip size="small" active={filter === 'uncovered'} onClick={() => setFilter('uncovered')}>
              미커버 {s.uncovered}
            </Chip>
          </div>
        }
      >
        <div className="qs-scroll-x">
          <Table sx={{ minWidth: 860 }}>
            <TableHead>
              <TableRow>
                <TableHeadCell>요구사항 ID</TableHeadCell>
                <TableHeadCell>요구사항</TableHeadCell>
                <TableHeadCell sx={{ textAlign: 'right' }}>케이스</TableHeadCell>
                <TableHeadCell>연결 TC (디바이스 종합 판정)</TableHeadCell>
                <TableHeadCell>통과 여부</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.requirement.id}>
                  <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <span className={`qc-mono ${textClass('label2', 'medium')}`} title={r.requirement.id}>
                      {shortId(r.requirement.id)}
                    </span>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', minWidth: 280, maxWidth: 420 }}>
                    <span className={textClass('label2')}>{r.requirement.text.replace(/\*\*|`/g, '')}</span>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', textAlign: 'right' }}>
                    <span className="qs-big">{r.cases.length}</span>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', minWidth: 260 }}>
                    {r.cases.length === 0 ? (
                      <span className="qs-faint">—</span>
                    ) : (
                      <span className="qs-row" style={{ gap: token('space-4') }}>
                        {r.cases.map(({ tc, verdict }) => {
                          const failing = d.cycle.targets.find(
                            (t) => index.get(resultKey(tc.tcId, t.id))?.verdict === verdict,
                          );
                          return (
                            <Link
                              key={tc.tcId}
                              to={traceUrl(projectId, d.cycle.id, tc.tcId, failing?.id ?? firstDevice)}
                              className="qs-link qs-row"
                              style={{ gap: token('space-2') }}
                              title={`${tc.tcId} ${tc.title} — ${VERDICT_LABEL[verdict]}`}
                            >
                              <VerdictBadge verdict={verdict} short />
                              <span className={`qc-mono ${textClass('caption1')}`}>{shortId(tc.sourceId)}</span>
                            </Link>
                          );
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    {r.status === 'uncovered' ? (
                      <ContentBadge color="neutral" size="small" variant="outlined" leadingContent={<Icons.IconTriangleExclamation />}>
                        미커버
                      </ContentBadge>
                    ) : (
                      <VerdictBadge verdict={r.status} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </TabBody>
  );
}
