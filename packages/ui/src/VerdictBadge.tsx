import { VERDICT_LABEL, type Verdict } from '@qcard/shared';
import type { CSSProperties } from 'react';
import { textClass, token } from './token';

const SHORT: Record<Verdict, string> = { pass: 'P', fail: 'F', blocked: 'B', check: '?', nt: 'N/T', na: 'N/A' };

/** 판정 배지·셀. 색은 `qcard-verdict-*` 토큰만 쓰고, 색만으로 구분하지 않도록 항상 글자를 함께 보인다. */
export function VerdictBadge({ verdict, short = false }: { verdict: Verdict; short?: boolean }) {
  const key = verdict === 'na' ? 'nt' : verdict;
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${token('space-2')} ${token('space-6')}`,
    borderRadius: token('radius-4'),
    color: token(`qcard-verdict-${key}-fg`),
    background: token(`qcard-verdict-${key}-bg`),
    whiteSpace: 'nowrap',
  };
  return (
    <span className={textClass('caption1', 'medium')} style={style} title={VERDICT_LABEL[verdict]}>
      {short ? SHORT[verdict] : VERDICT_LABEL[verdict]}
    </span>
  );
}
