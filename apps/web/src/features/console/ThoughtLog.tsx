import type { ExecStep, ThoughtEntry } from '@qcard/shared';
import { STEP_ACTION_LABEL } from '@qcard/shared';
import { textClass, token } from '@qcard/ui';
import { useEffect, useRef } from 'react';
import { THOUGHT_META, fmtClock } from './meta';

export type LogEntry = ThoughtEntry & { stepIndex: number };

/** Agent 사고 로그 스트림: 무엇을 봤고, 왜 이 액션을 했는지. 스텝별로 묶는다. */
export function ThoughtLog({
  entries,
  steps,
  live,
}: {
  entries: LogEntry[];
  steps: ExecStep[];
  /** 새 로그가 오면 맨 아래로 따라간다 */
  live: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, live]);

  const kinds = Object.entries(THOUGHT_META);
  return (
    <section className="qcc-card" aria-label="Agent 사고 로그">
      <div className="qcc-card-head" style={{ flexWrap: 'wrap', rowGap: 6 }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          Agent 사고 로그
        </h2>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }} aria-hidden>
          {kinds.map(([k, m]) => (
            <span key={k} className={`qcc-kind ${textClass('caption1')} qcc-muted`}>
              <m.icon style={{ width: 14, height: 14, color: token(m.color) }} />
              {m.label}
            </span>
          ))}
        </span>
      </div>
      <div className="qcc-log" ref={ref} role="log" aria-live="polite">
        {entries.length === 0 && (
          <div className={`${textClass('label1')} qcc-faint`} style={{ padding: 16 }}>
            Agent가 첫 화면을 관찰하는 중…
          </div>
        )}
        {groupByStep(entries).map((g) => (
          <div className="qcc-log-group" key={g.first}>
            <StepHeader index={g.stepIndex} step={steps.find((s) => s.index === g.stepIndex)} />
            {g.items.map((e, j) => {
              const i = g.first + j;
              const m = THOUGHT_META[e.kind];
              return (
                <div
                  key={i}
                  className={`qcc-log-row${e.kind === 'system' ? ' is-system' : ''}${i === entries.length - 1 ? ' is-latest' : ''}`}
                >
                  <span className={`${textClass('caption1')} qcc-mono qcc-faint`} style={{ paddingTop: 2 }}>
                    {fmtClock(e.at)}
                  </span>
                  <span
                    className={`qcc-kind ${textClass('label2', 'medium')}`}
                    style={{ color: token('foreground-neutral-secondary') }}
                  >
                    <m.icon aria-hidden style={{ color: token(m.color) }} />
                    {m.label}
                  </span>
                  <span
                    className={`qcc-log-text ${e.kind === 'act' ? `${textClass('label2')} qcc-mono` : textClass('label1', e.kind === 'decide' ? 'medium' : 'regular')}`}
                  >
                    {e.text}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function StepHeader({ index, step }: { index: number; step?: ExecStep }) {
  return (
    <div className={`qcc-log-step ${textClass('label2', 'bold')}`}>
      {step ? (
        <>
          <span className="qcc-mono">스텝 {index}</span>
          <span className="qcc-muted" style={{ fontWeight: 500 }}>
            {STEP_ACTION_LABEL[step.action]}
            {step.target ? ` · ${step.target.label}` : ''}
          </span>
        </>
      ) : (
        <span>검증</span>
      )}
    </div>
  );
}

/** 연속한 같은 스텝의 로그를 한 묶음으로 (스텝 머리글이 묶음 안에서만 붙어 있게) */
function groupByStep(entries: LogEntry[]) {
  const groups: { stepIndex: number; first: number; items: LogEntry[] }[] = [];
  entries.forEach((e, i) => {
    const last = groups.at(-1);
    if (last && last.stepIndex === e.stepIndex) last.items.push(e);
    else groups.push({ stepIndex: e.stepIndex, first: i, items: [e] });
  });
  return groups;
}
