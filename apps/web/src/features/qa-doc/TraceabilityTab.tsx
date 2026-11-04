import type { QADocument } from '@qcard/shared';
import {
  SectionMessage,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  textClass,
  token,
} from '@qcard/ui';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Progress, Tag } from './Badges';
import { coverage, shortReq } from './logic';
import { RichText } from './RichText';
import { useDocHref } from './params';

/** 요구사항 ↔ 케이스 추적성 매트릭스 */
export function TraceabilityTab({ doc }: { doc: QADocument }) {
  const href = useDocHref();
  const cov = useMemo(() => coverage(doc), [doc]);
  const ratio = cov.rows.length ? cov.covered / cov.rows.length : 0;

  return (
    <div className="qd-stack">
      {cov.uncovered > 0 ? (
        <SectionMessage
          variant="cautionary"
          description={`케이스가 하나도 없는 요구사항이 ${cov.uncovered}개 있습니다. 스펙에 TS·EC를 추가해야 다음 버전에서 케이스가 만들어집니다.`}
        >
          케이스 없는 요구사항
        </SectionMessage>
      ) : (
        <SectionMessage
          variant="positive"
          description={`요구사항 ${cov.rows.length}개 모두 케이스가 1개 이상 연결되어 있습니다 (삭제 케이스 제외).`}
        >
          모든 요구사항에 케이스가 있습니다
        </SectionMessage>
      )}

      <div className="qd-row" style={{ gap: token('space-24') }}>
        <span className="qd-row">
          <span className={`${textClass('label1')} qd-muted`}>커버리지</span>
          <span className={`${textClass('headline2', 'bold')} qc-mono`}>{Math.round(ratio * 100)}%</span>
          <span className={`${textClass('label2')} qd-faint`}>
            ({cov.covered} / {cov.rows.length})
          </span>
        </span>
        {cov.uncovered > 0 && <Tag tone="fail">케이스 없음 {cov.uncovered}</Tag>}
      </div>

      <div className="qd-table-wrap">
        <Table sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>요구사항</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>내용</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>케이스</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>승인</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>연결 케이스</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>근거</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cov.rows.map((r) => (
              <TableRow key={r.requirement.id}>
                <TableCell>
                  <span className="qc-mono" style={{ whiteSpace: 'nowrap' }}>
                    {shortReq(r.requirement.id)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="qd-stack" style={{ gap: token('space-4'), minWidth: 240 }}>
                    <span>
                      <RichText text={r.requirement.text} />
                    </span>
                    {(r.openQuestions > 0 || r.suggestions > 0) && (
                      <span className="qd-row" style={{ gap: token('space-4') }}>
                        {r.openQuestions > 0 && (
                          <Link to={href({ tab: 'questions', case: null, edit: null })} className="qd-link">
                            <Tag tone="check">질문 {r.openQuestions}</Tag>
                          </Link>
                        )}
                        {r.suggestions > 0 && (
                          <Link to={href({ tab: 'suggestions', case: null, edit: null })} className="qd-link">
                            <Tag tone="violet">보강 제안 {r.suggestions}</Tag>
                          </Link>
                        )}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {r.status === 'none' ? (
                    <Tag tone="fail">없음</Tag>
                  ) : (
                    <span className="qc-mono">{r.cases.length}</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.cases.length > 0 ? (
                    <Progress value={r.approved} total={r.cases.length} />
                  ) : (
                    <span className="qd-faint">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="qd-row" style={{ gap: token('space-6'), width: 180 }}>
                    {r.cases.map((c) => (
                      <Link
                        key={c.tcId}
                        to={href({ tab: null, case: c.tcId, edit: null })}
                        className={`${textClass('label2')} qd-link qc-mono`}
                        title={c.title}
                      >
                        {c.tcId.replace(/^TC-[A-Z]+-/, '')}
                      </Link>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`${textClass('caption1')} qd-faint`} style={{ whiteSpace: 'nowrap' }}>
                    {r.requirement.sourceRef.headingPath.at(-1)} · {r.requirement.sourceRef.lineStart}줄
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
