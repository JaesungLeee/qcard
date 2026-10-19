import type { PrepFlow } from '@qcard/fixtures';
import { CHANGE_LABEL, PRIORITY_LABEL, type QADocument, type TestCase } from '@qcard/shared';
import { Button, Checkbox, Chip, Icons, TextField, TextFieldContent, textClass, token } from '@qcard/ui';
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
import {
  countBy,
  filterCases,
  groupRows,
  isSelectable,
  shortSource,
  type CaseFilter,
  type ChangeFilter,
  type GridRow,
  type GroupRow,
} from './logic';
import { useDocParams } from './params';

const CHANGE_FILTERS: ChangeFilter[] = ['all', 'new', 'changed', 'removed', 'same'];

/** 그리드 너비에 맞춰 열을 줄인다: 상세 패널이 열리거나 좁은 화면이면 상세에 다 나오는 열은 숨긴다. */
function columnsFor(width: number): ColDef<GridRow>[] {
  const narrow = width > 0 && width < 560;
  const compact = width > 0 && width < 820;
  return BASE_COLUMNS.map((c) => {
    if (c.colId === 'tcId') return { ...c, pinned: narrow ? null : 'left', width: compact ? 156 : c.width };
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

type Ctx = { caseId: string | null };

function GroupRenderer({ data }: ICellRendererParams<GridRow>) {
  const g = data as GroupRow;
  return (
    <div className="qd-group-row">
      <span className={`${textClass('label2', 'medium')} qd-faint`} style={{ whiteSpace: 'nowrap' }}>
        {g.feature}
      </span>
      <Icons.IconChevronRightSmall
        aria-hidden
        style={{ color: token('foreground-neutral-quaternary'), flex: 'none' }}
      />
      <span className={`${textClass('label1', 'bold')} qd-cell-title`}>{g.subFeature}</span>
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
  const { caseId, set } = useDocParams();
  const [filter, setFilter] = useState<CaseFilter>({ change: 'all', unapprovedOnly: false, q: '' });
  const apiRef = useRef<GridApi<GridRow> | null>(null);
  const [gridRef, gridWidth] = useWidth<HTMLDivElement>();
  const columns = useMemo(() => columnsFor(gridWidth), [gridWidth]);

  const changeCounts = useMemo(() => countBy(doc.cases, (c) => c.change), [doc.cases]);
  const visible = useMemo(() => filterCases(doc.cases, filter), [doc.cases, filter]);
  const rows = useMemo(() => groupRows(visible), [visible]);
  const current = doc.cases.find((c) => c.tcId === caseId);
  const context = useMemo<Ctx>(() => ({ caseId }), [caseId]);

  useEffect(() => {
    apiRef.current?.redrawRows();
  }, [caseId]);
  useEffect(() => {
    apiRef.current?.deselectAll();
  }, [selectionKey]);

  const open = (c: TestCase) => set({ case: c.tcId, edit: null });

  return (
    <div className="qd-stack">
      <div className="qd-toolbar">
        <div className="qd-row" role="group" aria-label="변경 필터">
          {CHANGE_FILTERS.map((k) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              active={filter.change === k}
              onClick={() => setFilter((f) => ({ ...f, change: k }))}
            >
              {k === 'all' ? '전체' : CHANGE_LABEL[k]}{' '}
              <span className="qc-mono">{k === 'all' ? doc.cases.length : (changeCounts[k] ?? 0)}</span>
            </Chip>
          ))}
          <label className={`${textClass('label1')} qd-check`} style={{ marginLeft: token('space-8') }}>
            <Checkbox
              size="small"
              checked={filter.unapprovedOnly}
              onCheckedChange={(v) => setFilter((f) => ({ ...f, unapprovedOnly: v }))}
            />
            미승인만
          </label>
        </div>
        <div style={{ flex: '0 1 300px', minWidth: 200 }}>
          <TextField
            size="medium"
            aria-label="케이스 검색"
            placeholder="TC ID, 제목, 출처, 요구사항 검색"
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
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
                케이스 <span className="qc-mono">{visible.length}</span>개 표시
                {visible.length !== doc.cases.length && <> · 전체 {doc.cases.length}개</>}. 행을 선택하면 일괄
                승인·반려할 수 있습니다 (보류·삭제 케이스 제외).
              </>
            )}
          </span>
        )}
      </div>

      <div className={`qd-split${current ? ' has-panel' : ''}`}>
        <div className="qd-grid" ref={gridRef}>
          <AgGridReact<GridRow>
            theme={qcardGridTheme}
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
  );
}
