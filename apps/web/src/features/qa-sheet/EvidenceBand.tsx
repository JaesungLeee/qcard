// 판정 추적 뷰의 근거 띠 (F-RP-02): 테스트 결과 → 검증 증거 → 테스트 동작 흐름을 한 줄로 거슬러 올라간다.
import { SCREENS } from '@qcard/fixtures';
import { POINT_RESULT_LABEL, STEP_ACTION_LABEL, type Bounds, type CaseResult, type ExecStep, type PointResult } from '@qcard/shared';
import {
  ContentBadge,
  IconButton,
  Icons,
  SegmentedControl,
  SegmentedControlItem,
  VerdictBadge,
  textClass,
  token,
} from '@qcard/ui';
import { useEffect, useRef, useState } from 'react';
import { fmtDateTime, fmtNumber, fmtTs } from '../../components/format';
import { MockScreen } from '../../mock/MockScreen';
import { autoConfirmChecks, decidedByLabel, isAutoPassReversal } from './model';
import { Mono } from './parts';
import './evidence-band.css';

/** 증거 패널이 보여줄 대상: 스텝 직전 화면 또는 검증 포인트 증거 */
type Selection = { kind: 'step'; index: number } | { kind: 'point'; id: string };

/** 근거 띠. 결과 → 증거 → 동작 흐름. 스텝·검증 근거를 누르면 증거 패널이 그 화면으로 바뀐다. */
export function EvidenceBand({ r, manual }: { r: CaseResult; manual: boolean }) {
  const steps = r.steps;
  const last = steps.at(-1)!;
  const total = last.videoTs + last.durationMs;
  const [sel, setSel] = useState<Selection>({ kind: 'step', index: last.index });
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [t, setT] = useState(last.videoTs);
  const [playing, setPlaying] = useState(false);

  // 영상 재생: 시점이 바뀌면 흐름에서 그 시점의 스텝을 따라간다.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((x) => {
        const nx = x + 100;
        if (nx >= total) {
          setPlaying(false);
          return total;
        }
        return nx;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, total]);
  const stepAtT = [...steps].reverse().find((s) => s.videoTs <= t) ?? steps[0]!;
  useEffect(() => {
    if (mode === 'video') setSel({ kind: 'step', index: stepAtT.index });
  }, [mode, stepAtT.index]);

  const selectStep = (s: ExecStep) => {
    setSel({ kind: 'step', index: s.index });
    setT(s.videoTs);
  };
  const selectPoint = (p: PointResult) => {
    setSel({ kind: 'point', id: p.pointId });
    setMode('image');
    setPlaying(false);
    setT(last.videoTs);
  };
  const activeStep = sel.kind === 'step' ? sel.index : last.index;

  return (
    <div className="et-band">
      <ResultCard r={r} manual={manual} sel={sel} onPoint={selectPoint} />
      <EvidenceCard
        r={r}
        sel={sel}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          if (m === 'image') setPlaying(false);
        }}
        onStep={selectStep}
        t={t}
        total={total}
        playing={playing}
        onPlay={() => {
          if (t >= last.videoTs) setT(0);
          setPlaying((p) => !p);
        }}
        onSeek={(v) => setT(v)}
      />
      <FlowCard r={r} active={activeStep} onStep={selectStep} />
    </div>
  );
}

const RESULT_TONE: Record<PointResult['result'], 'pass' | 'fail' | 'check'> = {
  match: 'pass',
  mismatch: 'fail',
  unknown: 'check',
};

function PointChip({ result }: { result: PointResult['result'] }) {
  const tone = RESULT_TONE[result];
  const Icon =
    result === 'match'
      ? Icons.IconCircleCheckFill
      : result === 'mismatch'
        ? Icons.IconCircleCloseFill
        : Icons.IconCircleExclamationFill;
  return (
    <span
      className={`et-chip ${textClass('caption1', 'medium')}`}
      style={{ color: token(`qcard-verdict-${tone}-fg`), background: token(`qcard-verdict-${tone}-bg`) }}
    >
      <Icon aria-hidden />
      {POINT_RESULT_LABEL[result]}
    </span>
  );
}

function ResultCard({
  r,
  manual,
  sel,
  onPoint,
}: {
  r: CaseResult;
  manual: boolean;
  sel: Selection;
  onPoint: (p: PointResult) => void;
}) {
  const unmet = autoConfirmChecks(r).filter((c) => !c.met).length;
  return (
    <section className="qc-card et-card" aria-labelledby="et-result">
      <div className="qs-card-head">
        <h2 id="et-result" className={textClass('headline2', 'bold')}>
          테스트 결과
        </h2>
        <span style={{ transform: 'scale(1.15)', transformOrigin: 'right center' }}>
          <VerdictBadge verdict={r.verdict} />
        </span>
      </div>
      <div className="qs-row" style={{ gap: token('space-4') }}>
        {isAutoPassReversal(r) && (
          <ContentBadge color="neutral" size="small" variant="outlined">
            자동 Pass 반전
          </ContentBadge>
        )}
        {r.autoConfirmed ? (
          <ContentBadge color="neutral" size="small" variant="outlined" leadingContent={<Icons.IconCheck />}>
            자동 확정
          </ContentBadge>
        ) : (
          !manual && (
            <ContentBadge color="neutral" size="small" variant="outlined">
              사람 확정{unmet > 0 ? ` · 조건 미충족 ${unmet}` : ''}
            </ContentBadge>
          )
        )}
        <ContentBadge color="neutral" size="small" variant="outlined">
          {manual ? 'Manual' : 'Auto'}
        </ContentBadge>
      </div>

      {(r.blockedReason || r.actualSummary) && (
        <div className="et-section">
          <span className={`${textClass('label2', 'medium')} qs-faint`}>
            {r.blockedReason ? 'Blocked 사유' : '실제 결과'}
          </span>
          <p className={`${textClass('body2-reading')} et-actual`} data-v={r.verdict}>
            {r.blockedReason ?? r.actualSummary}
          </p>
        </div>
      )}

      {r.points.length > 0 && (
        <div className="et-section">
          <span className={`${textClass('label2', 'medium')} qs-faint`}>검증 근거 · 누르면 증거 화면</span>
          <ul className="et-reasons">
            {r.points.map((p) => (
              <li key={p.pointId}>
                <button
                  type="button"
                  className="et-reason"
                  aria-pressed={sel.kind === 'point' && sel.id === p.pointId}
                  onClick={() => onPoint(p)}
                >
                  <span className="qs-row" style={{ gap: token('space-6') }}>
                    <PointChip result={p.result} />
                    <span className={`${textClass('label2', 'bold')}`}>{p.expected}</span>
                  </span>
                  <span className={`${textClass('label2')} qs-muted`}>{p.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.note && (
        <span className={`${textClass('label2')} qs-muted`}>
          <span className="qs-faint">비고 </span>
          {r.note}
        </span>
      )}

      <dl className="et-meta">
        <dt>판정 주체</dt>
        <dd>{decidedByLabel(r)}</dd>
        <dt>시도</dt>
        <dd>{r.attempts > 0 ? `${r.attempts}회` : '—'}</dd>
        <dt>수행</dt>
        <dd>{r.executedAt ? `${fmtDateTime(r.executedAt)} · ${r.executor ?? ''}` : '—'}</dd>
        {r.osBuild && (
          <>
            <dt>OS 빌드</dt>
            <dd>
              <Mono>{r.osBuild}</Mono>
            </dd>
          </>
        )}
        {r.defectId && (
          <>
            <dt>결함</dt>
            <dd>
              <Mono>{r.defectId}</Mono>
            </dd>
          </>
        )}
        {r.tokens && (
          <>
            <dt>토큰 · 비용</dt>
            <dd>
              {fmtNumber(r.tokens)} · ${r.costUsd?.toFixed(3) ?? '0'}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** 검증 포인트의 대상 요소(`<id> "<label>"`)를 증거 화면에서 찾아 박스로 강조한다 */
function pointBounds(p: PointResult): Bounds | undefined {
  if (p.evidence.kind !== 'mock' || !p.targetElement) return undefined;
  const id = p.targetElement.split(' ')[0];
  return SCREENS[p.evidence.screen]?.elements.find((e) => e.id === id)?.bounds;
}

const shotName = (s: ExecStep) => `${String(s.index).padStart(2, '0')}_${s.action}.png`;

function EvidenceCard({
  r,
  sel,
  mode,
  onMode,
  onStep,
  t,
  total,
  playing,
  onPlay,
  onSeek,
}: {
  r: CaseResult;
  sel: Selection;
  mode: 'image' | 'video';
  onMode: (m: 'image' | 'video') => void;
  onStep: (s: ExecStep) => void;
  t: number;
  total: number;
  playing: boolean;
  onPlay: () => void;
  onSeek: (ms: number) => void;
}) {
  const steps = r.steps;
  const point = sel.kind === 'point' ? r.points.find((p) => p.pointId === sel.id) : undefined;
  const step = steps.find((s) => s.index === (sel.kind === 'step' ? sel.index : steps.at(-1)!.index))!;
  const pos = steps.indexOf(step);
  const atT = [...steps].reverse().find((s) => s.videoTs <= t) ?? steps[0]!;

  return (
    <section className="qc-card et-card" aria-labelledby="et-evidence">
      <div className="qs-card-head" style={{ alignItems: 'center' }}>
        <h2 id="et-evidence" className={textClass('headline2', 'bold')}>
          검증 증거
        </h2>
        <span className={`${textClass('caption1')} qs-faint`}>
          {steps.length} shot · 영상 {fmtTs(total)}
        </span>
      </div>
      <SegmentedControl size="small" value={mode} onValueChange={(v) => onMode(v as 'image' | 'video')} name="media">
        <SegmentedControlItem value="image">이미지</SegmentedControlItem>
        <SegmentedControlItem value="video">영상</SegmentedControlItem>
      </SegmentedControl>

      {mode === 'image' ? (
        <>
          <div className="et-stage">
            <MockScreen
              screenshot={point ? point.evidence : step.screenshot}
              width={208}
              action={point || step.action === 'verify' ? undefined : step}
              highlight={point ? pointBounds(point) : undefined}
              label={
                point ? `${point.pointId} 증거 화면` : `스텝 ${step.index} ${STEP_ACTION_LABEL[step.action]} 직전 화면`
              }
            />
          </div>
          <div className="qs-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <Mono className={`${textClass('caption1')} qs-muted qs-ellipsis`}>
              {point ? `${point.pointId.split("-").at(-1)}_evidence.png` : shotName(step)}
            </Mono>
            <span className="qs-row" style={{ gap: token('space-2'), flexWrap: 'nowrap' }}>
              <IconButton
                aria-label="이전 화면"
                size="small"
                disabled={!point && pos <= 0}
                onClick={() => onStep(point ? steps.at(-1)! : steps[pos - 1]!)}
              >
                <Icons.IconChevronLeftSmall />
              </IconButton>
              <span className={`${textClass('caption1', 'medium')} qs-big`}>
                {point ? '' : `${pos + 1} / ${steps.length}`}
              </span>
              <IconButton
                aria-label="다음 화면"
                size="small"
                disabled={!!point || pos >= steps.length - 1}
                onClick={() => onStep(steps[pos + 1]!)}
              >
                <Icons.IconChevronRightSmall />
              </IconButton>
            </span>
          </div>
          <span className={`${textClass('caption1')} qs-faint`}>
            {point ? `${point.expected} — ${POINT_RESULT_LABEL[point.result]}` : '화면은 액션 직전 스크린샷'}
          </span>
        </>
      ) : (
        <>
          <div className="et-stage et-video">
            <MockScreen screenshot={atT.screenshot} width={208} label={`영상 ${fmtTs(t)} 시점 화면`} />
            <span className={`et-video-step ${textClass('caption1', 'medium')}`}>
              {atT.index} · {STEP_ACTION_LABEL[atT.action]}
            </span>
          </div>
          <div className="et-player">
            <IconButton aria-label={playing ? '일시정지' : '재생'} size="small" onClick={onPlay}>
              {playing ? <Icons.IconPause /> : <Icons.IconPlay />}
            </IconButton>
            <div className="et-track">
              <input
                type="range"
                min={0}
                max={total}
                step={100}
                value={t}
                aria-label="영상 위치"
                onChange={(e) => onSeek(Number(e.target.value))}
              />
              <div className="et-ticks" aria-hidden>
                {steps.map((s) => (
                  <span key={s.index} style={{ left: `${(s.videoTs / total) * 100}%` }} />
                ))}
              </div>
            </div>
            <Mono className={`${textClass('caption1')} qs-muted qs-big`}>
              {fmtTs(t)} / {fmtTs(total)}
            </Mono>
          </div>
          <span className={`${textClass('caption1')} qs-faint`}>
            눈금은 스텝 시작 시점. 재생하면 흐름이 따라갑니다.
          </span>
        </>
      )}
    </section>
  );
}

/** 대상 요소 중심 좌표 (디바이스 px) */
const center = (b: Bounds) => `(${Math.round(b.x + b.w / 2)}, ${Math.round(b.y + b.h / 2)})`;

function finalReason(r: CaseResult) {
  if (r.blockedReason) return r.blockedReason;
  const off = r.points.filter((p) => p.result !== 'match');
  if (off.length) return off.map((p) => p.reason).join(' ');
  if (!r.points.length) return '검증 포인트가 없습니다.';
  const unmet = autoConfirmChecks(r).filter((c) => !c.met);
  if (r.agentVerdict && r.agentVerdict !== 'pass' && unmet.length)
    return `검증 포인트는 일치했지만 ${unmet.map((c) => c.label).join(', ')} 조건을 충족하지 못해 사람이 확정하도록 남겼습니다.`;
  const lead =
    r.points.length === 1 ? '검증 포인트가 기대와 일치했습니다.' : `검증 포인트 ${r.points.length}개가 모두 기대와 일치했습니다.`;
  return `${lead} ${r.points[0]!.reason}`;
}

function FlowCard({ r, active, onStep }: { r: CaseResult; active: number; onStep: (s: ExecStep) => void }) {
  const steps = r.steps.filter((s) => s.action !== 'verify');
  const verify = r.steps.find((s) => s.action === 'verify');
  const scroller = useRef<HTMLOListElement>(null);

  // 선택된 스텝이 가로 스크롤 밖에 있으면 보이게 옮긴다 (페이지는 움직이지 않는다).
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[data-step="${active}"]`);
    if (!box || !el) return;
    const l = el.offsetLeft - box.offsetLeft;
    if (l < box.scrollLeft || l + el.offsetWidth > box.scrollLeft + box.clientWidth)
      box.scrollTo({ left: l - box.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [active]);

  return (
    <section className="qc-card et-card et-flow-card" aria-labelledby="et-flow">
      <div className="qs-card-head">
        <h2 id="et-flow" className={textClass('headline2', 'bold')}>
          테스트 동작 흐름
        </h2>
        <span className={`${textClass('caption1')} qs-faint`}>{steps.length}개 액션 · 최종 검증</span>
      </div>
      <ol ref={scroller} className="et-flow" aria-label="액션">
        {steps.map((s) => (
          <li key={s.index} className="et-step" data-step={s.index}>
            <div
              className="qs-row"
              style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: token('space-4') }}
            >
              <span className="qs-row" style={{ gap: token('space-6'), flexWrap: 'nowrap' }}>
                <span className={`et-num ${textClass('caption1', 'bold')}`}>{s.index}</span>
                <span className={textClass('label2', 'bold')}>{STEP_ACTION_LABEL[s.action]}</span>
              </span>
              <Mono className={`${textClass('caption1')} qs-faint`}>{fmtTs(s.videoTs)}</Mono>
            </div>
            <button
              type="button"
              className="et-shot"
              aria-pressed={active === s.index}
              aria-label={`스텝 ${s.index} 화면을 증거 패널에서 보기`}
              onClick={() => onStep(s)}
            >
              <MockScreen screenshot={s.screenshot} width={128} action={s} />
            </button>
            <div className="et-intent">
              <span className={`${textClass('caption2', 'medium')} et-intent-label`}>의도</span>
              <span className={textClass('label2', 'medium')}>{s.intent}</span>
            </div>
            <StepTarget s={s} />
          </li>
        ))}
        {verify && (
          <li className="et-step et-final" data-step={verify.index}>
            <div className="qs-row" style={{ gap: token('space-6'), flexWrap: 'nowrap' }}>
              <VerdictBadge verdict={r.agentVerdict ?? r.verdict} />
              <span className={textClass('label2', 'bold')}>최종 검증</span>
              <Mono className={`${textClass('caption1')} qs-faint`}>{fmtTs(verify.videoTs)}</Mono>
            </div>
            <button
              type="button"
              className="et-shot"
              aria-pressed={active === verify.index}
              aria-label="최종 검증 화면을 증거 패널에서 보기"
              onClick={() => onStep(verify)}
            >
              <MockScreen screenshot={verify.screenshot} width={128} />
            </button>
            <div className="et-why">
              <span className={`${textClass('caption2', 'medium')}`}>판정 이유</span>
              <span className={textClass('label2', 'medium')}>{finalReason(r)}</span>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}

function StepTarget({ s }: { s: ExecStep }) {
  const lines: string[] = [];
  if (s.target) lines.push(`text="${s.target.label}"${s.target.bounds ? ` → ${center(s.target.bounds)}` : ''}`);
  if (s.swipe) lines.push(`(${s.swipe.from.join(', ')}) → (${s.swipe.to.join(', ')})`);
  if (s.input) lines.push(`입력 "${s.input}"`);
  return (
    <div className="et-target">
      {lines.length > 0 && <span className={`${textClass('caption1', 'medium')} qs-faint`}>대상</span>}
      {lines.map((l) => (
        <Mono key={l} className={`${textClass('caption1')} qs-muted`}>
          {l}
        </Mono>
      ))}
      <Mono className={`${textClass('caption1')} qs-faint`}>{fmtNumber(s.durationMs)}ms</Mono>
      {s.risk && (
        <span className={textClass('caption1')} style={{ color: token('qcard-verdict-blocked-fg') }}>
          위험 액션 {s.risk.kind}
          {s.risk.approvedBy ? ` · 승인 ${s.risk.approvedBy}` : ''}
        </span>
      )}
    </div>
  );
}
