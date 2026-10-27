// 사이클 완료·다시 열기 (F-CY-09): QA 권한자가 완료로 표시하면 새 Run을 받지 않는다. 사람 확정은 계속 된다.
// 남은 확인필요·N/T 칸과 끝나지 않은 Run을 먼저 알리고 확인받는다. 다시 열기는 되돌릴 수 있어 바로 한다.
import { completionWarnings } from '@qcard/data';
import { Button, Icons, SectionMessage } from '@qcard/ui';
import { useState } from 'react';
import type { CycleDetail } from '../../data/api';
import { useCycleCompletion, useMyRole } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';

/** 머리의 버튼과 그 아래 확인 메시지가 함께 쓰는 상태 */
export function useCycleComplete(d: CycleDetail, projectId: string) {
  const role = useMyRole(projectId);
  const mutation = useCycleCompletion({ projectId, cycleId: d.cycle.id });
  const [confirming, setConfirming] = useState(false);
  const usable = (role.data === 'admin' || role.data === 'qa') && d.cycle.origin !== 'local_run';
  return { d, usable, mutation, confirming, setConfirming };
}
type CycleComplete = ReturnType<typeof useCycleComplete>;

/** 페이지 머리의 [사이클 완료]·[다시 열기] */
export function CycleCompleteAction({ c }: { c: CycleComplete }) {
  const { d, usable, mutation, confirming, setConfirming } = c;
  if (!usable) return null;
  if (d.cycle.period.end) {
    return (
      <Button
        size="small"
        variant="outlined"
        color="assistive"
        leadingContent={<Icons.IconRefresh />}
        loading={mutation.isPending}
        onClick={() => mutation.mutate(false)}
      >
        다시 열기
      </Button>
    );
  }
  return (
    <Button
      size="small"
      variant="outlined"
      color="assistive"
      leadingContent={<Icons.IconCheck />}
      disabled={confirming}
      onClick={() => {
        mutation.reset();
        setConfirming(true);
      }}
    >
      사이클 완료
    </Button>
  );
}

/** 완료 확인(남은 칸·Run을 알리고 [완료하기])과 오류 */
export function CycleCompleteMessage({ c }: { c: CycleComplete }) {
  const { d, usable, mutation, confirming, setConfirming } = c;
  if (!usable) return null;
  const error = (
    <ErrorMessage error={mutation.error} title={d.cycle.period.end ? '다시 열지 못했습니다' : '완료하지 못했습니다'} />
  );
  if (!confirming || d.cycle.period.end) return error;
  const w = completionWarnings(d.results, d.runs);
  const notes = [
    w.check + w.nt > 0 &&
      `확인필요 ${w.check}칸 · N/T ${w.nt}칸이 남아 있습니다. 완료한 뒤에도 판정 추적 뷰에서 확정할 수 있습니다.`,
    w.running > 0 && `실행 중인 Run ${w.running}개는 끝까지 결과를 올립니다.`,
    w.paused > 0 && `일시정지된 Run ${w.paused}개는 이어서 실행할 수 없습니다.`,
    '완료하면 새 Run을 받지 않습니다. 다시 열면 실행할 수 있습니다.',
  ].filter((n): n is string => Boolean(n));
  const warn = w.check + w.nt + w.running + w.paused > 0;
  return (
    <>
      <SectionMessage
        variant={warn ? 'cautionary' : 'info'}
        description={
          // 설명은 <p> 안에 그려져 목록 대신 줄로 나눈다
          notes.map((n) => (
            <span key={n} style={{ display: 'block' }}>
              · {n}
            </span>
          ))
        }
        bottomButton={
          <span className="qs-row">
            <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirming(false)}>
              취소
            </Button>
            <Button
              size="small"
              variant="solid"
              color="primary"
              loading={mutation.isPending}
              onClick={() => mutation.mutate(true, { onSuccess: () => setConfirming(false) })}
            >
              완료하기
            </Button>
          </span>
        }
      >
        {warn ? '끝나지 않은 칸이 있습니다. 사이클을 완료할까요?' : '사이클을 완료할까요?'}
      </SectionMessage>
      {error}
    </>
  );
}
