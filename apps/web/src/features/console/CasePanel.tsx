import type { ExecStep, TestCase } from '@qcard/shared';
import {
  POINT_COMPARE_LABEL,
  POINT_METHOD_LABEL,
  riskDecisionLabel,
  riskKindLabel,
  STEP_ACTION_LABEL,
} from '@qcard/shared';
import { ContentBadge, Icons, textClass, token } from '@qcard/ui';
import { fmtNumber, fmtTs } from '../../components/format';
import { MockScreen } from '../../mock/MockScreen';
import type { Phase } from './playback';

/** 현재 케이스: TC ID · 제목 · 단계(현재 단계 강조) · 검증 포인트 */
export function CasePanel({
  tc,
  step,
  phase,
  verified,
  prepText = '준비 — 앱 데이터 초기화 후 닉네임·습관 준비 플로우 수행',
}: {
  tc: TestCase;
  /** 지금 스텝. 없으면 준비 중 */
  step?: ExecStep;
  phase: Phase;
  verified: number;
  /** 준비 행 문구 */
  prepText?: string;
}) {
  const ended = phase === 'done' || phase === 'verifying';
  const cur = ended ? tc.steps.length : step?.caseStepIndex; // undefined = 준비 단계
  const rows = [{ text: prepText, manual: false }, ...tc.steps];
  return (
    <section className="qcc-card" aria-label="현재 케이스">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span className={`${textClass('label2', 'medium')} qcc-mono qcc-muted`}>{tc.tcId}</span>
        <ContentBadge size="xsmall" variant="outlined">
          {tc.mode === 'manual' ? 'Manual' : 'Auto'}
        </ContentBadge>
        <span className={`${textClass('caption1')} qcc-faint`}>
          {tc.feature} › {tc.subFeature}
        </span>
      </div>
      <h1 className={textClass('title3', 'bold')} style={{ margin: '0 0 16px' }}>
        {tc.title}
      </h1>
      <div className="qcc-split">
        <div>
          <h3 className={`${textClass('label2', 'medium')} qcc-faint`} style={{ margin: '0 0 6px' }}>
            단계
          </h3>
          <ol className="qcc-steps">
            {rows.map((s, i) => {
              const idx = i - 1; // -1 = 준비
              const isCur = cur === undefined ? idx === -1 : idx === cur && !ended;
              const isDone = cur === undefined ? false : idx < cur || ended;
              return (
                <li
                  key={i}
                  className={`${textClass('label1', isCur ? 'medium' : 'regular')}${isCur ? ' is-current' : ''}${isDone ? ' is-done' : ''}`}
                  aria-current={isCur ? 'step' : undefined}
                >
                  <span className={`qcc-num ${textClass('caption2', 'bold')}`}>
                    {isDone ? (
                      <Icons.IconCheckThick aria-hidden style={{ width: 12, height: 12 }} />
                    ) : i === 0 ? (
                      <Icons.IconFlag aria-label="준비" style={{ width: 12, height: 12 }} />
                    ) : (
                      i
                    )}
                  </span>
                  <span>{s.text}</span>
                  {s.manual && s.risk !== 'human' && (
                    <span className={`qcc-tag is-manual ${textClass('caption1', 'medium')}`}>수동</span>
                  )}
                  {'risk' in s && s.risk && (
                    <span className={`qcc-tag is-risk ${textClass('caption1', 'bold')}`}>
                      {s.risk === 'human' ? '사람 전용' : '위험 · 승인'}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <h3 className={`${textClass('label2', 'medium')} qcc-faint`} style={{ margin: '0 0 6px' }}>
            검증 포인트
          </h3>
          <ul className="qcc-steps">
            {tc.verificationPoints.map((p, i) => {
              const ok = i < verified;
              return (
                <li key={p.id} className={textClass('label1')}>
                  <span
                    aria-hidden
                    style={{
                      display: 'flex',
                      marginTop: 2,
                      color: token(ok ? 'foreground-positive-primary' : 'foreground-neutral-quaternary'),
                    }}
                  >
                    {ok ? (
                      <Icons.IconCircleCheckFill style={{ width: 18, height: 18 }} />
                    ) : (
                      <Icons.IconCircle style={{ width: 18, height: 18 }} />
                    )}
                  </span>
                  <span>
                    {p.expected}
                    <span className={`${textClass('caption1')} qcc-faint`} style={{ display: 'block' }}>
                      {POINT_COMPARE_LABEL[p.compare]} · {POINT_METHOD_LABEL[p.method]}
                    </span>
                  </span>
                  <span className={`${textClass('caption1', 'medium')} ${ok ? '' : 'qcc-faint'}`}>
                    {ok ? '일치' : phase === 'verifying' && i === verified ? '확인 중' : '대기'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** 스텝 타임라인: 썸네일 · 액션 · 의도 */
export function StepTimeline({ steps, current, ended }: { steps: ExecStep[]; current: number; ended: boolean }) {
  // 실시간에서는 케이스가 막 시작해 스텝이 아직 없을 수 있다
  const step = steps.find((s) => s.index === current) ?? steps.at(-1);
  const b = step?.target?.bounds;
  return (
    <section className="qcc-card" aria-label="스텝 타임라인">
      <div className="qcc-card-head">
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          스텝 타임라인
        </h2>
        <span className={`${textClass('label2')} qcc-muted`}>
          액션 직전 화면 · <span className="qcc-mono">{steps.length}</span>스텝
        </span>
      </div>
      <ol className="qcc-strip" style={{ listStyle: 'none', margin: 0 }}>
        {steps.map((s) => {
          const state = ended || s.index < current ? 'done' : s.index === current ? 'current' : 'pending';
          return (
            <li
              key={s.index}
              className={`qcc-thumb is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <MockScreen screenshot={s.screenshot} width={56} label={`${s.index}번 스텝 썸네일`} />
              <span className={`qcc-thumb-label ${textClass('caption1', state === 'current' ? 'bold' : 'medium')}`}>
                <span className="qcc-mono qcc-faint">{s.index}</span>
                {STEP_ACTION_LABEL[s.action]}
                {state === 'done' && (
                  <Icons.IconCheckThick aria-label="완료" style={{ color: token('foreground-positive-primary') }} />
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {!step ? (
        <p className={`${textClass('label1')} qcc-muted`} style={{ margin: '8px 0 0' }}>
          Agent가 첫 액션을 준비하고 있습니다.
        </p>
      ) : (
        <dl className={`qcc-kv ${textClass('label1')}`} style={{ marginTop: 8 }}>
          <dt>의도</dt>
          <dd className={textClass('label1', 'medium')}>{step.intent}</dd>
          <dt>액션</dt>
          <dd>
            {STEP_ACTION_LABEL[step.action]}
            {step.target && (
              <>
                {' · '}
                {step.target.label}{' '}
                {step.target.elementId && (
                  <span className={`qcc-mono ${textClass('label2')} qcc-muted`}>{step.target.elementId}</span>
                )}
                {b && (
                  <span className={`qcc-mono ${textClass('label2')} qcc-faint`}>
                    {' '}
                    ({fmtNumber(Math.round(b.x + b.w / 2))}, {fmtNumber(Math.round(b.y + b.h / 2))})
                  </span>
                )}
              </>
            )}
          </dd>
          {step.input && (
            <>
              <dt>입력값</dt>
              <dd className="qcc-mono">“{step.input}”</dd>
            </>
          )}
          {step.risk && (
            <>
              <dt>위험 액션</dt>
              <dd>
                <span className={`qcc-tag is-risk ${textClass('caption1', 'bold')}`}>
                  {riskKindLabel(step.risk.kind)}
                </span>{' '}
                <span className={`${textClass('label2')} qcc-muted`}>
                  {riskDecisionLabel(step.risk)}
                  {step.risk.reason ? ` — ${step.risk.reason}` : ''}
                </span>
              </dd>
            </>
          )}
          <dt>영상 시점</dt>
          <dd className="qcc-mono">{fmtTs(step.videoTs)}</dd>
        </dl>
      )}
    </section>
  );
}

/** 실행 한도와 사용량 */
export function UsageCard({
  caseTokens,
  limit,
  runTokens,
  costUsd,
  stepNo,
  stepLimit,
}: {
  caseTokens: number;
  limit: number;
  runTokens: number;
  costUsd: number;
  stepNo: number;
  stepLimit: number;
}) {
  const ratio = Math.min(1, caseTokens / limit);
  return (
    <section className="qcc-card" aria-label="실행 한도">
      <div className="qcc-card-head" style={{ marginBottom: 10 }}>
        <Icons.IconCoins aria-hidden style={{ width: 18, height: 18, color: token('foreground-neutral-secondary') }} />
        <span className={textClass('label1', 'bold')}>실행 한도</span>
        <span className={`${textClass('caption1')} qcc-faint`}>초과 시 Blocked</span>
      </div>
      <div
        className={textClass('label2')}
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
      >
        <span className="qcc-muted">케이스 토큰</span>
        <span className="qcc-mono">
          {fmtNumber(caseTokens)}
          <span className="qcc-faint"> / {fmtNumber(limit)}</span>
        </span>
      </div>
      <div className="qcc-bar" role="meter" aria-valuenow={caseTokens} aria-valuemax={limit} aria-label="케이스 토큰">
        <span
          style={{
            width: `${ratio * 100}%`,
            background: token(ratio > 0.8 ? 'foreground-cautionary-primary' : 'surface-brand-primary'),
          }}
        />
      </div>
      <dl className={`qcc-kv ${textClass('label2')}`} style={{ marginTop: 12, gridTemplateColumns: '1fr auto' }}>
        <dt>케이스 스텝</dt>
        <dd className="qcc-mono" style={{ textAlign: 'right' }}>
          {stepNo}
          <span className="qcc-faint"> / {stepLimit}</span>
        </dd>
        <dt>Run 누적 토큰</dt>
        <dd className="qcc-mono" style={{ textAlign: 'right' }}>
          {fmtNumber(runTokens)}
        </dd>
        <dt title="API 단가로 계산한 참고값입니다. 실제로는 내 Claude 플랜 사용량에서 차감됩니다.">Run 환산 비용</dt>
        <dd className="qcc-mono" style={{ textAlign: 'right' }}>
          ${costUsd.toFixed(2)}
        </dd>
      </dl>
    </section>
  );
}
