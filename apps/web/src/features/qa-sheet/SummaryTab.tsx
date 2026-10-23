// ① 요약 (PRD §5.10, F-RP-01) + 진행 매트릭스 (F-CY-05)
import { PAUSE_REASON_LABEL, SEVERITY_LABEL, VERDICT_LABEL, type Defect, type Severity } from '@qcard/shared';
import {
  ContentBadge,
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
import { useMemo } from 'react';
import { Link } from 'react-router';
import { fmtDate, fmtPercent } from '../../components/format';
import { deviceStats, oneLineSummary, progressMatrix, resultKey, type MatrixRow } from './model';
import {
  Card,
  KV,
  Mono,
  RunState,
  SERVER_ENV_LABEL,
  Stat,
  TabBody,
  VerdictBar,
  periodLabel,
  traceUrl,
  useNow,
} from './parts';
import type { SheetProps } from './QaSheetPage';

const SEVERITY_RANK: Severity[] = ['critical', 'major', 'minor', 'trivial'];
export const DEFECT_STATUS_LABEL: Record<Defect['status'], string> = { open: '열림', fixed: '수정됨', closed: '닫힘' };

export function SummaryTab({ d, index, projectId, projectName }: SheetProps) {
  const { overall, perDevice } = useMemo(() => deviceStats(d.cycle.targets, d.results), [d]);
  const now = useNow();
  const matrix = useMemo(() => progressMatrix(d.cases, d.cycle.targets, index, d.runs, now), [d, index, now]);
  const caseOf = (tcId: string) => d.cases.find((c) => c.tcId === tcId);
  const deviceOf = (id: string) => d.cycle.targets.find((t) => t.id === id);
  const issues = d.results
    .filter((r) => r.verdict === 'fail' || r.verdict === 'blocked' || r.verdict === 'check')
    .sort((a, b) => ['fail', 'check', 'blocked'].indexOf(a.verdict) - ['fail', 'check', 'blocked'].indexOf(b.verdict));
  const checks = issues.filter((r) => r.verdict === 'check');
  const defects = [...d.defects].sort((a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity));

  return (
    <TabBody>
      {checks.length > 0 && (
        <SectionMessage
          variant="cautionary"
          description={`사람이 확정하기 전까지 통과율에 Pass로 잡히지 않습니다. ${d.cycle.period.end ? '사이클이 완료됐지만' : '사이클을 완료하기 전에'} 판정 추적 뷰에서 확정하세요.`}
        >
          확인필요 {checks.length}칸이 남아 있습니다
        </SectionMessage>
      )}

      <div className="qs-summary-grid qs-summary-top">
        <Card title="사이클 정보">
          <KV
            items={[
              ['프로젝트', projectName],
              ['QA 문서 버전', `v${d.doc.appVersion}`],
              ['대상 빌드', `${d.build.version} (빌드 ${d.build.buildNumber})`],
              ['테스트 기간', periodLabel(d.cycle.period)],
              ['서버 환경', SERVER_ENV_LABEL[d.cycle.serverEnv]],
              ['케이스', `${d.cases.length}건 × 디바이스 ${d.cycle.targets.length}대`],
              [
                '대상 디바이스',
                <span className="qs-stack" style={{ gap: token('space-2') }}>
                  {d.cycle.targets.map((t) => (
                    <span key={t.id}>{t.label}</span>
                  ))}
                </span>,
              ],
            ]}
          />
        </Card>

        <Card title="판정 · 통과율">
          <div className="qs-stat-row">
            <Stat
              label="통과율"
              value={fmtPercent(overall.passRate)}
              sub={`Pass ${overall.counts.pass} / 수행 ${overall.done}칸`}
            />
            <Stat
              label="진행"
              value={`${overall.done}/${overall.total}`}
              sub={`${fmtPercent(overall.total ? overall.done / overall.total : 0)} 완료`}
            />
            <Stat label="Fail" value={overall.counts.fail} sub={`결함 ${d.defects.length}건`} />
            <Stat label="확인필요" value={overall.counts.check} sub={`Blocked ${overall.counts.blocked}`} />
          </div>
          <div className="qs-scroll-x">
            <Table sx={{ minWidth: 520 }}>
              <TableHead>
                <TableRow>
                  <TableHeadCell>디바이스</TableHeadCell>
                  {(['pass', 'fail', 'blocked', 'check', 'nt'] as const).map((v) => (
                    <TableHeadCell key={v} sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {VERDICT_LABEL[v]}
                    </TableHeadCell>
                  ))}
                  <TableHeadCell sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>통과율</TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...perDevice, overall].map((s) => (
                  <TableRow key={s.device.id}>
                    <TableCell>
                      <span className={s.device.id === 'all' ? textClass('label1', 'bold') : undefined}>
                        {s.device.label}
                      </span>
                    </TableCell>
                    {(['pass', 'fail', 'blocked', 'check', 'nt'] as const).map((v) => (
                      <TableCell key={v} sx={{ textAlign: 'right' }}>
                        <span className="qs-big">{s.counts[v]}</span>
                      </TableCell>
                    ))}
                    <TableCell sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <b className="qs-big">{fmtPercent(s.passRate)}</b>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card title="진행 매트릭스" className="qs-span-2" actions={<MatrixLegend />}>
          {matrix.map((row) => (
            <MatrixLine key={row.device.id} row={row} projectId={projectId} cycleId={d.cycle.id} caseOf={caseOf} />
          ))}
        </Card>

        <Card title="주요 결함" actions={<span className={`${textClass('label2')} qs-muted`}>{defects.length}건</span>}>
          {defects.length === 0 ? (
            <span className={`${textClass('label1')} qs-muted`}>발견된 결함이 없습니다</span>
          ) : (
            <ul className="qs-list">
              {defects.map((df) => (
                <li key={df.id}>
                  <Mono className={textClass('label2', 'bold')}>{df.id}</Mono>
                  <div className="qs-stack" style={{ gap: token('space-2'), flex: 1 }}>
                    <span className={`${textClass('label1', 'medium')} qs-ellipsis`}>{df.title}</span>
                    <span className={`${textClass('caption1')} qs-muted`}>
                      {SEVERITY_LABEL[df.severity]} · {deviceOf(df.deviceId)?.model} · <Mono>{df.tcId}</Mono>
                    </span>
                  </div>
                  <ContentBadge color="neutral" size="small" variant="outlined">
                    {DEFECT_STATUS_LABEL[df.status]}
                  </ContentBadge>
                </li>
              ))}
            </ul>
          )}
          <span className={`${textClass('caption1')} qs-faint`}>빌드 업로드 {fmtDate(d.build.uploadedAt)}</span>
        </Card>
        <Card
          title="Fail · 확인필요 · Blocked"
          actions={<span className={`${textClass('label2')} qs-muted`}>{issues.length}칸</span>}
        >
          {issues.length === 0 ? (
            <span className={`${textClass('label1')} qs-muted`}>없음</span>
          ) : (
            <ul className="qs-list">
              {issues.map((r) => {
                const tc = caseOf(r.tcId);
                return (
                  <li key={resultKey(r.tcId, r.deviceId)}>
                    <VerdictBadge verdict={r.verdict} />
                    <div className="qs-stack" style={{ gap: token('space-2'), flex: 1 }}>
                      <Link
                        to={traceUrl(projectId, d.cycle.id, r.tcId, r.deviceId)}
                        className={`qs-link ${textClass('label1', 'medium')} qs-ellipsis`}
                      >
                        <Mono>{r.tcId}</Mono> {tc?.title}
                      </Link>
                      <span className={`${textClass('caption1')} qs-muted qs-ellipsis`}>
                        {deviceOf(r.deviceId)?.label}
                        {oneLineSummary(r) ? ` · ${oneLineSummary(r)}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </TabBody>
  );
}

function MatrixLegend() {
  return (
    <div className={`qs-legend ${textClass('caption1')} qs-muted`} aria-label="범례">
      <span>
        <span className="qs-cell" data-v="pass">
          P
        </span>
        완료(판정 머리글자)
      </span>
      <span>
        <span className="qs-cell" data-state="running" data-v="nt">
          ▶
        </span>
        실행 중
      </span>
      <span>
        <span className="qs-cell" data-v="nt" />
        남은 칸
      </span>
    </div>
  );
}

const SHORT = { pass: 'P', fail: 'F', blocked: 'B', check: '?', nt: '', na: '–' } as const;

function MatrixLine({
  row,
  projectId,
  cycleId,
  caseOf,
}: {
  row: MatrixRow;
  projectId: string;
  cycleId: string;
  caseOf: (id: string) => { title: string; sourceId: string } | undefined;
}) {
  const total = row.cells.length;
  const running = row.cells.find((c) => c.state === 'running');
  return (
    <div className="qs-matrix-row">
      <div className="qs-stack" style={{ gap: token('space-2') }}>
        <span className={textClass('label1', 'bold')}>{row.device.label}</span>
        <span className={`${textClass('caption1')} qs-muted qs-big`}>
          완료 {row.done} · 실행 중 {row.running} · 남음 {row.remaining} / {total}
        </span>
        {running && (
          <span className={`qs-row ${textClass('caption1')}`} style={{ gap: token('space-4') }}>
            <RunState paused={Boolean(running.paused)} reason={running.pauseReason} stale={running.stale} />
            <span className="qs-muted">{running.executor}</span>
          </span>
        )}
      </div>
      <div className="qs-stack" style={{ gap: token('space-6') }}>
        <VerdictBar
          counts={row.cells.reduce((acc, c) => ({ ...acc, [c.verdict]: acc[c.verdict] + 1 }), {
            pass: 0,
            fail: 0,
            blocked: 0,
            check: 0,
            nt: 0,
            na: 0,
          })}
          total={total}
          label={row.device.label}
        />
        <div className="qs-cells" role="list" aria-label={`${row.device.label} 칸`}>
          {row.cells.map((c) => {
            const tc = caseOf(c.tcId);
            const label =
              c.state === 'running'
                ? `${c.tcId} ${tc?.title ?? ''} — ${c.paused ? `일시정지${c.pauseReason ? `(${PAUSE_REASON_LABEL[c.pauseReason]})` : ''}` : '실행 중'} (${c.executor})`
                : `${c.tcId} ${tc?.title ?? ''} — ${c.state === 'remaining' ? '남은 칸' : VERDICT_LABEL[c.verdict]}`;
            return (
              <Link
                key={c.tcId}
                role="listitem"
                to={traceUrl(projectId, cycleId, c.tcId, row.device.id)}
                className="qs-cell"
                data-v={c.verdict}
                data-state={c.state}
                title={label}
                aria-label={label}
              >
                {c.state === 'running' ? '▶' : SHORT[c.verdict]}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
