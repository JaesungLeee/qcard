import { Icons, textClass } from '@qcard/ui';
import { useState } from 'react';
import type { CaseScope, FeatureNode } from './logic';

/** 케이스 탭 왼쪽 분류 목록: 전체 › 기능 › 세부 기능(유저 플로우). 기능은 접고 펼친다. */
export function CaseNav({
  tree,
  total,
  scope,
  onPick,
}: {
  tree: FeatureNode[];
  total: number;
  scope: CaseScope;
  onPick: (scope: CaseScope) => void;
}) {
  // 처음에는 고른 기능을, 기능이 하나뿐이면 그 기능을 펼쳐 둔다
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = scope.feature ?? (tree.length === 1 ? tree[0]!.feature : null);
    return first ? { [first]: true } : {};
  });
  const isOpen = (f: string) => open[f] ?? f === scope.feature;
  const all = scope.feature === null;

  return (
    <nav className={`qd-nav ${textClass('label1')}`} aria-label="기능 분류">
      <button
        type="button"
        className="qd-nav-item"
        aria-current={all ? 'true' : undefined}
        onClick={() => onPick({ feature: null, subFeature: null })}
      >
        <span className={`${textClass('label1', 'bold')} qd-nav-label`}>전체</span>
        <span className="qd-nav-count qc-mono">{total}</span>
      </button>
      {tree.map((f) => {
        const expanded = isOpen(f.feature);
        const current = scope.feature === f.feature && scope.subFeature === null;
        return (
          <div key={f.feature} className="qd-nav-group">
            <div className={current ? 'qd-nav-feature is-current' : 'qd-nav-feature'}>
              <button
                type="button"
                className="qd-nav-toggle"
                aria-expanded={expanded}
                aria-label={`${f.feature} ${expanded ? '접기' : '펼치기'}`}
                onClick={() => setOpen((o) => ({ ...o, [f.feature]: !expanded }))}
              >
                <Icons.IconChevronRightSmall aria-hidden className={expanded ? 'qd-chevron is-open' : 'qd-chevron'} />
              </button>
              <button
                type="button"
                className="qd-nav-item"
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  setOpen((o) => ({ ...o, [f.feature]: true }));
                  onPick({ feature: f.feature, subFeature: null });
                }}
              >
                <span className={`${textClass('label1', 'bold')} qd-nav-label`} title={f.feature}>
                  {f.feature}
                </span>
                {f.hasNew && <span className="qd-nav-new" title="신규 케이스 있음" />}
                <span className="qd-nav-count qc-mono" title={`승인 ${f.approved} / ${f.total}`}>
                  {f.approved}/{f.total}
                </span>
              </button>
            </div>
            {expanded &&
              f.flows.map((fl) => {
                const on = scope.feature === f.feature && scope.subFeature === fl.subFeature;
                return (
                  <button
                    key={fl.subFeature}
                    type="button"
                    className={`qd-nav-item qd-nav-flow ${textClass('label2')}`}
                    aria-current={on ? 'true' : undefined}
                    onClick={() => onPick({ feature: f.feature, subFeature: fl.subFeature })}
                  >
                    <span className="qd-nav-label" title={fl.subFeature}>
                      {fl.subFeature || '(유저 플로우 없음)'}
                    </span>
                    <span className="qd-nav-count qc-mono">{fl.count}</span>
                  </button>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}
