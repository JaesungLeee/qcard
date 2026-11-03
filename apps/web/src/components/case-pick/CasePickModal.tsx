// Run 케이스 고르기 모달 (F-CY-07): 판정(내 기기 칸)·우선순위 필터 + 기능·세부 기능으로 묶은 체크 목록.
// 데이터 소스와 무관하다 — 웹 QA 시트(CycleDetail)와 로컬 콘솔(ConsoleCycleOption)이 각자 줄(pickRows)을 만들어 넘긴다.
import { PRIORITY_LABEL } from '@qcard/shared';
import {
  ActionArea,
  ActionAreaButton,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Icons,
  Modal,
  ModalContainer,
  ModalContent,
  ModalNavigation,
  VerdictBadge,
  textClass,
} from '@qcard/ui';
import { useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_PICK_FILTER,
  PICK_VERDICT_LABEL,
  PICK_VERDICTS,
  PRIORITIES,
  defaultPicked,
  matchesPick,
  pickAllVisible,
  pickedState,
  pickedTcIds,
  pickGroups,
  pickMany,
  pickVerdictCounts,
  toggleIn,
  togglePick,
  type PickFilter,
  type PickRow,
} from './rules';
import './case-pick.css';

/** 고르기 상태. 사람이 고르기 전에는 남은 칸 전체 (결과가 새로 들어오면 따라간다) */
function useCasePick(rows: PickRow[]) {
  const [filter, setFilter] = useState<PickFilter>(DEFAULT_PICK_FILTER);
  const [touched, setTouched] = useState<Set<string>>();
  const picked = touched ?? defaultPicked(rows);
  const visible = useMemo(() => rows.filter((r) => matchesPick(r, filter)), [rows, filter]);
  const chosen = pickedTcIds(rows, picked);
  return {
    rows,
    filter,
    setFilter,
    visible,
    picked,
    chosen,
    counts: pickVerdictCounts(rows, filter),
    state: pickedState(picked, visible),
    toggle: (tcId: string, on: boolean) => setTouched(togglePick(picked, tcId, on)),
    /** 기능·세부 기능 묶음째 넣거나 뺀다 */
    setMany: (rs: PickRow[], on: boolean) => setTouched(pickMany(picked, rs, on)),
    toggleVisible: () => setTouched(pickAllVisible(picked, visible)),
    clear: () => setTouched(new Set()),
    reset: () => {
      setTouched(undefined);
      setFilter(DEFAULT_PICK_FILTER);
    },
  };
}
type CasePick = ReturnType<typeof useCasePick>;

/** 판정(내 기기 칸)·우선순위 칩. 기능은 목록의 기능 묶음으로 고른다 */
function PickFilters({ p, device }: { p: CasePick; device: string }) {
  const { filter, setFilter } = p;
  return (
    <div className="qcp-filters">
      <div className="qcp-row" role="group" aria-label={`판정 필터 (${device} 칸 기준)`}>
        <span className={`${textClass('caption1', 'medium')} qcp-muted qcp-label`}>판정</span>
        {PICK_VERDICTS.map((v) => (
          <Chip
            key={v}
            size="small"
            active={filter.verdict === v}
            disabled={v !== 'all' && v !== filter.verdict && p.counts[v] === 0}
            onClick={() => setFilter({ ...filter, verdict: v })}
          >
            {PICK_VERDICT_LABEL[v]} {p.counts[v]}
          </Chip>
        ))}
      </div>
      <div className="qcp-row" role="group" aria-label="우선순위 필터">
        <span className={`${textClass('caption1', 'medium')} qcp-muted qcp-label`}>우선순위</span>
        {PRIORITIES.map((x) => (
          <Chip
            key={x}
            size="small"
            active={filter.priorities.includes(x)}
            onClick={() =>
              setFilter({ ...filter, priorities: toggleIn(filter.priorities, x, !filter.priorities.includes(x)) })
            }
          >
            {PRIORITY_LABEL[x]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** 결과가 있는 칸: 지금 판정 + 다시 실행 */
function RerunMark({ row }: { row: PickRow }) {
  if (!row.rerun) return null;
  return (
    <span className="qcp-row qcp-nowrap" style={{ flexWrap: 'nowrap' }}>
      <VerdictBadge verdict={row.verdict} />
      <span className={`${textClass('caption1')} qcp-muted qcp-rerun`}>다시 실행</span>
    </span>
  );
}

/** 고른 건수 한 줄: "고른 12건 · 다시 실행 3건 · 화면 밖 2건" */
function pickSummary(p: CasePick): string {
  const hidden = p.chosen.tcIds.filter((id) => !p.visible.some((r) => r.tc.tcId === id)).length;
  return [
    `고른 ${p.chosen.tcIds.length}건`,
    p.chosen.rerun ? `다시 실행 ${p.chosen.rerun}건` : '',
    hidden ? `필터 밖 ${hidden}건` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 케이스 고르기 모달. `rows`는 이 기기 칸 기준 자동 케이스 (pickRows).
 * `blocked`가 있으면 고를 수는 있지만 실행 버튼을 막고 이유를 보인다 (호스트 꺼짐, 디바이스 문제 등)
 */
export function CasePickModal({
  open,
  onOpenChange,
  rows,
  device,
  pending,
  blocked,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PickRow[];
  /** 기준이 되는 기기 칸 이름 (예: Pixel 8 (Android 16)) */
  device: string;
  pending?: boolean;
  blocked?: string;
  onStart: (tcIds: string[]) => void;
}) {
  const p = useCasePick(rows);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) p.reset();
  };
  return (
    <Modal open={open} onOpenChange={close}>
      <ModalContainer variant="popup" size="large" sticky>
        <ModalNavigation variant="emphasized">Run할 케이스 고르기</ModalNavigation>
        <ModalContent gap="var(--qc-space-12)">
          <div className={`${textClass('caption1')} qcp-muted`}>
            {device} 칸 기준 · 자동 케이스 {p.rows.length}건 · 처음엔 남은 칸 전체를 고릅니다
          </div>
          <PickFilters p={p} device={device} />
          <div className="qcp-head">
            <Checkbox
              id="pick-all"
              size="small"
              checked={p.state === 'all'}
              indeterminate={p.state === 'some'}
              disabled={p.visible.length === 0}
              onCheckedChange={p.toggleVisible}
            />
            <label htmlFor="pick-all" className={textClass('label2', 'medium')}>
              걸러진 {p.visible.length}건 모두 고르기
            </label>
            <span className="qcp-spacer" />
            <Button size="small" variant="outlined" color="assistive" disabled={p.picked.size === 0} onClick={p.clear}>
              모두 해제
            </Button>
          </div>
          <PickTree p={p} />
        </ModalContent>
        <ActionArea variant="compact" caption={blocked ?? pickSummary(p)}>
          <ActionAreaButton variant="alternative" onClick={() => close(false)}>
            취소
          </ActionAreaButton>
          <ActionAreaButton
            variant="main"
            disabled={!!blocked || pending || p.chosen.tcIds.length === 0}
            onClick={() => {
              onStart(p.chosen.tcIds);
              close(false);
            }}
          >
            {`고른 ${p.chosen.tcIds.length}건 실행`}
          </ActionAreaButton>
        </ActionArea>
      </ModalContainer>
    </Modal>
  );
}

/** 묶음 머리: 체크(걸러진 줄 모두 / 일부 / 없음) + 접기 + 이름 + 고른 수 */
function GroupHead({
  p,
  id,
  rows,
  open,
  onFold,
  children,
  sub,
}: {
  p: CasePick;
  id: string;
  rows: PickRow[];
  open: boolean;
  onFold: () => void;
  children: ReactNode;
  sub?: boolean;
}) {
  const state = pickedState(p.picked, rows);
  const n = rows.filter((r) => p.picked.has(r.tc.tcId)).length;
  return (
    <div className={sub ? 'qcp-group qcp-sub' : 'qcp-group'}>
      <IconButton aria-label={open ? '접기' : '펼치기'} aria-expanded={open} size="small" onClick={onFold}>
        {open ? <Icons.IconChevronDownSmall /> : <Icons.IconChevronRightSmall />}
      </IconButton>
      <Checkbox
        id={id}
        size="small"
        checked={state === 'all'}
        indeterminate={state === 'some'}
        onCheckedChange={() => p.setMany(rows, state !== 'all')}
      />
      <label htmlFor={id} className="qcp-group-label">
        {children}
      </label>
      <span className={`${textClass('caption1')} qcp-muted qcp-nowrap`}>
        {n} / {rows.length}
      </span>
    </div>
  );
}

/** 걸러진 줄을 기능(스펙) → 세부 기능으로 묶어 보인다. 묶음 체크로 한꺼번에 고른다 */
function PickTree({ p }: { p: CasePick }) {
  const groups = useMemo(() => pickGroups(p.visible), [p.visible]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (key: string) => setFolded((f) => togglePick(f, key, !f.has(key)));
  if (groups.length === 0)
    return <div className={`${textClass('label2')} qcp-muted`}>조건에 맞는 자동 케이스가 없습니다</div>;
  return (
    <div className="qcp-tree">
      {groups.map((g) => (
        <section key={g.key} aria-label={`기능 ${g.code}`}>
          <GroupHead p={p} id={`pick-g-${g.key}`} rows={g.rows} open={!folded.has(g.key)} onFold={() => fold(g.key)}>
            <span className={`qc-mono ${textClass('label2', 'bold')}`}>{g.code}</span>{' '}
            <span className={`${textClass('caption1')} qcp-muted`}>{g.name}</span>
          </GroupHead>
          {!folded.has(g.key) &&
            g.subs.map((s) => (
              <div key={s.key}>
                <GroupHead
                  p={p}
                  id={`pick-s-${s.key}`}
                  rows={s.rows}
                  open={!folded.has(s.key)}
                  onFold={() => fold(s.key)}
                  sub
                >
                  <span className={textClass('label2', 'medium')}>{s.name}</span>
                </GroupHead>
                {!folded.has(s.key) && (
                  <ul className="qcp-list" aria-label={s.name}>
                    {s.rows.map((r) => {
                      const id = `pick-${r.tc.tcId}`;
                      return (
                        <li key={r.tc.tcId}>
                          <Checkbox
                            id={id}
                            size="small"
                            checked={p.picked.has(r.tc.tcId)}
                            onCheckedChange={(on) => p.toggle(r.tc.tcId, on)}
                          />
                          <label htmlFor={id} className="qcp-item">
                            <span className={`qc-mono ${textClass('caption1', 'medium')} qcp-muted`}>
                              {r.tc.tcId} · {PRIORITY_LABEL[r.tc.priority]}
                            </span>
                            <span className={`${textClass('label2')} qcp-title`}>{r.tc.title}</span>
                          </label>
                          <RerunMark row={r} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
