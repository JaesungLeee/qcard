import { cellSkip, requireEditor, type CaseResult, type CellSkip, type Run } from '@qcard/shared';
import { z } from 'zod';
import { fail, membersIn, nowOf, parse, ProjectId, type Ctx } from './handlers';

/*
 * 칸 자동 선점. 규칙은 @qcard/shared cycles(cellSkip).
 * 잠금은 Run 문서의 `currentTcId`다 — 웹 진행 매트릭스가 그대로 "실행 중" 칸으로 보인다. 값을 정하는 건 여기뿐이고
 * 호스트는 지우기만 한다(보안 규칙). 잠금은 따로 풀지 않는다: 케이스가 끝나면 결과가 칸을 "완료"로 만들고 다음 칸을 잡으며 바뀐다.
 * Run이 끝나면 호스트가 지우고, 일시정지·연결 끊김(신호 만료)이면 holdsCell이 놓은 것으로 본다.
 */

const ClaimCellInput = ProjectId.extend({
  cycleId: z.string().min(1),
  runId: z.string().min(1),
  tcId: z.string().min(1),
  /** 완료된 칸을 일부러 고름 */
  rerun: z.boolean(),
});

/**
 * 케이스를 시작하기 전에 호스트가 부른다: 자기 사용자가 실행 중인 Run에서만. 잡으면 `currentTcId`·연결 신호를 남긴다.
 * 같은 대상 디바이스의 Run들과 그 칸의 결과를 트랜잭션에서 읽어, 두 Run이 동시에 잡으려 하면 하나만 잡는다
 */
export async function claimCell(ctx: Ctx, data: unknown): Promise<{ claimed: true } | { claimed: false; skip: CellSkip }> {
  if (!ctx.host) throw fail('permission', '칸은 실행 중인 호스트만 잡을 수 있습니다.');
  const input = parse(ClaimCellInput, data);
  const now = nowOf(ctx);
  const cycle = ctx.db.doc(`projects/${input.projectId}/cycles/${input.cycleId}`);
  const runRef = cycle.collection('runs').doc(input.runId);
  return ctx.db.runTransaction(async (tx) => {
    const run = (await tx.get(runRef)).data() as Run | undefined;
    if (!run || run.executorUid !== ctx.uid || run.status !== 'running') {
      throw fail('permission', '내가 실행 중인 Run에서만 칸을 잡을 수 있습니다.');
    }
    requireEditor(await membersIn(tx, ctx.db, input.projectId), ctx.uid);
    const runs = (await tx.get(cycle.collection('runs').where('deviceId', '==', run.deviceId))).docs.map(
      (d) => d.data() as Run,
    );
    const result = (await tx.get(cycle.collection('results').doc(`${input.tcId}__${run.deviceId}`))).data() as
      | CaseResult
      | undefined;
    const skip = cellSkip(run, runs, result, input.tcId, input.rerun, now);
    if (skip) return { claimed: false, skip };
    tx.update(runRef, { currentTcId: input.tcId, heartbeatAt: now });
    return { claimed: true };
  });
}
