import { RUN_HEARTBEAT_MS, RUN_STALE_MS, type CellSkip } from '@qcard/shared';

/*
 * 칸 자동 선점 (F-CY-06). 케이스를 시작하기 전에 "케이스 × 대상 디바이스" 칸을 Functions(claimCell) 트랜잭션으로 잡는다.
 * 같은 대상 디바이스의 다른 Run이 잡은 칸·완료된 칸은 건너뛴다. 잡은 칸은 Run 문서의 `currentTcId`로 남아 웹에 "실행 중"으로 보인다.
 * 업로드 큐를 거치지 않는 온라인 호출이다 — 잡기 전에 큐를 비워 앞 케이스 결과가 먼저 올라가게 한다(runCycle).
 */

export type CellClaimInput = { projectId: string; cycleId: string; runId: string; tcId: string; rerun: boolean };

export interface CellClaimer {
  claim(input: CellClaimInput): Promise<{ claimed: true } | { claimed: false; skip: CellSkip }>;
}

export const callableClaimer = (call: <T>(name: string, data: unknown) => Promise<T>): CellClaimer => ({
  claim: (input) => call('claimCell', input),
});

/**
 * 마지막으로 보낸 연결 신호가 이만큼 지나면 칸을 잃은 것으로 본다. 다른 Run은 RUN_STALE_MS가 지나야 가져가지만,
 * 신호 한 번만큼 먼저 멈춘다 (PC 간 시계 차이·요청 지연 여유)
 */
export const LEASE_LOST_MS = RUN_STALE_MS - RUN_HEARTBEAT_MS;

/**
 * 이 Run이 잡은 칸의 리스: 마지막으로 남긴 연결 신호(잡기 포함)의 시각으로 칸을 잃었는지 본다.
 * 한 번 잃으면 다음 칸을 잡을 때까지 잃은 채로 둔다 — 절전에서 깨어나 신호가 다시 성공해도, 자는 동안 다른 Run이 가져갔을 수 있다
 */
export class CellLease {
  private signaledAt: number;
  private gone = false;

  /** now: 실제 시각 (Agent의 가짜 시계와 따로) */
  constructor(private readonly now: () => number = Date.now) {
    this.signaledAt = now();
  }

  lost(): boolean {
    if (!this.gone && this.now() - this.signaledAt > LEASE_LOST_MS) this.gone = true;
    return this.gone;
  }

  /** 연결 신호를 보낸다. 보내기 전에 이미 오래 끊겼으면 보내기에 성공해도 잃은 채로 둔다. 실패하면 던진다 */
  async beat(send: () => Promise<void>): Promise<void> {
    const at = this.now();
    this.lost();
    await send();
    if (!this.gone) this.signaledAt = at;
  }

  /** 칸을 잡았다 (서버가 연결 신호도 남긴다). at: 잡기를 보낸 시각 */
  claimed(at: number) {
    this.signaledAt = at;
    this.gone = false;
  }
}

/** 건너뛴 이유 (로그·콘솔) */
export const skipText = (s: CellSkip) =>
  s.reason === 'running' ? `${s.executor}님이 실행 중` : '이미 결과가 있음';
