import type { CellSkip } from '@qcard/shared';

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

/** 건너뛴 이유 (로그·콘솔) */
export const skipText = (s: CellSkip) =>
  s.reason === 'running' ? `${s.executor}님이 실행 중` : '이미 결과가 있음';
