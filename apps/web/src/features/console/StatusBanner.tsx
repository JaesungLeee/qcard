import type { ConsoleQueueItem } from '@qcard/fixtures';
import type { ExecStep } from '@qcard/shared';
import { Button, Icons, VerdictBadge, textClass, token } from '@qcard/ui';
import type { Dispatch, ReactNode } from 'react';
import { fmtTs } from '../../components/format';
import { MANUAL_TIMEOUT_MS, type PlaybackAction, type PlaybackState } from './playback';

/**
 * 실행자가 지금 해야 할 일. 수동 스텝 대기(F-EX-11)·Take over(F-DB-05)·검증·완료 상태를 본문 위에 크게 띄운다.
 * Agent가 혼자 진행 중일 때는 아무것도 그리지 않는다.
 */
export function StatusBanner({
  state,
  dispatch,
  step,
  caseStepText,
  verified,
  pointCount,
  next,
}: {
  state: PlaybackState;
  dispatch: Dispatch<PlaybackAction>;
  step: ExecStep;
  caseStepText?: string;
  verified: number;
  pointCount: number;
  next?: ConsoleQueueItem;
}) {
  switch (state.phase) {
    case 'manual': {
      const left = MANUAL_TIMEOUT_MS - state.waitMs;
      return (
        <Banner
          tone="manual"
          icon={<Icons.IconPerson style={{ color: token('foreground-cautionary-primary') }} />}
          title="수동 스텝 — 디바이스에서 직접 수행해 주세요"
          action={
            <Button variant="solid" color="primary" onClick={() => dispatch({ type: 'completeManual' })}>
              완료
            </Button>
          }
        >
          <span className={textClass('body2-reading')}>{caseStepText ?? step.intent}</span>
          <span className="qcc-manual-meta">
            {step.risk && (
              <span className={`qcc-tag is-risk ${textClass('caption1', 'bold')}`}>
                <Icons.IconTriangleExclamation aria-hidden style={{ width: 12, height: 12 }} />
                위험 액션 · {step.risk.kind}
              </span>
            )}
            {step.risk?.planned && (
              <span className={`${textClass('label2')} qcc-muted`}>
                케이스 단계에 계획된 액션 — 케이스 승인으로 사전 승인됨, 추가 승인 없이 실행자가 직접 수행
              </span>
            )}
            <span
              className={`${textClass('label2', 'medium')} qcc-mono`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icons.IconHourglass
                aria-hidden
                style={{ width: 14, height: 14, color: token('foreground-neutral-tertiary') }}
              />
              {fmtTs(left)} 남음
            </span>
            <span className={`${textClass('label2')} qcc-muted`}>10분 안에 [완료]하지 않으면 Blocked 후 다음 케이스로</span>
          </span>
        </Banner>
      );
    }
    case 'takeover':
      return (
        <Banner
          tone="verify"
          icon={<Icons.IconPerson style={{ color: token('foreground-brand-primary') }} />}
          title="Take over 중 — Agent가 대기하고 있습니다"
          action={
            <Button variant="solid" color="primary" onClick={() => dispatch({ type: 'returnToAgent' })}>
              Agent에 반환
            </Button>
          }
        >
          <span className={`${textClass('label1')} qcc-muted`}>
            디바이스를 직접 조작하세요. 조작 내용은 녹화와 스텝 타임라인에 남고, 반환하면 Agent가 현재 화면부터 다시
            관찰합니다.
          </span>
        </Banner>
      );
    case 'verifying':
      return (
        <Banner
          tone="verify"
          icon={<Icons.IconCircleCheck style={{ color: token('foreground-brand-primary') }} />}
          title={`검증 포인트 확인 중 · ${verified}/${pointCount}`}
        >
          <span className={`${textClass('label1')} qcc-muted`}>
            수동 스텝 완료를 받았습니다. Agent가 화면을 다시 관찰하고 검증 포인트를 판정합니다.
          </span>
        </Banner>
      );
    case 'done':
      return (
        <Banner
          tone="done"
          icon={
            state.verdict === 'pass' ? (
              <Icons.IconCircleCheckFill style={{ color: token('foreground-positive-primary') }} />
            ) : (
              <Icons.IconCircleExclamationFill style={{ color: token('foreground-cautionary-primary') }} />
            )
          }
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              케이스 완료 {state.verdict && <VerdictBadge verdict={state.verdict} />}
              {state.reason && <span className={`${textClass('label1')} qcc-muted`}>{state.reason}</span>}
            </span>
          }
        >
          {next ? (
            <span className={`${textClass('label1')} qcc-muted`}>
              다음 케이스 준비 중 ·{' '}
              <span className="qcc-mono" style={{ color: token('foreground-neutral-primary') }}>
                {next.tcId}
              </span>{' '}
              {next.title}
            </span>
          ) : (
            <span className={`${textClass('label1')} qcc-muted`}>큐의 모든 케이스를 수행했습니다.</span>
          )}
        </Banner>
      );
    case 'aborted':
      return (
        <Banner
          tone="stop"
          icon={<Icons.IconCircleBlock style={{ color: token('foreground-negative-primary') }} />}
          title="Run 중단됨"
        >
          <span className={`${textClass('label1')} qcc-muted`}>
            실행자가 Run을 중단했습니다. 현재 케이스는 판정하지 않고, 남은 케이스는 대기 상태로 남습니다.
          </span>
        </Banner>
      );
    default:
      return null;
  }
}

function Banner({
  tone,
  icon,
  title,
  action,
  children,
}: {
  tone: 'manual' | 'verify' | 'done' | 'stop';
  icon: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`qcc-manual is-${tone}`} role={tone === 'manual' ? 'alert' : 'status'} aria-label="실행자 알림">
      <span className="qcc-manual-icon" aria-hidden>
        {icon}
      </span>
      <div className="qcc-manual-body">
        <div className={textClass('headline2', 'bold')}>{title}</div>
        {children}
      </div>
      {action && <div className="qcc-manual-actions">{action}</div>}
    </section>
  );
}
