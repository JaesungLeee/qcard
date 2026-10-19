// ③ 결함 목록 (PRD §5.10)
import { SEVERITY_LABEL } from '@qcard/shared';
import {
  ContentBadge,
  Icons,
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
import { resultKey } from './model';
import { Mono, TabBody, traceUrl } from './parts';
import type { SheetProps } from './QaSheetPage';
import { DEFECT_STATUS_LABEL } from './SummaryTab';

export function DefectsTab({ d, index, projectId }: SheetProps) {
  if (d.defects.length === 0)
    return (
      <TabBody>
        <div className="qc-card qs-empty">
          <span className={textClass('headline2', 'bold')}>결함이 없습니다</span>
          <span className={`${textClass('label1')} qs-muted`}>
            Fail로 확정한 결과에 결함을 연결하면 여기에 모입니다.
          </span>
        </div>
      </TabBody>
    );
  return (
    <TabBody>
      <div className="qc-card" style={{ padding: 0 }}>
        <div className="qs-scroll-x">
          <Table sx={{ minWidth: 1180 }}>
            <TableHead>
              <TableRow>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>결함 ID</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>제목</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>심각도</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>관련 TC</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>디바이스 / OS</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>재현 절차</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>기대 / 실제 결과</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>상태</TableHeadCell>
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>트래커</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.defects.map((df) => {
                const device = d.cycle.targets.find((t) => t.id === df.deviceId);
                const r = index.get(resultKey(df.tcId, df.deviceId));
                return (
                  <TableRow key={df.id}>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <Mono className={textClass('label1', 'bold')}>{df.id}</Mono>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', minWidth: 200 }}>{df.title}</TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <ContentBadge color="neutral"
                        size="small"
                        variant={df.severity === 'critical' || df.severity === 'major' ? 'solid' : 'outlined'}
                      >
                        {SEVERITY_LABEL[df.severity]}
                      </ContentBadge>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span className="qs-stack" style={{ gap: token('space-4') }}>
                        <Link to={traceUrl(projectId, d.cycle.id, df.tcId, df.deviceId)} className="qs-link">
                          <Mono>{df.tcId}</Mono>
                        </Link>
                        {r && <VerdictBadge verdict={r.verdict} />}
                      </span>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span className="qs-stack" style={{ gap: token('space-2') }}>
                        <span style={{ whiteSpace: 'nowrap' }}>{device?.label ?? df.deviceId}</span>
                        {r?.osBuild && <span className={`${textClass('caption1')} qs-muted qc-mono`}>{r.osBuild}</span>}
                      </span>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', minWidth: 220 }}>
                      <ol className="qs-ol">
                        {df.repro.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', minWidth: 240 }}>
                      <span className="qs-stack" style={{ gap: token('space-4') }}>
                        <span>
                          <span className="qs-faint">기대 </span>
                          {df.expected}
                        </span>
                        <span>
                          <span className="qs-faint">실제 </span>
                          {df.actual}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <ContentBadge color="neutral" size="small" variant="outlined">
                        {DEFECT_STATUS_LABEL[df.status]}
                      </ContentBadge>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {df.trackerUrl ? (
                        <a
                          href={df.trackerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="qs-link qs-row"
                          style={{ gap: token('space-2') }}
                        >
                          {df.trackerUrl.match(/issues\/(\d+)/)?.[1]
                            ? `#${df.trackerUrl.match(/issues\/(\d+)/)![1]}`
                            : '열기'}
                          <Icons.IconExternalLink aria-label="새 창" />
                        </a>
                      ) : (
                        <span className="qs-faint">미발행</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </TabBody>
  );
}
