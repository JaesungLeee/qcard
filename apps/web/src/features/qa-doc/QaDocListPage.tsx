import { CHANGE_LABEL, type CaseChange } from '@qcard/shared';
import {
  Button,
  Icons,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  textClass,
  token,
} from '@qcard/ui';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime } from '../../components/format';
import type { QaDocSummary } from '../../data/api';
import { useQaDocs } from '../../data/hooks';
import { Progress, Tag } from './Badges';
import './qa-doc.css';

const CHANGES: CaseChange[] = ['new', 'changed', 'removed', 'same'];

/** QA 문서 목록 (PRD §5.2): 앱 버전마다 하나씩. */
export function QaDocListPage() {
  const { projectId = '' } = useParams();
  const docs = useQaDocs(projectId);
  return (
    <div className="qc-page">
      <PageHeader
        title="QA 문서"
        meta="앱 버전마다 스펙 묶음에서 QA 문서를 하나 만듭니다. 승인된 케이스만 테스트 사이클에서 실행됩니다."
        actions={
          <div className="qd-stack" style={{ gap: token('space-4'), alignItems: 'flex-end' }}>
            <Button variant="solid" color="primary" leadingContent={<Icons.IconUpload />} disabled>
              스펙 업로드 · QA 문서 생성
            </Button>
            <span className={textClass('caption1')} style={{ color: token('foreground-neutral-tertiary') }}>
              서버 연결 후 사용할 수 있습니다
            </span>
          </div>
        }
      />
      <QueryState query={docs}>
        {(list) => {
          const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          return sorted.length === 0 ? (
            <div className="qc-card qd-muted">아직 QA 문서가 없습니다. 스펙을 업로드해 첫 QA 문서를 만드세요.</div>
          ) : (
            <DocTable docs={sorted} projectId={projectId} />
          );
        }}
      </QueryState>
    </div>
  );
}

function DocTable({ docs, projectId }: { docs: QaDocSummary[]; projectId: string }) {
  return (
    <div className="qd-table-wrap">
      <Table sx={{ minWidth: 880 }}>
        <TableHead>
          <TableRow>
            <TableHeadCell>앱 버전</TableHeadCell>
            <TableHeadCell>이전 버전</TableHeadCell>
            <TableHeadCell>생성</TableHeadCell>
            <TableHeadCell>케이스</TableHeadCell>
            <TableHeadCell>이전 버전 대비</TableHeadCell>
            <TableHeadCell>승인</TableHeadCell>
            <TableHeadCell>확인 질문</TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {docs.map((d, i) => (
            <TableRow key={d.id}>
              <TableCell>
                <span className="qd-row" style={{ flexWrap: 'nowrap' }}>
                  <Link
                    to={`/p/${projectId}/docs/${d.id}`}
                    className={`${textClass('label1', 'bold')} qd-link`}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    QA 문서 {d.appVersion}
                  </Link>
                  {i === 0 && <Tag tone="brand">최신</Tag>}
                </span>
              </TableCell>
              <TableCell>
                <span className={d.prevAppVersion ? undefined : 'qd-faint'}>{d.prevAppVersion ?? '최초 버전'}</span>
              </TableCell>
              <TableCell>
                <span className="qd-num" style={{ whiteSpace: 'nowrap' }}>
                  {fmtDateTime(d.createdAt)}
                </span>
              </TableCell>
              <TableCell>
                <span className="qd-num">{d.caseCount}</span>
              </TableCell>
              <TableCell>
                {d.prevAppVersion ? (
                  <span className={`${textClass('label2')} qd-row`} style={{ gap: token('space-12') }}>
                    {CHANGES.map((k) => (
                      <span key={k} style={{ whiteSpace: 'nowrap' }}>
                        <span className="qd-faint">{CHANGE_LABEL[k]}</span>{' '}
                        <span className="qd-num" style={{ fontWeight: d.changeCounts[k] && k !== 'same' ? 600 : 400 }}>
                          {d.changeCounts[k]}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="qd-faint">—</span>
                )}
              </TableCell>
              <TableCell>
                <Progress value={d.approvalCounts.approved} total={d.caseCount} />
              </TableCell>
              <TableCell>
                {d.openQuestions > 0 ? (
                  <Tag tone="check">미답변 {d.openQuestions}</Tag>
                ) : (
                  <span className="qd-faint">없음</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
