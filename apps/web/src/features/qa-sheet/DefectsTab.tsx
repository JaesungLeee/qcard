// ③ 결함 목록 (PRD §5.10). Admin·QA는 심각도·상태를 그 자리에서 바꾼다 (F-RP-19). 결함은 판정 추적 뷰의 Fail 칸에서 등록한다
import { SEVERITY_LABEL, Severity, type Defect } from '@qcard/shared';
import {
  ContentBadge,
  Option,
  Select,
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
import { useMyRole, useUpdateDefect } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';
import { resultKey } from './model';
import { Mono, OsBuild, TabBody, traceUrl } from './parts';
import type { SheetProps } from './QaSheetPage';
import { DEFECT_STATUS_LABEL } from './SummaryTab';

const STATUSES: Defect['status'][] = ['open', 'fixed', 'closed'];

export function DefectsTab({ d, index, projectId }: SheetProps) {
  const role = useMyRole(projectId);
  const canEdit = role.data === 'admin' || role.data === 'qa';
  const update = useUpdateDefect({ projectId, cycleId: d.cycle.id });
  const change = (df: Defect, patch: Partial<Pick<Defect, 'severity' | 'status'>>) =>
    update.mutate({ defectId: df.id, patch });
  if (d.defects.length === 0)
    return (
      <TabBody>
        <div className="qc-card qs-empty">
          <span className={textClass('headline2', 'bold')}>결함이 없습니다</span>
          <span className={`${textClass('label1')} qs-muted`}>
            판정 추적 뷰의 Fail 칸에서 결함을 등록하면 여기에 모입니다.
          </span>
        </div>
      </TabBody>
    );
  return (
    <TabBody>
      <ErrorMessage error={update.error} title="결함을 바꾸지 못했습니다" />
      <div className="qc-card" style={{ padding: 0 }}>
        <div className="qs-scroll-x">
          <Table sx={{ minWidth: 1200 }}>
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
                <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>등록</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.defects.map((df) => {
                const device = d.cycle.targets.find((t) => t.id === df.deviceId);
                const r = index.get(resultKey(df.tcId, df.deviceId));
                const osBuild = df.osBuild ?? r?.osBuild;
                return (
                  <TableRow key={df.id}>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <Mono className={textClass('label1', 'bold')}>{df.id}</Mono>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', minWidth: 200 }}>{df.title}</TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {canEdit ? (
                        <Select
                          aria-label={`${df.id} 심각도`}
                          value={df.severity}
                          onChange={(v) => change(df, { severity: v as Severity })}
                        >
                          {Severity.options.map((s) => (
                            <Option key={s} value={s}>
                              {SEVERITY_LABEL[s]}
                            </Option>
                          ))}
                        </Select>
                      ) : (
                        <ContentBadge
                          color="neutral"
                          size="small"
                          variant={df.severity === 'critical' || df.severity === 'major' ? 'solid' : 'outlined'}
                        >
                          {SEVERITY_LABEL[df.severity]}
                        </ContentBadge>
                      )}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span className="qs-stack" style={{ gap: token('space-4') }}>
                        <Link to={traceUrl(projectId, d.cycle.id, df.tcId, df.deviceId)} className="qs-link">
                          <Mono>{df.tcId}</Mono>
                        </Link>
                        {r && <VerdictBadge verdict={r.verdict} />}
                      </span>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top' }}>
                      <span className="qs-stack" style={{ gap: token('space-2') }}>
                        <span style={{ whiteSpace: 'nowrap' }}>{device?.label ?? df.deviceId}</span>
                        {osBuild && (
                          <span className={`${textClass('caption1')} qs-muted`}>
                            <OsBuild value={osBuild} />
                          </span>
                        )}
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
                      {canEdit ? (
                        <Select
                          aria-label={`${df.id} 상태`}
                          value={df.status}
                          onChange={(v) => change(df, { status: v as Defect['status'] })}
                        >
                          {STATUSES.map((s) => (
                            <Option key={s} value={s}>
                              {DEFECT_STATUS_LABEL[s]}
                            </Option>
                          ))}
                        </Select>
                      ) : (
                        <ContentBadge color="neutral" size="small" variant="outlined">
                          {DEFECT_STATUS_LABEL[df.status]}
                        </ContentBadge>
                      )}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {df.createdBy ? (
                        <span className="qs-stack" style={{ gap: token('space-2') }}>
                          <span>{df.createdBy}</span>
                          {df.createdAt && (
                            <span className={`${textClass('caption1')} qs-muted`}>{fmtDateTime(df.createdAt)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="qs-faint">—</span>
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
