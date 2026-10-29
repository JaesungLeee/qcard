// 판정 추적 뷰 (F-RP-02, 근거 띠는 EvidenceBand) + 자동 확정 조건 (F-RP-03) + 사람 확정 (F-RP-04) + 수동 결과 입력 (F-RP-05)
import {
  PLATFORM_LABEL,
  POINT_METHOD_LABEL,
  POINT_RESULT_LABEL,
  PRIORITY_LABEL,
  TEST_TYPE_LABEL,
  isRunStale,
  type CaseResult,
  type PointResult,
  type TestCase,
} from '@qcard/shared';
import {
  Button,
  ContentBadge,
  Icons,
  SectionMessage,
  SegmentedControl,
  SegmentedControlItem,
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
import { useNavigate, useParams } from 'react-router';
import type { CycleDetail } from '../../data/api';
import { useCycle } from '../../data/hooks';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime, fmtNumber } from '../../components/format';
import { MockScreen } from '../../mock/MockScreen';
import { AttachmentList } from './Attachments';
import { ConfirmPanel } from './ConfirmPanel';
import { DefectPanel } from './DefectPanel';
import { EvidenceBand } from './EvidenceBand';
import { autoConfirmChecks, cellRun, decidedByLabel, isAutoPassReversal, neighbors, resultKey, shortId } from './model';
import { Card, KV, Mono, RunState, traceUrl, useNow } from './parts';
import './qa-sheet.css';

export function TracePage() {
  const { projectId = '', cycleId = '' } = useParams();
  const cycle = useCycle(projectId, cycleId);
  return (
    <div className="qc-page">
      <QueryState query={cycle}>{(d) => <Trace d={d} />}</QueryState>
    </div>
  );
}

function Trace({ d }: { d: CycleDetail }) {
  const { projectId = '', tcId = '', deviceId = '' } = useParams();
  const navigate = useNavigate();
  const tc = d.cases.find((c) => c.tcId === tcId);
  const device = d.cycle.targets.find((t) => t.id === deviceId);
  const r = d.results.find((x) => x.tcId === tcId && x.deviceId === deviceId);
  const sheetUrl = `/p/${projectId}/cycles/${d.cycle.id}?tab=cases`;
  const crumbs = [
    { label: '테스트 사이클', to: `/p/${projectId}/cycles` },
    { label: d.cycle.name, to: sheetUrl },
    { label: tcId },
  ];

  if (!tc || !device || !r)
    return (
      <>
        <PageHeader crumbs={crumbs} title="판정 추적" />
        <SectionMessage variant="negative" description={`${tcId} × ${deviceId} 결과가 이 사이클에 없습니다.`}>
          결과를 찾을 수 없습니다
        </SectionMessage>
      </>
    );

  const { prev, next, index } = neighbors(d.cases, tcId);
  const go = (t: string, dev: string) => navigate(traceUrl(projectId, d.cycle.id, t, dev));
  const manual = tc.mode === 'manual';
  const now = useNow();
  const running = cellRun(d.runs, deviceId, tcId, now);
  const notRun = r.verdict === 'nt';
  // 자동 실행 기록이 있으면 근거 띠, 없으면(미수행·수동 입력) 요약 카드
  const band = !notRun && r.steps.length > 0;

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={tc.title}
        meta={
          <span className="qs-row" style={{ columnGap: token('space-12'), rowGap: token('space-4') }}>
            <Mono className={textClass('label1', 'medium')}>{tc.tcId}</Mono>
            <Mono>{shortId(tc.sourceId)}</Mono>
            <span>{device.label}</span>
            <span>
              케이스 {index + 1} / {d.cases.length}
            </span>
          </span>
        }
        actions={
          <>
            <div style={{ width: 120 * d.cycle.targets.length, maxWidth: '100%' }}>
              <SegmentedControl size="small" value={deviceId} onValueChange={(v) => go(tcId, v)} name="device">
                {d.cycle.targets.map((t) => (
                  <SegmentedControlItem key={t.id} value={t.id}>
                    {t.model}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={!prev}
              leadingContent={<Icons.IconChevronLeftSmall />}
              onClick={() => prev && go(prev.tcId, deviceId)}
            >
              이전 케이스
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={!next}
              trailingContent={<Icons.IconChevronRightSmall />}
              onClick={() => next && go(next.tcId, deviceId)}
            >
              다음 케이스
            </Button>
          </>
        }
      />

      {band ? (
        <EvidenceBand key={resultKey(r.tcId, r.deviceId)} r={r} manual={manual} />
      ) : (
        <div className="qc-card qs-stack" style={{ gap: token('space-12') }}>
          <div className="qs-card-head" style={{ alignItems: 'center' }}>
            <div className="qs-row" style={{ gap: token('space-12') }}>
              <span style={{ transform: 'scale(1.15)', transformOrigin: 'left center' }}>
                <VerdictBadge verdict={r.verdict} />
              </span>
              {isAutoPassReversal(r) && (
                <ContentBadge color="neutral" size="small" variant="outlined">
                  자동 Pass 반전
                </ContentBadge>
              )}
              {r.autoConfirmed && (
                <ContentBadge color="neutral" size="small" variant="outlined" leadingContent={<Icons.IconCheck />}>
                  자동 확정
                </ContentBadge>
              )}
              <ContentBadge color="neutral" size="small" variant="outlined">
                {manual ? 'Manual' : 'Auto'}
              </ContentBadge>
            </div>
          </div>
          {!notRun && (
            <KV
              items={[
                ['판정 주체', decidedByLabel(r)],
                [
                  'Agent 판정',
                  manual ? '— (수동 케이스)' : r.agentVerdict ? <VerdictBadge verdict={r.agentVerdict} /> : '—',
                ],
                [
                  '시도',
                  r.attempts > 0 ? `${r.attempts}회${r.attempts > 1 ? ` (재시도 ${r.attempts - 1}회)` : ''}` : '—',
                ],
                ['수행', r.executedAt ? `${fmtDateTime(r.executedAt)} · ${r.executor ?? ''}` : '—'],
                ['OS 빌드', r.osBuild ? <Mono>{r.osBuild}</Mono> : '—'],
                ['결함', r.defectId ? <Mono>{r.defectId}</Mono> : '—'],
                ...(r.tokens
                  ? ([['토큰 · 환산 비용', `${fmtNumber(r.tokens)} · $${r.costUsd?.toFixed(3) ?? '0'}`]] as [
                      string,
                      string,
                    ][])
                  : []),
              ]}
            />
          )}
          {notRun && (
            <span className={`${textClass('label1')} qs-muted`}>
              {manual ? '수동 케이스 — 아직 결과를 입력하지 않았습니다.' : '아직 수행하지 않은 칸입니다.'}
            </span>
          )}
          {r.blockedReason && (
            <SectionMessage variant="negative" description={r.blockedReason}>
              Blocked 사유
            </SectionMessage>
          )}
          {r.actualSummary && (
            <SectionMessage variant={r.verdict === 'fail' ? 'negative' : 'info'} description={r.actualSummary}>
              실제 결과
            </SectionMessage>
          )}
          {r.note && (
            <span className={`${textClass('label1')} qs-muted`}>
              <span className="qs-faint">비고 </span>
              {r.note}
            </span>
          )}
        </div>
      )}

      <div className="qs-trace">
        <div className="qs-stack">
          <CaseCard tc={tc} />
          {r.attachments?.length ? (
            <Card title="첨부 스크린샷">
              <AttachmentList shots={r.attachments} />
            </Card>
          ) : null}
          {notRun && !manual ? (
            <div className="qc-card qs-empty">
              <Icons.IconClock aria-hidden />
              <span className={textClass('headline2', 'bold')}>아직 수행하지 않았습니다</span>
              <span className={`${textClass('label1')} qs-muted`}>
                {running ? (
                  <span className="qs-row" style={{ gap: token('space-6'), justifyContent: 'center' }}>
                    <RunState
                      paused={running.status === 'paused'}
                      reason={running.pauseReason}
                      stale={isRunStale(running, now)}
                      waiting={running.waiting?.level}
                    />
                    {/* 일시정지된 Run은 칸을 놓는다 — 이어서 실행하기 전에 다른 Run이 가져갈 수 있다 (F-CY-06) */}
                    {running.status === 'paused'
                      ? `${running.executor}의 Run이 이 칸에서 멈췄습니다.`
                      : `${running.executor}의 Run이 이 칸을 잡고 있습니다.`}
                  </span>
                ) : (
                  `${device.label}의 남은 칸입니다. Run이 이 케이스를 실행하면 스텝 타임라인과 검증 결과가 여기에 쌓입니다.`
                )}
              </span>
            </div>
          ) : notRun && manual ? (
            <SectionMessage
              variant="info"
              description="실행자가 디바이스에서 직접 수행한 뒤 수동 결과 입력 패널에 판정과 실제 결과를 입력합니다."
            >
              수동 케이스 · 아직 결과가 없습니다
            </SectionMessage>
          ) : (
            r.points.length > 0 && <PointsCard points={r.points} />
          )}
        </div>

        <aside className="qs-trace-side" aria-label="판정">
          <ConfirmPanel key={resultKey(r.tcId, r.deviceId)} cycleId={d.cycle.id} result={r} manual={manual} />
          <DefectPanel key={`defect-${resultKey(r.tcId, r.deviceId)}`} d={d} r={r} tc={tc} projectId={projectId} />
          {!manual && !notRun && <ConditionsCard r={r} />}
          <HistoryCard r={r} manual={manual} />
        </aside>
      </div>
    </>
  );
}

function CaseCard({ tc }: { tc: TestCase }) {
  return (
    <Card
      title="케이스"
      actions={
        <span className="qs-row" style={{ gap: token('space-4') }}>
          <ContentBadge color="neutral" size="small" variant="outlined">
            {TEST_TYPE_LABEL[tc.type]}
          </ContentBadge>
          <ContentBadge color="neutral" size="small" variant="outlined">
            {PRIORITY_LABEL[tc.priority]}
          </ContentBadge>
          <ContentBadge color="neutral" size="small" variant="outlined">
            {PLATFORM_LABEL[tc.platform]}
          </ContentBadge>
        </span>
      }
    >
      <KV
        items={[
          [
            '사전 조건',
            <ul className="qs-ol" style={{ paddingLeft: token('space-16') }}>
              {tc.preconditions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {tc.cleanState && <li>클린 상태 필요</li>}
            </ul>,
          ],
          ['테스트 데이터', tc.data ?? '—'],
          [
            '테스트 절차',
            <ol className="qs-ol">
              {tc.steps.map((s, i) => (
                <li key={i}>
                  {s.text}
                  {s.manual && <span className={`${textClass('caption1', 'medium')} qs-muted`}> · 수동 스텝</span>}
                </li>
              ))}
            </ol>,
          ],
          [
            '기대 결과',
            <ul className="qs-ol" style={{ paddingLeft: token('space-16') }}>
              {tc.verificationPoints.map((v) => (
                <li key={v.id}>
                  {v.expected}{' '}
                  <span className={`${textClass('caption1')} qs-faint`}>({POINT_METHOD_LABEL[v.method]})</span>
                </li>
              ))}
            </ul>,
          ],
          ['요구사항', <Mono>{tc.requirementIds.map(shortId).join(', ')}</Mono>],
          ['기능 / 세부 기능', `${tc.feature} / ${tc.subFeature}`],
        ]}
      />
    </Card>
  );
}

const RESULT_TONE: Record<PointResult['result'], 'pass' | 'fail' | 'check'> = {
  match: 'pass',
  mismatch: 'fail',
  unknown: 'check',
};

function PointsCard({ points }: { points: PointResult[] }) {
  return (
    <Card title="검증 포인트">
      <div className="qs-scroll-x">
        <Table sx={{ minWidth: 920 }}>
          <TableHead>
            <TableRow>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>기대</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>방식</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>대상 요소</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>관찰값</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>결과</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>증거</TableHeadCell>
              <TableHeadCell sx={{ whiteSpace: 'nowrap' }}>판정 이유</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.pointId}>
                <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>{p.expected}</TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {POINT_METHOD_LABEL[p.method]}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', minWidth: 150, maxWidth: 200, wordBreak: 'break-all' }}>
                  {p.targetElement ? (
                    <Mono className={textClass('caption1')}>{p.targetElement}</Mono>
                  ) : (
                    <span className="qs-faint">{p.method === 'vision' ? '— (비전)' : '—'}</span>
                  )}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', minWidth: 160 }}>{p.observed}</TableCell>
                <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <span
                    className={textClass('caption1', 'medium')}
                    style={{
                      display: 'inline-flex',
                      padding: `${token('space-2')} ${token('space-6')}`,
                      borderRadius: token('radius-4'),
                      color: token(`qcard-verdict-${RESULT_TONE[p.result]}-fg`),
                      background: token(`qcard-verdict-${RESULT_TONE[p.result]}-bg`),
                    }}
                  >
                    {POINT_RESULT_LABEL[p.result]}
                  </span>
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <MockScreen screenshot={p.evidence} width={56} label={`${p.pointId} 증거 스크린샷`} />
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', minWidth: 220 }}>
                  <span className={textClass('label2')}>{p.reason}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function ConditionsCard({ r }: { r: CaseResult }) {
  const checks = autoConfirmChecks(r);
  const allMet = checks.every((c) => c.met);
  return (
    <Card title="자동 확정 조건">
      <span className={`${textClass('label2')} qs-muted`}>
        {allMet
          ? r.agentVerdict === 'pass'
            ? '모두 충족 — Agent Pass를 자동 확정했습니다.'
            : '모두 충족했지만 Pass가 아니어서 사람이 확정합니다.'
          : `미충족 ${checks.filter((c) => !c.met).length}건 — 사람이 확정해야 합니다.`}
      </span>
      <ul className="qs-checks">
        {checks.map((c) => (
          <li key={c.condition} className={textClass('label1')}>
            {c.met ? (
              <Icons.IconCircleCheckFill className="qs-ok" aria-label="충족" />
            ) : (
              <Icons.IconCircleCloseFill className="qs-no" aria-label="미충족" />
            )}
            <span style={{ color: c.met ? undefined : token('foreground-neutral-primary') }}>
              {c.label}
              <span className={`${textClass('caption1', 'medium')} ${c.met ? 'qs-faint' : 'qs-muted'}`}>
                {' '}
                {c.met ? '충족' : '미충족'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HistoryCard({ r, manual }: { r: CaseResult; manual: boolean }) {
  const items = [...r.history].reverse();
  const previous = [...(r.previousAttempts ?? [])].reverse();
  return (
    <Card title="판정 변경 이력">
      {items.length === 0 && !(r.agentVerdict && r.executedAt) && previous.length === 0 ? (
        <span className={`${textClass('label1')} qs-muted`}>변경 이력이 없습니다</span>
      ) : (
        <ol className="qs-history">
          {items.map((h, i) => (
            <li key={i}>
              <span className="qs-row" style={{ gap: token('space-4') }}>
                <VerdictBadge verdict={h.from} />
                <Icons.IconArrowRight aria-label="에서" />
                <VerdictBadge verdict={h.to} />
              </span>
              <span className={`${textClass('caption1')} qs-muted`}>
                {fmtDateTime(h.at)} · {h.by}
                {h.attachments ? ` · 스크린샷 ${h.attachments}장` : ''}
              </span>
              {h.note && <span className={textClass('label2')}>{h.note}</span>}
            </li>
          ))}
          {!manual && r.agentVerdict && r.executedAt && (
            <li>
              <span className="qs-row" style={{ gap: token('space-4') }}>
                <span className={textClass('label2', 'medium')}>Agent 판정</span>
                <VerdictBadge verdict={r.agentVerdict} />
              </span>
              <span className={`${textClass('caption1')} qs-muted`}>
                {fmtDateTime(r.executedAt)} · {r.executor} 실행
              </span>
            </li>
          )}
          {/* 다시 실행해 밀려난 시도 (F-CY-04). 최신 시도가 최종 판정이다 */}
          {previous.map((a) => (
            <li key={`attempt-${a.attempt}`}>
              <span className="qs-row" style={{ gap: token('space-4') }}>
                <span className={textClass('label2', 'medium')}>이전 시도 {a.attempt}</span>
                <VerdictBadge verdict={a.verdict} />
              </span>
              <span className={`${textClass('caption1')} qs-muted`}>
                {a.executedAt ? fmtDateTime(a.executedAt) : '—'} · {a.executor ?? '—'} 실행
              </span>
              {(a.actualSummary ?? a.blockedReason) && (
                <span className={textClass('label2')}>{a.actualSummary ?? a.blockedReason}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <span className={`${textClass('caption1')} qs-faint`}>이력은 변경할 수 없는 로그로 보관됩니다.</span>
    </Card>
  );
}
