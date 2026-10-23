import type { ConsoleDevice, ConsoleQueueItem } from '@qcard/fixtures';
import type { Verdict } from '@qcard/shared';
import { Icons, VerdictBadge, textClass, token } from '@qcard/ui';
import { useEffect, useRef } from 'react';

/** 실행 큐 (F-EX-11: 계정 역할·준비 상태가 같은 케이스끼리 묶인 실행 순서 그대로) */
export function QueuePanel({ queue, aborted }: { queue: ConsoleQueueItem[]; aborted: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const done = queue.filter((q) => q.status === 'done').length;
  const counts = new Map<Verdict, number>();
  for (const q of queue) if (q.verdict) counts.set(q.verdict, (counts.get(q.verdict) ?? 0) + 1);
  const focusIdx = Math.max(
    0,
    queue.findIndex((q) => q.status === 'running'),
    queue.findIndex((q) => q.status === 'pending') - 1,
  );

  // 현재 케이스가 보이게 큐 안에서만 스크롤한다 (페이지는 움직이지 않는다)
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[focusIdx] as HTMLElement | undefined;
    if (list && row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
  }, [focusIdx]);

  return (
    <section className="qcc-card qcc-queue" aria-label="실행 큐">
      <div className="qcc-queue-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
            실행 큐
          </h2>
          <span className={`${textClass('label1', 'medium')} qcc-mono`} style={{ marginLeft: 'auto' }}>
            {done}
            <span className="qcc-faint"> / {queue.length}</span>
          </span>
        </div>
        <div className="qcc-bar" role="progressbar" aria-valuenow={done} aria-valuemax={queue.length}>
          <span style={{ width: `${(done / queue.length) * 100}%`, background: token('surface-brand-primary') }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['pass', 'fail', 'blocked', 'check', 'nt', 'na'] as Verdict[])
            .filter((v) => counts.get(v))
            .map((v) => (
              <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <VerdictBadge verdict={v} />
                <span className={`${textClass('label2', 'medium')} qcc-mono`}>{counts.get(v)}</span>
              </span>
            ))}
          <span className={`${textClass('label2')} qcc-muted`} style={{ marginLeft: 'auto' }}>
            대기 {queue.filter((q) => q.status === 'pending').length}
          </span>
        </div>
      </div>
      <ol className="qcc-queue-list" ref={listRef}>
        {queue.map((q, i) => (
          <li key={q.tcId} className={`qcc-qrow is-${q.status}`} aria-current={q.status === 'running' || undefined}>
            <span className={`${textClass('caption1')} qcc-mono qcc-faint`}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span className={`qcc-qtitle ${textClass('label2', q.status === 'running' ? 'bold' : 'medium')}`}>
                {q.title}
              </span>
              <span
                className={`${textClass('caption2')} qcc-mono qcc-faint`}
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
              >
                {q.tcId}
                {q.mode === 'manual' && (
                  <span className={`qcc-tag is-manual ${textClass('caption2', 'medium')}`}>수동</span>
                )}
              </span>
            </span>
            <QueueStatus item={q} aborted={aborted} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function QueueStatus({ item, aborted }: { item: ConsoleQueueItem; aborted: boolean }) {
  if (item.verdict) return <VerdictBadge verdict={item.verdict} short />;
  if (item.status === 'running')
    return (
      <span
        className={textClass('caption1', 'bold')}
        style={{
          color: token(aborted ? 'foreground-negative-primary' : 'foreground-brand-primary'),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {aborted ? '중단' : '실행 중'}
      </span>
    );
  return <span className={`${textClass('caption1')} qcc-faint`}>대기</span>;
}

/** 연결된 디바이스 정보 (F-DV-03) */
export function DeviceInfo({ device }: { device: ConsoleDevice }) {
  return (
    <section className="qcc-card" aria-label="디바이스">
      <div className="qcc-card-head" style={{ marginBottom: 10 }}>
        <Icons.IconAndroid
          aria-hidden
          style={{ width: 18, height: 18, color: token('foreground-neutral-secondary') }}
        />
        <span className={textClass('label1', 'bold')}>{device.model}</span>
        <span className={`${textClass('caption1')} qcc-muted`}>
          {device.connection}
          {device.battery !== undefined && ` · 배터리 ${device.battery}%`}
        </span>
      </div>
      <dl className={`qcc-kv ${textClass('label2')}`}>
        <dt>시리얼</dt>
        <dd className="qcc-mono">{device.serial}</dd>
        <dt>OS</dt>
        <dd>Android {device.osBuild}</dd>
        <dt>해상도</dt>
        <dd className="qcc-mono">{device.resolution}</dd>
      </dl>
    </section>
  );
}
