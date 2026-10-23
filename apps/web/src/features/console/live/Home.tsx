import { PAUSE_REASON_LABEL, type ConsoleCycleOption, type ConsoleHome, type PauseReason } from '@qcard/shared';
import { Button, Checkbox, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { useState, type ReactNode } from 'react';
import { useScreenWidth } from '../DeviceStage';
import { DeviceInfo } from '../QueuePanel';
import { TopBar } from '../TopBar';
import { LiveScreen } from './LiveScreen';
import type { HostLink, StartRun } from './useLiveConsole';

/**
 * 로컬 콘솔 홈 (Run이 없을 때, PRD §4 ⑤): 연결된 디바이스 화면을 실시간으로 보여 주고,
 * 이 디바이스가 대상인 사이클을 골라 Run을 시작하거나 일시정지된 Run을 이어서 실행한다.
 */
export function Home({
  home,
  link,
  error,
  starting,
  onDismissError,
  onStart,
  onRefresh,
  screen,
}: {
  home: ConsoleHome;
  link: HostLink;
  error?: string;
  /** [Run 시작]을 눌러 호스트가 준비하는 중 (빌드 설치 등) */
  starting: boolean;
  onDismissError: () => void;
  onStart: (r: StartRun) => void;
  onRefresh: () => void;
  /** 화면을 바꿔 그린다 (데모) */
  screen?: (width: number) => ReactNode;
}) {
  const width = useScreenWidth();
  const { device } = home;
  const canStart = link === 'open' && !!device && !home.deviceProblem && !starting;
  return (
    <div className="qcc">
      <TopBar
        session={{
          executor: home.executor,
          device,
          claudeCode: home.claudeCode,
          host: { connected: link === 'open', label: location.host },
        }}
      />
      <main className="qcc-main">
        <Notices home={home} link={link} error={error} starting={starting} onDismissError={onDismissError} />
        <div className="qcc-body">
          <div className="qcc-col-device">
            <section className="qcc-card qcc-device" aria-label="디바이스 화면">
              <div className="qcc-device-status">
                <span className={`${textClass('label2', 'medium')} qcc-muted`}>
                  {device ? '대기 — Run을 시작하면 Agent가 조작합니다' : '디바이스 연결 대기'}
                </span>
              </div>
              {device && home.screen ? (
                (screen ?? ((w) => <LiveScreen width={w} screen={home.screen!} />))(width)
              ) : (
                <div className={`${textClass('label1')} qcc-muted`} style={{ padding: 24, textAlign: 'center' }}>
                  USB로 Android 디바이스를 연결하고 USB 디버깅을 허용하세요. 30초 안에 알아챕니다.
                </div>
              )}
            </section>
          </div>
          <div className="qcc-col-detail">
            <CycleList home={home} canStart={canStart} onStart={onStart} onRefresh={onRefresh} />
          </div>
          <aside className="qcc-col-queue">{device && <DeviceInfo device={device} />}</aside>
        </div>
      </main>
    </div>
  );
}

function Notices({
  home,
  link,
  error,
  starting,
  onDismissError,
}: {
  home: ConsoleHome;
  link: HostLink;
  error?: string;
  starting: boolean;
  onDismissError: () => void;
}) {
  const last = home.lastRun;
  return (
    <>
      {link !== 'open' && (
        <SectionMessage
          variant="negative"
          description="다시 연결하는 중입니다. 호스트 에이전트(serve)가 켜져 있는지 확인하세요."
        >
          호스트 에이전트와 연결이 끊겼습니다
        </SectionMessage>
      )}
      {error && (
        <SectionMessage variant="negative" description={error}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            Run을 시작하지 못했습니다
            <Button size="small" variant="outlined" color="assistive" onClick={onDismissError}>
              닫기
            </Button>
          </span>
        </SectionMessage>
      )}
      {starting && (
        <SectionMessage variant="info" description="사이클 빌드가 디바이스와 다르면 내려받아 설치합니다.">
          Run을 준비하고 있습니다
        </SectionMessage>
      )}
      {home.deviceProblem && (
        <SectionMessage variant="cautionary" description={home.deviceProblem}>
          디바이스를 쓸 수 없는 상태입니다
        </SectionMessage>
      )}
      {home.notice && (
        <SectionMessage variant="info" description={home.notice}>
          폰 설정을 되돌렸습니다
        </SectionMessage>
      )}
      {home.busy && (
        <SectionMessage
          variant="info"
          description="이 PC의 Claude Code를 함께 씁니다. Run은 그대로 시작할 수 있습니다."
        >
          {home.busy}
        </SectionMessage>
      )}
      {last && (
        <SectionMessage
          variant={last.status === 'done' ? 'positive' : 'cautionary'}
          description={
            last.status === 'done'
              ? `${last.judged}케이스를 판정했습니다. 결과는 대시보드 QA 시트에 올라갔습니다.`
              : last.status === 'paused'
                ? `${last.message ?? ''} — 해결한 뒤 아래에서 [이어서 실행]을 누르세요.`
                : `${last.judged}케이스를 판정했습니다. 남은 칸은 N/T로 남습니다.${last.message ? ` (${last.message})` : ''}`
          }
        >
          {`지난 Run · ${last.cycleName} · ${last.status === 'done' ? '완료' : last.status === 'paused' ? '일시정지' : '중단됨'}`}
        </SectionMessage>
      )}
    </>
  );
}

function CycleList({
  home,
  canStart,
  onStart,
  onRefresh,
}: {
  home: ConsoleHome;
  canStart: boolean;
  onStart: (r: StartRun) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="qcc-card" aria-label="사이클 선택">
      <div className="qcc-card-head" style={{ justifyContent: 'space-between' }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          Run 시작
        </h2>
        <Button
          size="small"
          variant="outlined"
          color="assistive"
          leadingContent={<Icons.IconRefresh aria-hidden />}
          onClick={onRefresh}
          disabled={home.loading}
        >
          {home.loading ? '불러오는 중' : '새로고침'}
        </Button>
      </div>
      <p className={`${textClass('label2')} qcc-muted`} style={{ margin: '0 0 12px' }}>
        Run을 시작할 때 폰 잠금이 풀려 있어야 합니다. Run 동안은 폰의 &lsquo;충전 중 화면 켜짐 유지&rsquo;를 켜서 도중에
        잠기지 않게 하고, 끝나면 원래대로 되돌립니다.
      </p>
      {!home.device ? (
        <p className={`${textClass('label1')} qcc-muted`} style={{ margin: 0 }}>
          디바이스를 연결하면 그 디바이스가 대상인 사이클이 보입니다.
        </p>
      ) : home.cycles.length === 0 ? (
        <p className={`${textClass('label1')} qcc-muted`} style={{ margin: 0 }}>
          {home.loading
            ? '사이클을 불러오는 중입니다…'
            : `${home.device.model} (Android ${home.device.osBuild.split(' ')[0]})가 대상인 사이클이 없습니다. 웹에서 사이클을 만들 때 대상에 이 디바이스를 넣으세요.`}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {home.cycles.map((c) => (
            <CycleCard key={`${c.projectId}/${c.cycleId}`} cycle={c} canStart={canStart} onStart={onStart} />
          ))}
        </div>
      )}
    </section>
  );
}

function CycleCard({
  cycle: c,
  canStart,
  onStart,
}: {
  cycle: ConsoleCycleOption;
  canStart: boolean;
  onStart: (r: StartRun) => void;
}) {
  const remaining = c.cases.filter((x) => !x.done);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const ref = { projectId: c.projectId, cycleId: c.cycleId };
  return (
    <article
      style={{
        border: `1px solid ${token('line-neutral-secondary')}`,
        borderRadius: token('radius-8'),
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div>
        <div className={textClass('label1', 'bold')}>{c.cycleName}</div>
        <div className={`${textClass('label2')} qcc-muted`}>
          {c.projectName} · 빌드 <span className="qcc-mono">{`${c.build.version} (${c.build.buildNumber})`}</span> · QA
          문서 {c.docVersion}
        </div>
      </div>
      <div className={textClass('label2')}>
        자동 케이스 남은 <span className="qcc-mono">{remaining.length}</span> / 전체{' '}
        <span className="qcc-mono">{c.cases.length}</span>
      </div>
      {c.pausedRun && (
        <SectionMessage
          variant="cautionary"
          description={`사유: ${c.pausedRun.reason ? (PAUSE_REASON_LABEL[c.pausedRun.reason as PauseReason] ?? c.pausedRun.reason) : '알 수 없음'} · 결과가 있는 칸은 건너뜁니다`}
        >
          일시정지된 Run이 있습니다
        </SectionMessage>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {c.pausedRun && (
          <Button
            size="small"
            variant="solid"
            color="primary"
            disabled={!canStart}
            onClick={() => onStart({ ...ref, resumeRunId: c.pausedRun!.id })}
          >
            이어서 실행
          </Button>
        )}
        <Button
          size="small"
          variant={c.pausedRun ? 'outlined' : 'solid'}
          color={c.pausedRun ? 'assistive' : 'primary'}
          disabled={!canStart || remaining.length === 0}
          onClick={() => onStart(ref)}
        >
          {remaining.length ? `남은 ${remaining.length}건 실행` : '남은 케이스 없음'}
        </Button>
        <Button size="small" variant="outlined" color="assistive" onClick={() => setPicking((v) => !v)}>
          {picking ? '케이스 고르기 닫기' : '케이스 고르기'}
        </Button>
      </div>
      {picking && (
        <div style={{ display: 'grid', gap: 4 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflow: 'auto' }}>
            {c.cases.map((x) => {
              const id = `pick-${c.cycleId}-${x.tcId}`;
              return (
                <li key={x.tcId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <Checkbox
                    id={id}
                    size="small"
                    checked={picked.has(x.tcId)}
                    onCheckedChange={(on) => toggle(x.tcId, on)}
                  />
                  <label htmlFor={id} className={textClass('label2')} style={{ minWidth: 0, flex: 1 }}>
                    <span className="qcc-mono qcc-muted">{x.tcId}</span> {x.title}
                    {x.done && <span className="qcc-faint"> · 결과 있음 (다시 실행)</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              size="small"
              variant="solid"
              color="primary"
              disabled={!canStart || picked.size === 0}
              onClick={() => onStart({ ...ref, tcIds: [...picked] })}
            >
              {`고른 ${picked.size}건 실행`}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
