import { APPROVAL_LABEL, CHANGE_LABEL, type ApprovalStatus, type CaseChange, type TestCase } from '@qcard/shared';
import { textClass, token, type ColorToken } from '@qcard/ui';
import type { CSSProperties, ReactNode } from 'react';

export type Tone = 'neutral' | 'quiet' | 'brand' | 'pass' | 'fail' | 'check' | 'blocked' | 'violet' | 'blue';

const TONE: Record<Tone, { fg: ColorToken; bg?: ColorToken; border?: ColorToken }> = {
  neutral: { fg: 'qcard-verdict-nt-fg', bg: 'qcard-verdict-nt-bg' },
  quiet: { fg: 'foreground-neutral-tertiary', border: 'line-neutral-secondary' },
  brand: { fg: 'foreground-brand-primary', bg: 'surface-brand-subtle' },
  pass: { fg: 'qcard-verdict-pass-fg', bg: 'qcard-verdict-pass-bg' },
  fail: { fg: 'qcard-verdict-fail-fg', bg: 'qcard-verdict-fail-bg' },
  check: { fg: 'qcard-verdict-check-fg', bg: 'qcard-verdict-check-bg' },
  blocked: { fg: 'qcard-verdict-blocked-fg', bg: 'qcard-verdict-blocked-bg' },
  violet: { fg: 'foreground-accent-violet', bg: 'surface-accent-violet' },
  blue: { fg: 'foreground-accent-light-blue', bg: 'surface-accent-light-blue' },
};

/** 짧은 상태 라벨. 색만으로 구분하지 않도록 항상 글자를 쓴다. */
export function Tag({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const t = TONE[tone];
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: token('space-4'),
    padding: `${token('space-2')} ${token('space-6')}`,
    borderRadius: token('radius-4'),
    color: token(t.fg),
    background: t.bg ? token(t.bg) : 'transparent',
    boxShadow: t.border ? `inset 0 0 0 1px ${token(t.border)}` : undefined,
    whiteSpace: 'nowrap',
    lineHeight: '16px',
  };
  return (
    <span className={textClass('caption1', 'medium')} style={style} title={title}>
      {children}
    </span>
  );
}

const CHANGE_TONE: Record<CaseChange, Tone> = { new: 'blue', changed: 'violet', removed: 'neutral', same: 'quiet' };
export function ChangeBadge({ change }: { change: CaseChange }) {
  return <Tag tone={CHANGE_TONE[change]}>{CHANGE_LABEL[change]}</Tag>;
}

const APPROVAL_TONE: Record<ApprovalStatus, Tone> = {
  approved: 'pass',
  pending: 'neutral',
  held: 'check',
  rejected: 'fail',
};
export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  return <Tag tone={APPROVAL_TONE[status]}>{APPROVAL_LABEL[status]}</Tag>;
}

export function ModeBadge({ c }: { c: Pick<TestCase, 'mode' | 'steps'> }) {
  const manualSteps = c.steps.filter((s) => s.manual).length;
  if (c.mode === 'manual') return <Tag tone="quiet">Manual</Tag>;
  return (
    <span style={{ display: 'inline-flex', gap: token('space-4') }}>
      <Tag tone="quiet">Auto</Tag>
      {manualSteps > 0 && (
        <Tag tone="blocked" title={`수동 스텝 ${manualSteps}개`}>
          수동 {manualSteps}
        </Tag>
      )}
    </span>
  );
}

/** 승인 진행 막대 + 숫자 */
export function Progress({ value, total, label }: { value: number; total: number; label?: string }) {
  const ratio = total === 0 ? 0 : value / total;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: token('space-8'), minWidth: 0 }}>
      <span
        role="progressbar"
        aria-label={label ?? '승인 진행'}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        style={{
          display: 'inline-block',
          width: 88,
          height: 6,
          borderRadius: token('radius-full'),
          background: token('surface-neutral-tertiary'),
          boxShadow: `inset 0 0 0 1px ${token('line-neutral-tertiary')}`,
          overflow: 'hidden',
          flex: 'none',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${ratio * 100}%`,
            height: '100%',
            background: token('qcard-verdict-pass-fg'),
          }}
        />
      </span>
      <span className={`${textClass('label2', 'medium')} qd-num`}>
        {value}/{total}
      </span>
    </span>
  );
}
