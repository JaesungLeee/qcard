import { textClass } from '@qcard/ui';
import type { FieldDiff } from './logic';

const MARK = { del: '이전', add: '현재', same: '' } as const;

/** 필드별 줄 diff. 색과 함께 "이전/현재" 글자·취소선으로도 구분한다. */
export function CaseDiff({
  diffs,
  labels = { del: MARK.del, add: MARK.add },
}: {
  diffs: FieldDiff[];
  labels?: { del: string; add: string };
}) {
  if (diffs.length === 0) return <p className={`${textClass('label1')} qd-muted`}>본문 차이가 없습니다.</p>;
  return (
    <div className="qd-diff">
      {diffs.map((d) => (
        <div key={d.key} className="qd-diff-field">
          <div className={`${textClass('label2', 'medium')} qd-diff-head`}>{d.label}</div>
          {d.lines.map((l, i) => (
            <div key={i} className={`${textClass('label1')} qd-diff-line ${l.op}`}>
              <span className={`${textClass('caption1', 'medium')} qd-diff-mark`} style={{ paddingTop: 2 }}>
                {l.op === 'same' ? '' : labels[l.op]}
              </span>
              <span className="qd-diff-text">{l.text || '(비어 있음)'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
