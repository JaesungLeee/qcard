import type { ConsoleControl } from '@qcard/shared';
import { Icons, textClass, token } from '@qcard/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { fmtTs } from '../../components/format';
import { PhaseChip } from './meta';
import type { Phase } from './playback';

/** 디바이스 화면 너비: 데스크톱은 화면 높이에 맞춰 280~360px, 좁은 폭은 가용 너비 */
export function useScreenWidth() {
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

/** 가운데: 디바이스 화면 + 상태 줄 + 제어 (F-DB-01·02·03·05). 화면은 재생(목업)·실시간(영상)이 채운다 */
export function DeviceStage({
  phase,
  elapsedMs,
  stepNo,
  stepCount,
  canSkip,
  onControl,
  screen,
  note,
}: {
  phase: Phase;
  /** 케이스 경과 시간 */
  elapsedMs: number;
  stepNo: number;
  /** 모르면 없음 (실시간은 Agent가 몇 스텝을 쓸지 미리 모른다) */
  stepCount?: number;
  /** 지금 스텝을 건너뛸 수 있는가 (수동 스텝은 [완료]로) */
  canSkip: boolean;
  onControl: (a: ConsoleControl) => void;
  /** 화면 너비(px)를 받아 화면을 그린다 */
  screen: (width: number) => ReactNode;
  /** 상태 줄 아래 한 줄 안내 (예: 화면 켜짐 유지 중) */
  note?: ReactNode;
}) {
  const width = useScreenWidth();
  const active = phase === 'running' || phase === 'paused';
  const ended = phase === 'done' || phase === 'aborted';
  return (
    <section className="qcc-card qcc-device" aria-label="디바이스 화면">
      <div className="qcc-device-status">
        <PhaseChip phase={phase} />
        <span className={`${textClass('label2', 'medium')} qcc-mono`}>
          스텝 {stepNo}
          {stepCount !== undefined && <span className="qcc-faint">/{stepCount}</span>}
        </span>
        <span
          className={`${textClass('label2', 'medium')} qcc-mono`}
          title="케이스 경과 시간"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Icons.IconClock aria-hidden style={{ width: 14, height: 14, color: token('foreground-neutral-tertiary') }} />
          {fmtTs(elapsedMs)}
        </span>
      </div>
      {note && (
        <div
          className={`${textClass('caption1', 'medium')} qcc-muted`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 4,
            marginBottom: 8,
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          {note}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        {screen(width)}
        {phase === 'takeover' && <ScreenNote icon={<Icons.IconPerson />}>실행자 조작 중 — Agent 대기</ScreenNote>}
        {phase === 'manual' && <ScreenNote icon={<Icons.IconPerson />}>실행자 조작 대기</ScreenNote>}
        {phase === 'approval' && (
          <ScreenNote icon={<Icons.IconTriangleExclamation />}>위험 액션 — 실행자 응답 대기</ScreenNote>
        )}
        {phase === 'done' && <ScreenNote icon={<Icons.IconHourglass />}>다음 케이스 준비 중</ScreenNote>}
      </div>
      <div className="qcc-controls" role="toolbar" aria-label="실행 제어">
        {phase === 'paused' ? (
          <Ctl icon={<Icons.IconPlay />} onClick={() => onControl('resume')} on>
            재개
          </Ctl>
        ) : (
          <Ctl icon={<Icons.IconPause />} onClick={() => onControl('pause')} disabled={phase !== 'running'}>
            일시정지
          </Ctl>
        )}
        <Ctl icon={<Icons.IconChevronDoubleRight />} onClick={() => onControl('skip')} disabled={!active || !canSkip}>
          스텝 건너뛰기
        </Ctl>
        {phase === 'takeover' ? (
          <Ctl icon={<Icons.IconAgent />} onClick={() => onControl('returnToAgent')} on>
            Agent에 반환
          </Ctl>
        ) : (
          <Ctl icon={<Icons.IconPerson />} onClick={() => onControl('takeOver')} disabled={!active}>
            Take over
          </Ctl>
        )}
        <Ctl icon={<Icons.IconSquareFill />} onClick={() => onControl('abort')} disabled={ended} danger>
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
