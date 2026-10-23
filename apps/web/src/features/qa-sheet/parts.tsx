// QA 시트 화면들이 함께 쓰는 작은 조각.
import { PAUSE_REASON_LABEL, VERDICT_LABEL, type PauseReason, type Verdict } from '@qcard/shared';
import { Icons, VerdictBadge, textClass, token } from '@qcard/ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { VerdictCounts } from '../../data/api';
import { fmtDate } from '../../components/format';
import { VERDICTS } from './model';

/** 카드 + 섹션 제목(headline2 bold) */
export function Card({
  title,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`qc-card qs-stack ${className}`} aria-labelledby={id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="qs-card-head">
          {title && (
            <h2 id={id ? `${id}-title` : undefined} className={textClass('headline2', 'bold')}>
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="qs-kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className={textClass('label2', 'medium')}>{k}</dt>
          <dd className={textClass('label1')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const BAR_ORDER = ['pass', 'fail', 'blocked', 'check'] as const;
/** 판정별 구간 막대. 나머지(N/T)는 바탕색으로 남는다. */
export function VerdictBar({ counts, total, label }: { counts: VerdictCounts; total: number; label: string }) {
  return (
    <div
      className="qs-bar"
      role="img"
      aria-label={`${label}: ${BAR_ORDER.map((v) => `${VERDICT_LABEL[v]} ${counts[v]}`).join(', ')}, N/T ${counts.nt} / 전체 ${total}`}
    >
      {total > 0 &&
        BAR_ORDER.map((v) =>
          counts[v] ? (
            <span
              key={v}
              style={{ width: `${(counts[v] / total) * 100}%`, background: token(`qcard-verdict-${v}-fg`) }}
            />
          ) : null,
        )}
    </div>
  );
}

/** 판정별 건수: VerdictBadge + 숫자. 0건은 `hideZero`면 숨긴다. */
export function VerdictCountList({ counts, hideZero = false }: { counts: VerdictCounts; hideZero?: boolean }) {
  return (
    <div className="qs-row" style={{ gap: token('space-12') }}>
      {VERDICTS.filter((v) => v !== 'na' || counts.na > 0)
        .filter((v) => !hideZero || counts[v] > 0)
        .map((v) => (
          <span key={v} className="qs-row" style={{ gap: token('space-4') }}>
            <VerdictBadge verdict={v} />
            <span className={`${textClass('label1', 'bold')} qs-big`}>{counts[v]}</span>
          </span>
        ))}
    </div>
  );
}

export const periodLabel = (p: { start: string; end?: string }) =>
  `${fmtDate(p.start)} ~ ${p.end ? fmtDate(p.end) : '진행 중'}`;

export const SERVER_ENV_LABEL = { dev: 'Dev', stage: 'Stage', prod: 'Prod' } as const;

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`qc-mono ${className}`}>{children}</span>;
}

/** 실행 중 / 일시정지 표시 (아이콘 + 글자). 일시정지면 이유를 붙인다 (F-DB-07) */
/** 지금 시각 (ms). 화면에 떠 있는 동안 주기적으로 갱신한다 — 데이터가 바뀌지 않아도 "호스트 연결 끊김"이 보이게 */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** stale: 실행 중인데 호스트 신호가 끊긴 Run (F-DV-04, isRunStale) */
export function RunState({ paused, reason, stale }: { paused: boolean; reason?: PauseReason; stale?: boolean }) {
  if (stale && !paused)
    return (
      <span
        className={`qs-row ${textClass('caption1', 'medium')}`}
        style={{ gap: token('space-2'), color: token('foreground-cautionary-primary') }}
      >
        <Icons.IconTriangleExclamation aria-hidden />
        호스트 연결 끊김
      </span>
    );
  return (
    <span
      className={`qs-row ${textClass('caption1', 'medium')}`}
      style={{
        gap: token('space-2'),
        color: paused ? token('foreground-neutral-secondary') : token('foreground-brand-primary'),
      }}
    >
      {paused ? <Icons.IconPause aria-hidden /> : <Icons.IconPlay aria-hidden />}
      {paused ? `일시정지${reason ? ` · ${PAUSE_REASON_LABEL[reason]}` : ''}` : '실행 중'}
    </span>
  );
}

/** 0~1 → "92.3%" 와 함께 큰 숫자 */
export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="qs-stat">
      <span className={`${textClass('label2', 'medium')} qs-faint`}>{label}</span>
      <span className={`${textClass('heading2', 'bold')} qs-big`}>{value}</span>
      {sub && <span className={`${textClass('caption1')} qs-muted`}>{sub}</span>}
    </div>
  );
}

export const traceUrl = (projectId: string, cycleId: string, tcId: string, deviceId: string) =>
  `/p/${projectId}/cycles/${cycleId}/results/${encodeURIComponent(tcId)}/${encodeURIComponent(deviceId)}`;

/** 탭 본문 래퍼 (탭 목록과 간격) */
export function TabBody({ children }: { children: ReactNode }) {
  return <div className="qs-stack">{children}</div>;
}
