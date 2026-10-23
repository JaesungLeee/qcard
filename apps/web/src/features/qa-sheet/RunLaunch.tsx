// 웹에서 내 호스트로 Run 시작: 요청을 작업(kind `run_cycle`)으로 남기면 내 PC의 호스트 에이전트가 받아
// 로컬 콘솔의 [실행]과 같은 경로로 시작한다. 진행은 이 화면(실시간 구독)과 PC의 로컬 콘솔에서 본다.
import type { RunCycleJob } from '@qcard/shared';
import { Button, SectionMessage, textClass } from '@qcard/ui';
import type { CycleDetail } from '../../data/api';
import { useApi, useJobs, useMyHosts, useMyRole, useRequestRun } from '../../data/hooks';
import { runLaunch } from './model';
import { useNow } from './parts';

/** 방금 끝난 요청의 결과를 보여 주는 시간 */
const RECENT_MS = 10 * 60_000;

function useRunLaunch(d: CycleDetail, projectId: string) {
  const api = useApi();
  const role = useMyRole(projectId);
  const hosts = useMyHosts();
  const jobs = useJobs(projectId);
  const request = useRequestRun(projectId);
  const now = useNow();
  const canEdit = role.data === 'admin' || role.data === 'qa';
  const usable = canEdit && d.cycle.origin !== 'local_run' && !d.cycle.period.end && !hosts.isPending;
  const latest = (jobs.data ?? []).find(
    (j): j is RunCycleJob =>
      j.kind === 'run_cycle' && j.input.cycleId === d.cycle.id && j.requestedBy === api.currentUid,
  );
  const pending = request.isPending || latest?.status === 'queued' || latest?.status === 'running';
  const recent = latest?.finishedAt && now - Date.parse(latest.finishedAt) < RECENT_MS ? latest : undefined;
  return { usable, launch: runLaunch(d, hosts.data ?? [], api.currentUser, now), pending, recent, request };
}

/** 페이지 머리의 [내 호스트에서 실행] */
export function RunLaunchActions({ d, projectId }: { d: CycleDetail; projectId: string }) {
  const { usable, launch, pending, request } = useRunLaunch(d, projectId);
  if (!usable) return null;
  const note = (text: string) => <span className={`${textClass('caption1')} qs-muted`}>{text}</span>;
  if (launch.state === 'no_host') return note('내 호스트 에이전트가 꺼져 있어 웹에서 실행할 수 없습니다');
  if (launch.state === 'no_device') {
    return note(
      launch.devices.length
        ? `내 호스트의 폰(${launch.devices.join(', ')})은 이 사이클 대상이 아닙니다`
        : '내 호스트에 연결된 폰이 없습니다',
    );
  }
  if (launch.state === 'running') return note(`내 호스트(${launch.host.name})에서 실행 중입니다`);
  const start = (resumeRunId?: string) =>
    request.mutate({ cycleId: d.cycle.id, deviceId: launch.target.id, ...(resumeRunId ? { resumeRunId } : {}) });
  return (
    <>
      {launch.paused && (
        <Button
          size="small"
          variant="outlined"
          color="assistive"
          disabled={pending}
          onClick={() => start(launch.paused!.id)}
        >
          이어서 실행
        </Button>
      )}
      <Button
        size="small"
        variant="solid"
        color="primary"
        disabled={pending || launch.remaining === 0}
        loading={pending}
        onClick={() => start()}
      >
        {launch.remaining ? `내 호스트에서 실행 · 남은 ${launch.remaining}건` : '남은 케이스 없음'}
      </Button>
    </>
  );
}

/** 요청 결과: 호스트 대기·시작함·시작하지 못함 */
export function RunLaunchMessage({ d, projectId }: { d: CycleDetail; projectId: string }) {
  const { usable, launch, pending, recent, request } = useRunLaunch(d, projectId);
  if (!usable) return null;
  const device = launch.state === 'ready' || launch.state === 'running' ? launch.target.label : '';
  if (pending) {
    return (
      <SectionMessage variant="info" description="PC가 켜져 있고 호스트 에이전트가 실행 중이면 곧 시작합니다.">
        내 호스트가 요청을 받기를 기다리는 중입니다{device ? ` · ${device}` : ''}
      </SectionMessage>
    );
  }
  if (request.isError) {
    return (
      <SectionMessage variant="negative" description={request.error.message}>
        실행을 요청하지 못했습니다
      </SectionMessage>
    );
  }
  if (recent?.status === 'failed') {
    return (
      <SectionMessage variant="negative" description={recent.error?.message}>
        내 호스트가 Run을 시작하지 못했습니다
      </SectionMessage>
    );
  }
  if (recent?.status === 'done') {
    return (
      <SectionMessage
        variant="positive"
        description="진행은 이 화면에 실시간으로 보입니다. 수동 스텝·Take over는 PC의 로컬 콘솔에서 합니다."
      >
        내 호스트에서 Run을 시작했습니다{recent.result ? ` (${recent.result.runId})` : ''}
      </SectionMessage>
    );
  }
  return null;
}
