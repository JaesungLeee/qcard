import { CHANGE_LABEL, type PrepFlow, PRIORITY_LABEL, type QADocument, type TestCase } from '@qcard/shared';
import {
  Button,
  Chip,
  Icons,
  Pagination,
  PaginationSelect,
  TextField,
  TextFieldContent,
  textClass,
  token,
} from '@qcard/ui';
import { CheckLabel } from '../../components/CheckLabel';
import type {
  CellClickedEvent,
  ColDef,
  GridApi,
  ICellRendererParams,
  RowClassRules,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { qcardGridTheme } from '../../components/agGrid';
import { ApprovalBadge, ChangeBadge, ModeBadge } from './Badges';
import { CaseDetail } from './CaseDetail';
import { CaseNav } from './CaseNav';
import {
  caseTree,
  countBy,
  filterCases,
  groupRows,
  inScope,
  isSelectable,
  orderByGroup,
  PAGE_SIZES,
  paginate,
  shortSource,
  type CaseFilter,
  type CaseScope,
  type ChangeFilter,
  type GridRow,
  type GroupRow,
} from './logic';
import { useDocParams } from './params';

const CHANGE_FILTERS: ChangeFilter[] = ['all', 'new', 'changed', 'removed', 'same'];

/** 페이지당 케이스 수는 보는 사람의 편의 설정이라 브라우저에만 둔다. */
const PAGE_SIZE_KEY = 'qcard.qaDoc.pageSize';
const DEFAULT_PAGE_SIZE = 20;
function loadPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(v) ? v : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}
function savePageSize(v: number) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(v));
  } catch {
    // 저장 못 해도 이번 화면에서는 적용된다
  }
}

/** 걸러진 목록을 만든다: 분류 범위 → 변경·승인·검색 필터 → 묶음 순서 */
const listFor = (cases: TestCase[], scope: CaseScope, filter: CaseFilter) =>
  orderByGroup(filterCases(cases.filter((c) => inScope(c, scope)), filter));

/**
 * 그리드 너비에 맞춰 열을 줄인다: 상세 패널이 열리거나 좁은 화면이면 상세에 다 나오는 열은 숨긴다.
 * TC ID 열은 가장 긴 ID에 맞춘다 (접두어가 스펙 이름이라 `TC-HOME-DECK-EXPLORATION-051`처럼 길 수 있다).
 */
function columnsFor(width: number, longestId: number): ColDef<GridRow>[] {
  const narrow = width > 0 && width < 640;
  const compact = width > 0 && width < 820;
  // 13px 고정폭 글꼴 한 글자 ≈ 7.5px + 칸 여백
  const idWidth = Math.min(250, Math.max(BASE_COLUMNS[0]!.width!, Math.ceil(longestId * 7.5 + 32)));
  return BASE_COLUMNS.map((c) => {
    if (c.colId === 'tcId')
      return { ...c, pinned: narrow ? null : 'left', width: narrow ? 156 : compact ? Math.min(idWidth, 200) : idWidth };
    if (c.colId === 'title') return { ...c, minWidth: compact ? 180 : 220 };
    if (c.colId === 'source') return { ...c, hide: narrow, width: compact ? 76 : c.width };
    if (c.colId === 'mode' || c.colId === 'priority') return { ...c, hide: compact };
    return c;
  });
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Ctx = { caseId: string | null; showFeature: boolean };

function GroupRenderer({ data, context }: ICellRendererParams<GridRow>) {
  const g = data as GroupRow;
  return (
    <div className="qd-group-row">
      {(context as Ctx).showFeature && (
        <>
          <span className={`${textClass('label2', 'medium')} qd-faint`} style={{ whiteSpace: 'nowrap' }}>
            {g.feature}
          </span>
          <Icons.IconChevronRightSmall
            aria-hidden
            style={{ color: token('foreground-neutral-quaternary'), flex: 'none' }}
          />
        </>
      )}
      <span className={`${textClass('label1', 'bold')} qd-cell-title`}>{g.subFeature}</span>
      {g.continued && (
        <span className={`${textClass('caption1')} qd-faint`} style={{ whiteSpace: 'nowrap', flex: 'none' }}>
          이전 페이지에서 이어짐
        </span>
      )}
      <span
        className={`${textClass('caption1', 'medium')} qd-faint qc-mono`}
        style={{ marginLeft: 'auto', flex: 'none' }}
      >
        승인 {g.approved}/{g.total}
      </span>
    </div>
  );
}

const caseOf = (r: GridRow | undefined) => (r?.kind === 'case' ? r.case : undefined);

const BASE_COLUMNS: ColDef<GridRow>[] = [
  {
    colId: 'tcId',
    headerName: 'TC ID',
    width: 168,
    pinned: 'left',
    valueGetter: (p) => caseOf(p.data)?.tcId,
    cellClass: 'qc-mono',
    cellStyle: { fontSize: '13px' },
  },
  {
    colId: 'source',
    headerName: '출처',
    width: 84,
    valueGetter: (p) => {
      const c = caseOf(p.data);
      return c ? shortSource(c.sourceId) : undefined;
    },
    tooltipValueGetter: (p) => caseOf(p.data)?.sourceId,
    cellClass: 'qc-mono',
    cellStyle: { fontSize: '13px' },
  },
  {
    colId: 'title',
    headerName: '제목',
    flex: 1,
    minWidth: 220,
    valueGetter: (p) => caseOf(p.data)?.title,
    tooltipValueGetter: (p) => caseOf(p.data)?.title,
    cellRenderer: (p: ICellRendererParams<GridRow>) => <span className="qd-cell-title">{p.value as string}</span>,
  },
  {
    colId: 'change',
    headerName: '변경',
    width: 76,
    valueGetter: (p) => caseOf(p.data)?.change,
    cellRenderer: (p: ICellRendererParams<GridRow>) => {
      const c = caseOf(p.data);
      return c ? <ChangeBadge change={c.change} /> : null;
    },
  },
  {
    colId: 'approval',
    headerName: '승인',
    width: 80,
    valueGetter: (p) => caseOf(p.data)?.approval.status,
    cellRenderer: (p: ICellRendererParams<GridRow>) => {
      const c = caseOf(p.data);
      if (!c) return null;
      if (c.change === 'removed') return <span className="qd-faint">—</span>;
      return <ApprovalBadge status={c.approval.status} />;
    },
  },
  {
    colId: 'mode',
    headerName: '수행 방식',
    width: 124,
    valueGetter: (p) => caseOf(p.data)?.mode,
    cellRenderer: (p: ICellRendererParams<GridRow>) => {
      const c = caseOf(p.data);
      return c ? <ModeBadge c={c} /> : null;
    },
  },
  {
    colId: 'priority',
    headerName: '우선순위',
    width: 92,
    valueGetter: (p) => {
      const c = caseOf(p.data);
      return c ? PRIORITY_LABEL[c.priority] : undefined;
    },
  },
];

const ROW_CLASS: RowClassRules<GridRow> = {
  'qd-row-current': (p) => {
    const c = caseOf(p.data);
    return !!c && c.tcId === (p.context as Ctx).caseId;
  },
  'qd-row-removed': (p) => caseOf(p.data)?.change === 'removed',
};

export function CasesTab({
  doc,
  prepFlows,
  selected,
  onSelectedChange,
  selectionKey,
  onBulk,
  bulkPending,
  notice,
}: {
  doc: QADocument;
  prepFlows: PrepFlow[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  selectionKey: number;
  onBulk: (status: 'approved' | 'rejected') => void;
  bulkPending: boolean;
  notice: string | null;
}) {
  const { caseId, feature, flow, page: pageParam, set } = useDocParams();
  const [filter, setFilter] = useState<CaseFilter>({ change: 'all', unapprovedOnly: false, q: '' });
  const [pageSize, setPageSize] = useState(loadPageSize);
  const apiRef = useRef<GridApi<GridRow> | null>(null);
  const [gridRef, gridWidth] = useWidth<HTMLDivElement>();
  const longestId = useMemo(() => Math.max(0, ...doc.cases.map((c) => c.tcId.length)), [doc.cases]);
  const columns = useMemo(() => columnsFor(gridWidth, longestId), [gridWidth, longestId]);

  const tree = useMemo(() => caseTree(doc.cases), [doc.cases]);
  // 문서에 없는 분류가 주소에 남아 있으면 전체로 본다
  const node = tree.find((f) => f.feature === feature);
  const scope = useMemo<CaseScope>(
    () => ({
      feature: node ? node.feature : null,
      subFeature: node?.flows.some((f) => f.subFeature === flow) ? flow : null,
    }),
    [node, flow],
  );
  const scoped = useMemo(() => doc.cases.filter((c) => inScope(c, scope)), [doc.cases, scope]);
  const changeCounts = useMemo(() => countBy(scoped, (c) => c.change), [scoped]);
  const visible = useMemo(() => orderByGroup(filterCases(scoped, filter)), [scoped, filter]);
  const paged = paginate(visible, pageParam, pageSize);
  const rows = useMemo(() => groupRows(paged.items, visible), [paged.items, visible]);
  const current = doc.cases.find((c) => c.tcId === caseId);
  const context = useMemo<Ctx>(() => ({ caseId, showFeature: scope.feature === null }), [caseId, scope.feature]);

  useEffect(() => {
    apiRef.current?.redrawRows();
  }, [caseId, scope.feature]);
  // 일괄 선택은 보이는 페이지 안에서만 한다: 페이지·분류·필터가 바뀌면 선택을 푼다
  useEffect(() => {
    apiRef.current?.deselectAll();
  }, [selectionKey, paged.page, pageSize, scope, filter]);

  // 주소로 케이스를 열면(?case=) 그 케이스가 보이는 분류·페이지로 옮긴다. 케이스가 바뀔 때 한 번만
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!current || placed.current === current.tcId) return;
    placed.current = current.tcId;
    const target = inScope(current, scope) ? scope : { feature: current.feature, subFeature: null };
    const index = listFor(doc.cases, target, filter).indexOf(current);
    if (index < 0) return; // 필터에 걸러진 케이스는 옮기지 않는다
    const page = Math.floor(index / pageSize) + 1;
    if (target === scope && page === paged.page) return;
    set(
      { feature: target.feature, flow: target.subFeature, page: page > 1 ? String(page) : null },
      { replace: true },
    );
  });

  const open = (c: TestCase) => set({ case: c.tcId, edit: null });
  const pick = (s: CaseScope) => set({ feature: s.feature, flow: s.subFeature, page: null });
  const goTo = (p: number) => set({ page: p > 1 ? String(p) : null });
  const changeFilter = (next: (f: CaseFilter) => CaseFilter) => {
    setFilter(next);
    if (paged.page > 1) set({ page: null }, { replace: true });
  };
  const changePageSize = (size: number) => {
    setPageSize(size);
    savePageSize(size);
    goTo(1);
  };
  const flowLabel = scope.subFeature ?? '';

  return (
    <div className={`qd-cases${current ? ' has-panel' : ''}`}>
      <CaseNav tree={tree} total={doc.cases.length} scope={scope} onPick={pick} />
      <div className="qd-stack">
      <div className="qd-stack" style={{ gap: token('space-2') }}>
        <span className={`${textClass('label2', 'medium')} qd-faint`}>
          {scope.feature === null ? '모든 기능' : scope.subFeature === null ? '기능' : `${scope.feature} › 유저 플로우`}
        </span>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          {scope.feature === null ? '전체 케이스' : scope.subFeature === null ? scope.feature : flowLabel || '(유저 플로우 없음)'}
        </h2>
      </div>
      <div className="qd-toolbar">
        <div className="qd-row" role="group" aria-label="변경 필터">
          {CHANGE_FILTERS.map((k) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              active={filter.change === k}
              onClick={() => changeFilter((f) => ({ ...f, change: k }))}
            >
              {k === 'all' ? '전체' : CHANGE_LABEL[k]}{' '}
              <span className="qc-mono">{k === 'all' ? scoped.length : (changeCounts[k] ?? 0)}</span>
            </Chip>
          ))}
          <CheckLabel
            className={`${textClass('label1')} qd-check`}
            style={{ marginLeft: token('space-8') }}
            checked={filter.unapprovedOnly}
            onCheckedChange={(v) => changeFilter((f) => ({ ...f, unapprovedOnly: v }))}
          >
            미승인만
          </CheckLabel>
        </div>
        <div style={{ flex: '0 1 300px', minWidth: 200 }}>
          <TextField
            size="medium"
            aria-label="케이스 검색"
            placeholder="TC ID, 제목, 출처, 요구사항 검색"
            value={filter.q}
            onChange={(e) => changeFilter((f) => ({ ...f, q: e.target.value }))}
            leadingContent={
              <TextFieldContent variant="icon">
                <Icons.IconSearch />
              </TextFieldContent>
            }
          />
        </div>
      </div>

      <div
        className={`${textClass('label1')} qd-row`}
        style={{ justifyContent: 'space-between', minHeight: 32 }}
        aria-live="polite"
      >
        {selected.length > 0 ? (
          <span className="qd-row">
            <span className={textClass('label1', 'medium')}>{selected.length}개 선택됨</span>
            <Button
              size="small"
              variant="solid"
              color="negative"
              disabled={bulkPending}
              onClick={() => onBulk('rejected')}
            >
              일괄 반려
            </Button>
            <Button size="small" variant="outlined" color="assistive" onClick={() => apiRef.current?.deselectAll()}>
              선택 해제
            </Button>
          </span>
        ) : (
          <span className="qd-muted">
            {notice ?? (
              <>
                케이스 <span className="qc-mono">{visible.length}</span>개
                {visible.length !== scoped.length && <> · 이 분류 {scoped.length}개</>}. 이 페이지에서 행을
                선택하면 일괄 승인·반려할 수 있습니다 (보류·삭제 케이스 제외).
              </>
            )}
          </span>
        )}
      </div>

      <div className={`qd-split${current ? ' has-panel' : ''}`}>
        <div className="qd-stack" style={{ gap: token('space-12') }}>
        <div className="qd-grid" ref={gridRef}>
          <AgGridReact<GridRow>
            theme={qcardGridTheme}
            domLayout="autoHeight"
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: false, resizable: true, suppressMovable: true }}
            context={context}
            getRowId={(p) => (p.data.kind === 'group' ? `g:${p.data.key}` : p.data.case.tcId)}
            isFullWidthRow={(p) => p.rowNode.data?.kind === 'group'}
            fullWidthCellRenderer={GroupRenderer}
            getRowHeight={(p) => (p.data?.kind === 'group' ? 36 : undefined)}
            rowClassRules={ROW_CLASS}
            rowSelection={{
              mode: 'multiRow',
              checkboxes: true,
              headerCheckbox: true,
              enableClickSelection: false,
              hideDisabledCheckboxes: true,
              isRowSelectable: (n) => {
                const c = caseOf(n.data);
                return !!c && isSelectable(c);
              },
            }}
            selectionColumnDef={{ width: 48, pinned: 'left' }}
            tooltipShowDelay={400}
            overlayNoRowsTemplate="조건에 맞는 케이스가 없습니다"
            onGridReady={(e) => {
              apiRef.current = e.api;
              if (caseId) {
                const node = e.api.getRowNode(caseId);
                if (node) e.api.ensureNodeVisible(node, 'middle');
              }
            }}
            onSelectionChanged={(e: SelectionChangedEvent<GridRow>) =>
              onSelectedChange(
                e.api
                  .getSelectedRows()
                  .map(caseOf)
                  .filter((c): c is TestCase => !!c)
                  .map((c) => c.tcId),
              )
            }
            onCellClicked={(e: CellClickedEvent<GridRow>) => {
              if (e.column.getColId() === 'ag-Grid-SelectionColumn') return;
              const c = caseOf(e.data);
              if (c) open(c);
            }}
          />
        </div>
        {visible.length > 0 && (
          <div className="qd-pager">
            <span className={`${textClass('label2')} qd-muted qc-mono`}>
              {paged.start + 1}–{paged.start + paged.items.length} / {visible.length}
            </span>
            <Pagination
              variant="extended"
              page={paged.page}
              totalPages={paged.pageCount}
              onChange={(p) => p && goTo(p)}
              trailingContent={
                <PaginationSelect
                  label="페이지당"
                  pageSize={pageSize}
                  pageSizeOptions={[...PAGE_SIZES]}
                  onChange={(s) => s && changePageSize(s)}
                />
              }
            />
          </div>
        )}
        </div>
        {current && (
          <CaseDetail
            key={current.tcId}
            doc={doc}
            c={current}
            prepFlows={prepFlows}
            onClose={() => set({ case: null, edit: null })}
          />
        )}
      </div>
      </div>
    </div>
  );
}
