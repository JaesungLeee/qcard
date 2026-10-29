// 실시간 로컬 콘솔 (PRD §5.7): 호스트 에이전트(serve·run-cycle)가 띄운 127.0.0.1 서버에서 연다.
// 개발 중에는 Vite 개발 서버가 /console-api를 호스트로 넘긴다. Run이 없으면 홈(사이클 골라 Run 시작),
// Run 중이면 실행 화면. 상태는 호스트가 밀어 주고 화면은 제어·Run 시작만 보낸다.
import { DEVICE_SIZE, SCREENS, type ConsoleSession } from '@qcard/fixtures';
import type { ConsoleApproval, ConsoleHome, ConsolePhase, ExecStep, LiveConsole } from '@qcard/shared';
import { Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { fmtTs } from '../../../components/format';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { QueryState } from '../../../components/QueryState';
import { useConsoleSession } from '../../../data/hooks';
import { MockScreen } from '../../../mock/MockScreen';
import { CasePanel, StepTimeline, UsageCard } from '../CasePanel';
import { DeviceStage } from '../DeviceStage';
import { DeviceInfo, QueuePanel } from '../QueuePanel';
import { StatusBanner } from '../StatusBanner';
import { ThoughtLog } from '../ThoughtLog';
import { TopBar } from '../TopBar';
import '../console.css';
import { Home } from './Home';
import { LiveScreen } from './LiveScreen';
import { useLiveConsole, type HostLink } from './useLiveConsole';

export function LiveConsolePage() {
  const [params] = useSearchParams();
  const demo = params.get('demo');
  return demo ? <Demo demo={demo} /> : <Connected />;
}

function Connected() {
  const c = useLiveConsole();
  const [starting, setStarting] = useState(false);
  // 실행 화면으로 넘어가거나 호스트가 거절하면 준비 표시를 끈다
  useEffect(() => {
    if (c.view?.kind === 'run' || c.error) setStarting(false);
  }, [c.view?.kind, c.error]);
  if (!c.view) return <Waiting link={c.link} />;
  if (c.view.kind === 'run')
    return <Live state={c.view.state} link={c.link} control={c.control} dashboardUrl={c.dashboardUrl} />;
  return (
    <Home
      home={c.view.home}
      link={c.link}
      dashboardUrl={c.dashboardUrl}
      error={c.error}
      starting={starting}
      onDismissError={c.dismissError}
      onStart={(r) => {
        setStarting(true);
        c.start(r);
      }}
      onRefresh={c.refresh}
    />
  );
}

/**
 * `?demo=running|manual|takeover`: 호스트 없이 fixture 세션으로 채운 화면 (UI 스냅샷용).
 * `?demo=start`: 케이스가 막 시작해 스텝이 아직 없는 상태 · `?demo=home`: Run이 없을 때 (사이클 고르기)
 * `?demo=home-outdated`: Claude Code 버전 미달로 시작을 막은 홈 · `?demo=home-limited`: 플랜 한도로 멈춘 뒤 (F-DB-09)
 * `?demo=waiting`: Agent가 모델 응답을 오래 기다리는 중
 * `?demo=approval`: 위험 액션 승인 대기 · `?demo=identity`: 사람 전용(본인인증) 대기 (F-EX-10)
 */
function Demo({ demo }: { demo: string }) {
  const query = useConsoleSession();
  return (
    <QueryState query={query}>
      {(session) => {
        if (demo === 'home' || demo.startsWith('home-')) {
          const home = demoHome(session);
          const claudeCode =
            demo === 'home-outdated'
              ? { ...home.claudeCode, version: '2.1.250', requiredVersion: '2.1.284' }
              : demo === 'home-limited'
                ? { ...home.claudeCode, limited: true }
                : home.claudeCode;
          return (
            <Home
              home={{ ...home, claudeCode }}
              link="open"
              starting={false}
              onDismissError={() => {}}
              onStart={() => {}}
              onRefresh={() => {}}
              screen={(width) => (
                <MockScreen
                  screenshot={session.current.steps[0]!.screenshot}
                  width={width}
                  label="디바이스 화면 (데모)"
                />
              )}
            />
          );
        }
        const now = Date.now();
        const base = demoState(
          session,
          demo === 'start' || demo === 'waiting'
            ? 'running'
            : demo === 'identity'
              ? 'approval'
              : (demo as ConsolePhase),
          now,
          demo === 'start' ? 0 : 3,
          demo === 'identity',
        );
        // 모델 응답을 75초째 기다리는 중
        const state = {
          ...base,
          stayAwake: true,
          ...(demo === 'waiting'
            ? {
                llmWait: {
                  since: now - 75_000,
                  limitMs: 180_000,
                  retry: { attempt: 4, maxRetries: 10, reason: 'Claude 서버 혼잡(529)' },
                },
              }
            : {}),
        };
        // 승인 대기 데모는 공유 시트에서 [메신저]를 누르려던 순간
        const shot =
          demo === 'approval'
            ? ({ kind: 'mock', screen: 'share-sheet' } as const)
            : (state.current!.steps.at(-1) ?? session.current.steps[0]!).screenshot;
        return (
          <Live
            state={state}
            link="open"
            control={() => {}}
            screen={(width) => <MockScreen screenshot={shot} width={width} label="디바이스 화면 (데모)" />}
          />
        );
      }}
    </QueryState>
  );
}

export function demoHome(session: ConsoleSession): ConsoleHome {
  const cases = session.queue
    .filter((q) => q.mode === 'auto')
    .map((q) => ({ tcId: q.tcId, title: q.title, done: q.status === 'done' }));
  return {
    executor: session.run.executor,
    device: { ...session.device, status: 'idle' },
    screen: DEVICE_SIZE,
    cycles: [
      {
        projectId: session.projectId,
        projectName: '하루콩',
        cycleId: session.cycleId,
        cycleName: session.cycleName,
        build: { version: session.build.version, buildNumber: session.build.buildNumber },
        docVersion: session.build.version,
        deviceId: 'pixel-8-16',
        cases,
        pausedRun: { id: session.run.id, reason: 'plan_limit', total: 3, left: 2 },
      },
      {
        projectId: session.projectId,
        projectName: '하루콩',
        cycleId: 'cycle-next',
        cycleName: '1.3.1 (131) 회귀',
        build: { version: '1.3.1', buildNumber: 131 },
        docVersion: '1.3.0',
        deviceId: 'pixel-8-16',
        cases: cases.map((c) => ({ ...c, done: false })),
      },
      // 로그인이 있는 가상 앱: 구독자 계정이 모두 격리돼 배정할 수 없다 (F-PF-08)
      {
        projectId: 'moabook',
        projectName: '모아북',
        cycleId: 'cycle-moa-1',
        cycleName: '2.1.0 (210) 1차',
        build: { version: '2.1.0', buildNumber: 210 },
        docVersion: '2.1.0',
        deviceId: 'pixel-8-16',
        cases: cases.map((c) => ({ ...c, done: false })),
        accountShortage: [{ kind: '구독자', cases: 3 }],
      },
    ],
    loading: false,
    claudeCode: session.claudeCode,
    lastRun: { cycleName: '1.2.1 (121) 2차', status: 'done', judged: 12 },
  };
}

export function demoState(
  session: ConsoleSession,
  phase: ConsolePhase,
  now = Date.now(),
  stepCount = 3,
  human = false,
): LiveConsole {
  const { current } = session;
  const steps = current.steps.slice(0, stepCount);
  const manualStep = current.case.steps.find((s) => s.manual);
  return {
    projectId: session.projectId,
    cycleId: session.cycleId,
    cycleName: session.cycleName,
    build: { version: session.build.version, buildNumber: session.build.buildNumber },
    runId: session.run.id,
    executor: session.run.executor,
    device: session.device,
    screen: DEVICE_SIZE,
    queue: session.queue,
    current: {
      tcId: current.tcId,
      case: current.case,
      steps,
      thoughts: current.thoughts.filter((t) => t.stepIndex <= stepCount),
      startedAt: now - 42_000,
      verified: 0,
    },
    phase,
    ...(phase === 'manual' && manualStep
      ? { manual: { instruction: manualStep.text, deadline: now + 8 * 60_000 } }
      : {}),
    ...(phase === 'approval' ? { approval: demoApproval(human, now) } : {}),
    run: { status: 'running' },
    usage: {
      tokens: session.usage.tokens,
      costUsd: session.usage.costUsd,
      caseTokens: 18_400,
      caseTokenLimit: session.usage.caseTokenLimit,
    },
    claudeCode: session.claudeCode,
  };
}

/** 1초마다 다시 그린다 (경과·남은 시간) */
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Live({
  state,
  link,
  control,
  dashboardUrl,
  screen,
}: {
  state: LiveConsole;
  link: HostLink;
  control: ReturnType<typeof useLiveConsole>['control'];
  dashboardUrl?: string;
  /** 화면을 바꿔 그린다 (데모) */
  screen?: (width: number) => ReactNode;
}) {
  const now = useNow();
  const { current, phase } = state;
  const step = current?.steps.at(-1);
  const ended = phase === 'verifying' || phase === 'done';
  const next = state.queue.find((q) => q.status === 'pending');
  const prepFlows = current?.case.prepFlowIds.length
    ? `준비 — ${current.case.cleanState ? '앱 데이터 초기화 후 ' : ''}준비 플로우 ${current.case.prepFlowIds.filter((id) => id !== 'pf-clean').join(' → ') || '없음'}`
    : '준비 — 앱 재시작';

  return (
    <div className="qcc">
      <TopBar
        session={{
          ...state,
          dashboardUrl,
          host: { connected: link === 'open', label: location.host },
        }}
      />
      <main className="qcc-main">
        <RunNotice state={state} link={link} />
        <LlmWaitNotice state={state} now={now} />
        <StatusBanner
          view={{
            phase,
            verdict: state.verdict,
            reason: state.reason,
            manualLeftMs: state.manual ? Math.max(0, state.manual.deadline - now) : undefined,
            approval: state.approval,
            approvalLeftMs: state.approval ? Math.max(0, state.approval.deadline - now) : undefined,
          }}
          onControl={control}
          step={step}
          caseStepText={state.manual?.instruction}
          verified={current?.verified ?? 0}
          pointCount={current?.case.verificationPoints.length ?? 0}
          next={next}
        />
        <div className="qcc-body">
          <div className="qcc-col-device">
            <DeviceStage
              phase={phase}
              elapsedMs={current ? now - current.startedAt : 0}
              stepNo={current?.steps.length ?? 0}
              canSkip={phase !== 'manual'}
              onControl={control}
              note={
                state.stayAwake && (
                  <>
                    <Icons.IconSun aria-hidden style={{ width: 14, height: 14 }} />
                    <span>화면 켜짐 유지 중 · Run이 끝나면 원래대로</span>
                  </>
                )
              }
              screen={
                screen ??
                ((width) => (
                  <LiveScreen
                    width={width}
                    screen={state.screen}
                    // 액션 오버레이는 Agent가 방금 한 액션을 1.5초 동안 보인다. 위험 액션 대기 중에는 누르려던 요소를 보인다
                    action={
                      phase === 'approval' && state.approval?.target
                        ? approvalTarget(state.approval)
                        : step &&
                            phase === 'running' &&
                            step.action !== 'manual' &&
                            now - (current!.startedAt + step.videoTs) < 1500
                          ? step
                          : undefined
                    }
                  />
                ))
              }
            />
          </div>
          <div className="qcc-col-detail">
            {current ? (
              <>
                <CasePanel
                  tc={current.case}
                  step={step}
                  phase={phase}
                  verified={current.verified}
                  prepText={prepFlows}
                />
                <StepTimeline steps={current.steps} current={step?.index ?? 0} ended={ended} />
                <ThoughtLog entries={current.thoughts} steps={current.steps} live />
              </>
            ) : (
              <section className="qcc-card">
                <span className={`${textClass('label1')} qcc-muted`}>첫 케이스를 준비하고 있습니다.</span>
              </section>
            )}
          </div>
          <aside className="qcc-col-queue">
            <DeviceInfo device={state.device} />
            <UsageCard
              caseTokens={state.usage.caseTokens}
              limit={state.usage.caseTokenLimit}
              runTokens={state.usage.tokens}
              costUsd={state.usage.costUsd}
              stepNo={current?.steps.length ?? 0}
              stepLimit={(current?.case.steps.length ?? 0) * 3 + 10}
            />
            <QueuePanel queue={state.queue} aborted={state.run.status === 'aborted'} />
          </aside>
        </div>
      </main>
    </div>
  );
}

/** Run이 멈췄거나 끝났을 때, 호스트 연결이 끊겼을 때 */
/** 모델 응답이 이만큼 늦으면 알린다 (보통 한 턴은 3~10초) */
export const LLM_WAIT_NOTICE_MS = 20_000;

/** Agent가 모델 응답을 오래 기다리는 중 — 실행자는 화면이 멈춘 이유를 알 수 없으므로 알린다 */
function LlmWaitNotice({ state, now }: { state: LiveConsole; now: number }) {
  const wait = state.llmWait;
  if (!wait || state.phase === 'paused' || state.phase === 'takeover') return null;
  const waited = now - wait.since;
  if (waited < LLM_WAIT_NOTICE_MS && !wait.retry) return null;
  const why = wait.retry
    ? `${wait.retry.reason}로 Claude Code가 다시 시도하고 있습니다 (${wait.retry.attempt}/${wait.retry.maxRetries}회).`
    : '이 PC의 Claude Code가 아직 응답하지 않았습니다.';
  return (
    <SectionMessage
      variant="cautionary"
      description={`${why} ${fmtTs(wait.limitMs)}이 지나면 이 케이스는 Blocked로 기록하고 다음 케이스로 넘어갑니다 (남은 시간 ${fmtTs(Math.max(0, wait.limitMs - waited))}).`}
    >
      {`Agent 응답을 기다리고 있습니다 · ${fmtTs(waited)}`}
    </SectionMessage>
  );
}

function RunNotice({ state, link }: { state: LiveConsole; link: HostLink }) {
  const msg =
    link !== 'open'
      ? '호스트 에이전트와 연결이 끊겼습니다. 다시 연결하는 중입니다'
      : state.run.status === 'paused'
        ? `Run 일시정지 — ${state.run.message ?? ''} (해결한 뒤 run-cycle … --resume ${state.runId})`
        : state.run.status === 'done'
          ? '모든 케이스를 수행했습니다. 결과는 대시보드 QA 시트에 올라갔습니다'
          : undefined;
  if (!msg) return null;
  return (
    <section className="qcc-card" role="status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Icons.IconCircleInfo
        aria-hidden
        style={{ width: 18, height: 18, color: token('foreground-neutral-secondary') }}
      />
      <span className={textClass('label1')}>{msg}</span>
    </section>
  );
}

function Waiting({ link }: { link: HostLink }) {
  return (
    <div className="qcc" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <section className="qcc-card" style={{ maxWidth: 480 }}>
        <h1 className={textClass('headline2', 'bold')} style={{ margin: '0 0 8px' }}>
          qcard 로컬 콘솔
        </h1>
        <p className={`${textClass('body2-reading')} qcc-muted`} style={{ margin: 0 }}>
          {link === 'unauthorized'
            ? '호스트 에이전트에 연결할 수 없습니다. 실행 중인 run-cycle이 터미널에 출력한 주소로 다시 여세요 (주소는 한 번만 쓸 수 있습니다).'
            : '호스트 에이전트에 연결하는 중입니다…'}
        </p>
      </section>
    </div>
  );
}

/** 승인 대기 중인 액션을 오버레이로 (아직 실행하지 않은 탭) */
function approvalTarget(a: ConsoleApproval): ExecStep {
  return {
    index: 0,
    action: 'tap',
    target: a.target,
    intent: a.action,
    screenshot: { kind: 'url', url: '' },
    videoTs: 0,
    durationMs: 0,
  };
}

/** 데모 위험 액션: 공유 시트에서 메신저로 보내기(승인 필요) · 본인인증(사람 전용) */
function demoApproval(human: boolean, now: number): ConsoleApproval {
  const messenger = SCREENS['share-sheet']!.elements.find((e) => e.id === 'share_messenger')!;
  return human
    ? {
        kind: 'identity',
        level: 'human',
        reason: '휴대폰 본인인증 화면',
        source: 'guard',
        action: '탭 · 인증번호 받기',
        deadline: now + 8 * 60_000,
      }
    : {
        kind: 'people',
        level: 'approval',
        reason: '메신저로 실제 초대 링크가 간다',
        source: 'guard',
        action: '탭 · 메신저',
        target: { label: '메신저', bounds: messenger.bounds },
        deadline: now + 8 * 60_000,
      };
}
