import type { ExecStep } from '@qcard/shared';
import { Icons, textClass, token } from '@qcard/ui';
import { useEffect, useState, type Dispatch, type ReactNode } from 'react';
import { fmtTs } from '../../components/format';
import { MockScreen } from '../../mock/MockScreen';
import { PhaseChip } from './meta';
import { elapsedMs, type PlaybackAction, type PlaybackState } from './playback';

/** 디바이스 화면 너비: 데스크톱은 화면 높이에 맞춰 280~360px, 좁은 폭은 가용 너비 */
function useScreenWidth() {
  const calc = () => {
    if (typeof window === 'undefined') return 360;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 760) return Math.min(340, w - 32 - 24 - 8);
    // 상단 바·여백·상태 줄·제어 버튼을 뺀 높이에 1080×2400 비율로 맞춘다
    return Math.round(Math.max(280, Math.min(360, ((h - 236) * 1080) / 2400)));
  };
  const [width, setWidth] = useState(calc);
  useEffect(() => {
    const on = () => setWidth(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return width;
}

/** 가운데: 라이브 디바이스 화면 + 액션 오버레이 + 제어 (F-DB-01·02·03·05) */
export function DeviceStage({
  step,
  afterScreen,
  stepCount,
  state,
  dispatch,
}: {
  step: ExecStep;
  /** 케이스가 끝난 뒤 보일 화면 (수동 스텝 이후 화면은 fixture에 없어 앞 화면으로 대신한다) */
  afterScreen?: ExecStep['screenshot'];
  stepCount: number;
  state: PlaybackState;
  dispatch: Dispatch<PlaybackAction>;
}) {
  const width = useScreenWidth();
  const { phase } = state;
  const active = phase === 'running' || phase === 'paused';
  const ended = phase === 'done' || phase === 'aborted';
  const closed = phase === 'done' || phase === 'verifying';
  // 액션 오버레이는 Agent가 누르려는 순간에만 보인다 (수동·Take over 중에는 사람이 조작한다)
  const overlay = (phase === 'running' || phase === 'paused') && step.action !== 'manual' ? step : undefined;
  return (
    <section className="qcc-card qcc-device" aria-label="디바이스 화면">
      <div className="qcc-device-status">
        <PhaseChip phase={phase} />
        <span className={`${textClass('label2', 'medium')} qcc-mono`}>
          스텝 {step.index}
          <span className="qcc-faint">/{stepCount}</span>
        </span>
        <span
          className={`${textClass('label2', 'medium')} qcc-mono`}
          title="케이스 경과 시간"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Icons.IconClock aria-hidden style={{ width: 14, height: 14, color: token('foreground-neutral-tertiary') }} />
          {fmtTs(elapsedMs(state))}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        {/* 실제 제품에서는 호스트 에이전트가 scrcpy(ADB) H.264 스트림을 보내고, 브라우저에서 디코딩한
            <video>/<canvas>가 이 MockScreen 자리를 대신한다 (F-DB-01). 오버레이는 그 위에 같은 좌표계로 그린다. */}
        <MockScreen screenshot={afterScreen && closed ? afterScreen : step.screenshot} width={width} action={overlay} label={`${step.index}번 스텝 화면`} />
        {phase === 'takeover' && <ScreenNote icon={<Icons.IconPerson />}>실행자 조작 중 — Agent 대기</ScreenNote>}
        {phase === 'manual' && <ScreenNote icon={<Icons.IconPerson />}>실행자 조작 대기</ScreenNote>}
        {phase === 'done' && <ScreenNote icon={<Icons.IconHourglass />}>다음 케이스 준비 중</ScreenNote>}
      </div>
      <div className="qcc-controls" role="toolbar" aria-label="실행 제어">
        {phase === 'paused' ? (
          <Ctl icon={<Icons.IconPlay />} onClick={() => dispatch({ type: 'resume' })} on>
            재개
          </Ctl>
        ) : (
          <Ctl icon={<Icons.IconPause />} onClick={() => dispatch({ type: 'pause' })} disabled={phase !== 'running'}>
            일시정지
          </Ctl>
        )}
        <Ctl
          icon={<Icons.IconChevronDoubleRight />}
          onClick={() => dispatch({ type: 'skip' })}
          disabled={!active || step.action === 'manual'}
        >
          스텝 건너뛰기
        </Ctl>
        {phase === 'takeover' ? (
          <Ctl icon={<Icons.IconAgent />} onClick={() => dispatch({ type: 'returnToAgent' })} on>
            Agent에 반환
          </Ctl>
        ) : (
          <Ctl icon={<Icons.IconPerson />} onClick={() => dispatch({ type: 'takeOver' })} disabled={!active}>
            Take over
          </Ctl>
        )}
        <Ctl icon={<Icons.IconSquareFill />} onClick={() => dispatch({ type: 'abort' })} disabled={ended} danger>
          중단
        </Ctl>
      </div>
    </section>
  );
}

function Ctl({
  icon,
  children,
  onClick,
  disabled,
  on,
  danger,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  on?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`qcc-ctl ${textClass('caption1', 'medium')}${on ? ' is-on' : ''}${danger ? ' is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span aria-hidden style={{ display: 'flex' }}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function ScreenNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={textClass('label2', 'bold')}
      style={{
        position: 'absolute',
        left: '50%',
        top: 40,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: token('radius-full'),
        background: token('surface-neutral-inverse'),
        color: token('foreground-neutral-inverse'),
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ display: 'flex', width: 16, height: 16 }}>
        {icon}
      </span>
      {children}
    </div>
  );
}
