// 상태·로그 종류별 라벨과 아이콘. 색은 아이콘에만 쓰고 글자는 항상 함께 보인다.
import type { ThoughtEntry } from '@qcard/shared';
import { Icons, token, type ColorToken } from '@qcard/ui';
import type { Phase } from './playback';

type Icon = typeof Icons.IconEye;

export const THOUGHT_META: Record<ThoughtEntry['kind'], { label: string; icon: Icon; color: ColorToken }> = {
  observe: { label: '관찰', icon: Icons.IconEye, color: 'foreground-neutral-tertiary' },
  decide: { label: '판단', icon: Icons.IconBulb, color: 'foreground-accent-violet' },
  act: { label: '액션', icon: Icons.IconThunder, color: 'foreground-brand-primary' },
  verify: { label: '검증', icon: Icons.IconCircleCheck, color: 'foreground-positive-primary' },
  recover: { label: '복구', icon: Icons.IconRefresh, color: 'foreground-cautionary-primary' },
  system: { label: '시스템', icon: Icons.IconSetting, color: 'foreground-neutral-secondary' },
};

export const PHASE_META: Record<Phase, { label: string; fg: ColorToken; bg: ColorToken; dot: ColorToken }> = {
  running: {
    label: '실행 중',
    fg: 'foreground-brand-primary',
    bg: 'surface-brand-subtle',
    dot: 'foreground-brand-primary',
  },
  paused: {
    label: '일시정지',
    fg: 'foreground-neutral-primary',
    bg: 'surface-neutral-tertiary',
    dot: 'foreground-neutral-tertiary',
  },
  takeover: {
    label: 'Take over',
    fg: 'foreground-accent-violet',
    bg: 'surface-accent-violet',
    dot: 'foreground-accent-violet',
  },
  manual: {
    label: '수동 스텝 대기',
    fg: 'qcard-verdict-blocked-fg',
    bg: 'surface-cautionary-primary',
    dot: 'foreground-cautionary-primary',
  },
  verifying: {
    label: '검증 중',
    fg: 'foreground-brand-primary',
    bg: 'surface-brand-subtle',
    dot: 'foreground-brand-primary',
  },
  done: {
    label: '케이스 완료',
    fg: 'foreground-neutral-primary',
    bg: 'surface-neutral-tertiary',
    dot: 'foreground-positive-primary',
  },
  aborted: {
    label: '중단됨',
    fg: 'foreground-negative-primary',
    bg: 'surface-neutral-tertiary',
    dot: 'foreground-negative-primary',
  },
};

export function PhaseChip({ phase }: { phase: Phase }) {
  const m = PHASE_META[phase];
  return (
    <span
      className="qcc-phase qc-text-label2 qc-medium"
      style={{ color: token(m.fg), background: token(m.bg) }}
      role="status"
    >
      <span className="qcc-dot" style={{ background: token(m.dot) }} />
      {m.label}
    </span>
  );
}

/** 0:08.4 형식 (사고 로그 시각) */
export const fmtClock = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
