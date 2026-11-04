// 사이클 삭제: 잘못 만든 사이클을 지운다. 사이클 목록 카드와 QA 시트 머리의 [⋯] 메뉴에서 시작하고,
// 확인은 QA 시트 머리 아래에서 지워질 건수를 보이고 사이클 이름을 입력받는다. 완료된 사이클·실행 중인 Run이 있으면
// 메뉴 항목을 끄고 이유를 보인다. 지우면 사이클 목록으로 옮겨 가 지운 내용을 알린다.
import { cycleDeleteBlocker, type Run, type TestCycle } from '@qcard/shared';
import {
  Button,
  IconButton,
  Icons,
  Menu,
  MenuContent,
  MenuItem,
  MenuList,
  MenuTrigger,
  SectionMessage,
  TextField,
} from '@qcard/ui';
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { CycleDetail } from '../../data/api';
import { useCycleDeletion, useMyRole } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';
import { useNow } from './parts';

/** 확인을 여는 주소 (`?delete=1`) — 목록 카드의 메뉴가 QA 시트로 옮겨 가며 연다 */
export const DELETE_PARAM = 'delete';

/** 삭제 후 사이클 목록이 받는 알림 */
export type DeletedCycle = { name: string; results: number; runs: number; defects: number };

/** 지금 삭제를 막는 이유 (화면에서 미리 보인다. 실제 검사는 저장할 때 다시 한다) */
export function useDeleteBlocker(cycle: TestCycle, runs: Run[]) {
  const now = useNow();
  return cycleDeleteBlocker(cycle, runs, new Date(now).toISOString());
}

/** [⋯] 메뉴. 지금은 [사이클 삭제] 하나 */
export function CycleMenu({ blocker, onDelete }: { blocker?: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>
        <IconButton variant="outlined" size="small" aria-label="사이클 메뉴">
          <Icons.IconMoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuList>
          <MenuItem
            value="delete"
            disabled={Boolean(blocker)}
            textProps={{
              ...(blocker ? {} : { color: 'semantic.foreground.negative.primary' }),
              description: blocker ?? '결과·Run·결함·증거를 영구 삭제합니다',
            }}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            사이클 삭제
          </MenuItem>
        </MenuList>
      </MenuContent>
    </Menu>
  );
}

/** QA 시트 머리의 메뉴와 그 아래 확인 메시지가 함께 쓰는 상태. 확인 여부는 주소(`?delete=1`)에 둔다 */
export function useCycleDelete(d: CycleDetail, projectId: string) {
  const role = useMyRole(projectId);
  const mutation = useCycleDeletion({ projectId, cycleId: d.cycle.id });
  const [params, setParams] = useSearchParams();
  const blocker = useDeleteBlocker(d.cycle, d.runs);
  const usable = (role.data === 'admin' || role.data === 'qa') && d.cycle.origin !== 'local_run';
  const confirming = params.get(DELETE_PARAM) === '1';
  const setConfirming = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set(DELETE_PARAM, '1');
        else next.delete(DELETE_PARAM);
        return next;
      },
      { replace: true },
    );
  return { d, projectId, usable, mutation, blocker, confirming, setConfirming };
}
type CycleDelete = ReturnType<typeof useCycleDelete>;

/** 페이지 머리의 [⋯] */
export function CycleDeleteAction({ c }: { c: CycleDelete }) {
  if (!c.usable) return null;
  return (
    <CycleMenu
      blocker={c.blocker}
      onDelete={() => {
        c.mutation.reset();
        c.setConfirming(true);
      }}
    />
  );
}

/** 삭제 확인(지워질 건수·이름 입력)과 오류 */
export function CycleDeleteMessage({ c }: { c: CycleDelete }) {
  const { d, projectId, usable, mutation, blocker, confirming, setConfirming } = c;
  const [name, setName] = useState('');
  const navigate = useNavigate();
  if (!usable || !confirming) return null;
  const close = () => {
    setName('');
    setConfirming(false);
  };
  // 목록에서 열었거나 확인하는 사이 Run이 시작됐으면 이유만 보인다
  if (blocker) {
    return (
      <SectionMessage
        variant="cautionary"
        description={blocker}
        bottomButton={
          <Button size="small" variant="outlined" color="assistive" onClick={close}>
            닫기
          </Button>
        }
      >
        지금은 사이클을 삭제할 수 없습니다
      </SectionMessage>
    );
  }
  const deleted: DeletedCycle = {
    name: d.cycle.name,
    results: d.results.length,
    runs: d.runs.length,
    defects: d.defects.length,
  };
  const judged = d.results.filter((r) => r.verdict !== 'nt').length;
  const build = d.cycle.origin === 'local_run' ? d.build.packageName : `${d.build.version} (${d.build.buildNumber})`;
  const notes = [
    `함께 지워지는 것: 결과 ${deleted.results}칸(판정 있음 ${judged}칸) · Run ${deleted.runs}개 · 결함 ${deleted.defects}건 · 판정 이력과 스크린샷 증거`,
    `남는 것: 빌드 ${build} · QA 문서 v${d.doc.appVersion}`,
    '잘못 만든 사이클을 지울 때 씁니다. 끝난 사이클은 지우지 말고 완료로 남겨 두세요 — 다음 사이클과 비교하는 기준이 됩니다.',
    `확인을 위해 사이클 이름 「${d.cycle.name}」을 입력하세요.`,
  ];
  return (
    <>
      <SectionMessage
        variant="negative"
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
            <TextField
              aria-label="삭제 확인용 사이클 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={d.cycle.name}
            />
            <Button size="small" variant="outlined" color="assistive" onClick={close}>
              취소
            </Button>
            <Button
              size="small"
              variant="solid"
              color="negative"
              leadingContent={<Icons.IconTrash />}
              disabled={name.trim() !== d.cycle.name}
              loading={mutation.isPending}
              onClick={() =>
                mutation.mutate(name, {
                  onSuccess: () => void navigate(`/p/${projectId}/cycles`, { state: { deletedCycle: deleted } }),
                })
              }
            >
              삭제
            </Button>
          </span>
        }
      >
        이 사이클을 삭제할까요? 되돌릴 수 없습니다.
      </SectionMessage>
      <ErrorMessage error={mutation.error} title="삭제하지 못했습니다" />
    </>
  );
}

/** 사이클 목록 머리: 방금 지운 사이클 알림 */
export function CycleDeletedMessage() {
  const location = useLocation();
  const navigate = useNavigate();
  const deleted = (location.state as { deletedCycle?: DeletedCycle } | null)?.deletedCycle;
  if (!deleted) return null;
  return (
    <SectionMessage
      variant="positive"
      closeButton
      // 닫으면 기록의 알림을 지워 뒤로 가기·새로고침에 다시 뜨지 않게 한다
      onOpenChange={(open) => !open && void navigate(location.pathname, { replace: true, state: null })}
      description={`결과 ${deleted.results}칸 · Run ${deleted.runs}개 · 결함 ${deleted.defects}건과 스크린샷 증거를 함께 지웠습니다.`}
    >
      「{deleted.name}」 사이클을 삭제했습니다
    </SectionMessage>
  );
}
