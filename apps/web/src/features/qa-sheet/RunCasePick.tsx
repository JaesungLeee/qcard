// 페이지 머리의 [케이스 고르기]: 내 호스트의 대상 기기 칸 기준으로 고른 케이스만 웹에서 Run 요청한다.
import { Button } from '@qcard/ui';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CasePickModal } from '../../components/case-pick/CasePickModal';
import { pickRows } from '../../components/case-pick/rules';
import type { CycleDetail } from '../../data/api';
import { indexResults, resultKey } from './model';
import { launchNote, useRunLaunch } from './RunLaunch';

/** 내 호스트가 실행할 수 있을 때만 보인다. `?pick=modal`이면 열린 채로 시작 (ui:snap) */
export function RunCasePickAction({ d, projectId }: { d: CycleDetail; projectId: string }) {
  const { usable, launch, pending, start } = useRunLaunch(d, projectId);
  const [params] = useSearchParams();
  const [open, setOpen] = useState(() => params.get('pick') === 'modal');
  const target = launch.state === 'ready' ? launch.target : undefined;
  const rows = useMemo(() => {
    if (!target) return [];
    const index = indexResults(d.results);
    return pickRows(d.cases, (c) => index.get(resultKey(c.tcId, target.id))?.verdict);
  }, [d.cases, d.results, target]);
  if (!usable || !target || launchNote(launch)) return null;
  return (
    <>
      <Button size="small" variant="outlined" color="assistive" disabled={pending} onClick={() => setOpen(true)}>
        케이스 고르기
      </Button>
      <CasePickModal
        open={open}
        onOpenChange={setOpen}
        rows={rows}
        device={target.label}
        pending={pending}
        onStart={(tcIds) => start({ tcIds })}
      />
    </>
  );
}
