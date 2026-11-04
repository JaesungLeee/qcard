// 로컬 콘솔 (docs/product/console.md). 실제 제품에서는 실행자 Mac의 호스트 에이전트가 localhost로 띄우는 화면이다.
// 지금은 웹 앱의 `/console`에서 fixture 세션을 재생한다. `?at=<스텝>|end|done`이면 그 상태에서 멈춘다.
import type { ConsoleQueueItem, ConsoleSession } from '@qcard/fixtures';
import { POINT_METHOD_LABEL, type ConsoleControl } from '@qcard/shared';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { QueryState } from '../../components/QueryState';
import { useConsoleSession } from '../../data/hooks';
import { MockScreen } from '../../mock/MockScreen';
import { CasePanel, StepTimeline, UsageCard } from './CasePanel';
import { DeviceStage } from './DeviceStage';
import { DeviceInfo, QueuePanel } from './QueuePanel';
import { StatusBanner } from './StatusBanner';
import { ThoughtLog, type LogEntry } from './ThoughtLog';
import { TopBar } from './TopBar';
import './console.css';
import {
  MANUAL_TIMEOUT_MS,
  VERIFY_MS,
  caseTokens,
  controlAction,
  elapsedMs,
  makeScript,
  parseAt,
  stepAt,
  verifiedCount,
  visibleThoughts,
  type JumpTarget,
} from './playback';
import { usePlayback } from './usePlayback';

export function ConsolePage() {
  const query = useConsoleSession();
  const [params] = useSearchParams();
  const at = parseAt(params.get('at'));
  return <QueryState query={query}>{(session) => <Console key={String(at)} session={session} at={at} />}</QueryState>;
}

function Console({ session, at }: { session: ConsoleSession; at: JumpTarget | undefined }) {
  const { current } = session;
  const script = useMemo(
    () => makeScript(current.steps, current.pauseAt, current.thoughts),
    [current.steps, current.pauseAt, current.thoughts],
  );
  const [state, dispatch] = usePlayback(script, at);
  const { phase } = state;

  const curIndex = stepAt(script, state.t);
  const step = current.steps.find((s) => s.index === curIndex) ?? current.steps[0]!;
  const points = current.case.verificationPoints;
  const verified = verifiedCount(state, points.length);
  const ended = phase === 'verifying' || phase === 'done';

  const log = useMemo<LogEntry[]>(() => {
    const manual = new Set(current.steps.filter((s) => s.action === 'manual').map((s) => s.index));
    // 수동 스텝의 "act" 줄은 Agent가 아니라 실행자가 하는 일이라 로그에서 뺀다
    const base = visibleThoughts(current.thoughts, state).filter((x) => !(x.kind === 'act' && manual.has(x.stepIndex)));
    if (!ended) return base;
    // [완료] 이후: 검증 포인트 판정 로그 (fixture에 없어서 케이스의 검증 포인트로 만든다)
    const t0 = state.t + state.waitMs;
    const verifyIdx = current.pauseAt + 1;
    const extra: LogEntry[] = [
      {
        at: t0 + 100,
        stepIndex: verifyIdx,
        kind: 'observe',
        text: '화면: 메이트 초대 — 공유 시트 닫힘, 메이트 초대 스텝 유지',
      },
      ...points.slice(0, verified).map<LogEntry>((p, i) => ({
        at: t0 + ((i + 1) * VERIFY_MS) / (points.length + 1),
        stepIndex: verifyIdx,
        kind: 'verify',
        text: `${p.expected} — ${POINT_METHOD_LABEL[p.method]}에서 대상 요소 확인 · 일치`,
      })),
    ];
    if (phase === 'done' && state.verdict === 'pass')
      extra.push({
        at: t0 + VERIFY_MS,
        stepIndex: verifyIdx,
        kind: 'system',
        text: `판정 Pass — 검증 포인트 ${points.length}/${points.length} 일치. 다음 케이스를 준비합니다`,
      });
    return [...base.filter((x) => x.at <= t0), ...extra, ...base.filter((x) => x.at > t0)];
  }, [current, state, ended, phase, points, verified]);

  const queue = useMemo<ConsoleQueueItem[]>(
    () =>
      session.queue.map((q) =>
        q.tcId === current.tcId && phase === 'done' ? { ...q, status: 'done', verdict: state.verdict } : q,
      ),
    [session.queue, current.tcId, phase, state.verdict],
  );
  const next = queue.find((q) => q.status === 'pending');

  const onControl = (a: ConsoleControl) => dispatch(controlAction(a));
  // 케이스가 끝난 뒤 보일 화면 (수동 스텝 이후 화면은 fixture에 없어 앞 화면으로 대신한다)
  const afterScreen = current.steps.find((s) => s.index === current.pauseAt - 1)?.screenshot;

  const decides = log.filter((x) => x.kind === 'decide').length;
  const tokens = caseTokens(decides, verified);

  return (
    <div className="qcc">
      <TopBar
        session={{ ...session, executor: session.run.executor, host: { connected: true, label: 'localhost:7420' } }}
      />
      <main className="qcc-main">
        <StatusBanner
          view={{ ...state, manualLeftMs: MANUAL_TIMEOUT_MS - state.waitMs }}
          onControl={onControl}
          step={step}
          caseStepText={step.caseStepIndex !== undefined ? current.case.steps[step.caseStepIndex]?.text : undefined}
          verified={verified}
          pointCount={points.length}
          next={next}
        />
        <div className="qcc-body">
          <div className="qcc-col-device">
            <DeviceStage
              phase={phase}
              elapsedMs={elapsedMs(state)}
              stepNo={step.index}
              stepCount={current.steps.length}
              canSkip={step.action !== 'manual'}
              onControl={onControl}
              screen={(width) => (
                <MockScreen
                  screenshot={
                    afterScreen && (phase === 'done' || phase === 'verifying') ? afterScreen : step.screenshot
                  }
                  width={width}
                  // 액션 오버레이는 Agent가 누르려는 순간에만 보인다 (수동·Take over 중에는 사람이 조작한다)
                  action={(phase === 'running' || phase === 'paused') && step.action !== 'manual' ? step : undefined}
                  label={`${step.index}번 스텝 화면`}
                />
              )}
            />
          </div>
          <div className="qcc-col-detail">
            <CasePanel tc={current.case} step={step} phase={phase} verified={verified} />
            <StepTimeline steps={current.steps} current={curIndex} ended={ended} />
            <ThoughtLog entries={log} steps={current.steps} live={state.live} />
          </div>
          <aside className="qcc-col-queue">
            <DeviceInfo device={session.device} />
            <UsageCard
              caseTokens={tokens}
              limit={session.usage.caseTokenLimit}
              runTokens={session.usage.tokens + tokens}
              costUsd={session.usage.costUsd + tokens * 0.0000042}
              stepNo={curIndex}
              stepLimit={current.case.steps.length * 3 + 10}
            />
            <QueuePanel queue={queue} aborted={phase === 'aborted'} />
          </aside>
        </div>
      </main>
    </div>
  );
}
