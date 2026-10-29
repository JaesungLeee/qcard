// ② 테스트 케이스 (PRD §5.10 컬럼). TC ID를 누르면 판정 추적 뷰, 결과 셀은 그 디바이스의 판정 추적 뷰로 간다.
import {
  CHANGE_LABEL,
  PLATFORM_LABEL,
  PRIORITY_LABEL,
  TEST_TYPE_LABEL,
  VERDICT_LABEL,
  type CaseResult,
  type TestCase,
} from '@qcard/shared';
import { Chip, Icons, TextField, TextFieldContent, VerdictBadge, textClass, token } from '@qcard/ui';
import type { CellClickedEvent, CellKeyDownEvent, ColDef, ColGroupDef, ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { qcardGridTheme } from '../../components/agGrid';
import { fmtDateTime } from '../../components/format';
import {
  caseVerdictCounts,
  decidedByLabel,
  matchesQuery,
  matchesVerdict,
  oneLineSummary,
  primaryDevice,
  resultKey,
  shortId,
  VERDICTS,
  type VerdictFilter,
} from './model';
import { TabBody, traceUrl } from './parts';
import type { SheetProps } from './QaSheetPage';

type Row = { tc: TestCase; results: Record<string, CaseResult | undefined> };

const DEVICE_COL = 'device:';

function ResultCell(p: ICellRendererParams<Row>) {
  const deviceId = String(p.colDef?.colId ?? '').slice(DEVICE_COL.length);
  const r = p.data?.results[deviceId];
  if (!r) return <span className="qs-faint">—</span>;
  const summary = oneLineSummary(r);
  return (
    <span className="qs-result-cell">
      <VerdictBadge verdict={r.verdict} />
      {r.attempts > 1 && <span className={`${textClass('caption1')} qs-faint`}>재시도 {r.attempts - 1}</span>}
      {summary && <span className={`${textClass('caption1')} qs-ellipsis`}>{summary}</span>}
    </span>
  );
}

/** TC ID는 판정 추적 뷰로 가는 링크. 디바이스는 primaryDevice로 고른다. */
function TcIdCell(p: ICellRendererParams<Row> & { href: (row: Row) => string | undefined }) {
  const href = p.data && p.href(p.data);
  const label = <span className={`qc-mono ${textClass('label2', 'medium')}`}>{p.value as string}</span>;
  if (!href) return label;
  return (
    // 그리드가 셀 포커스·Enter를 처리하므로 링크 자체는 탭 순서에서 뺀다
    <Link to={href} className="qs-link" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      {label}
    </Link>
  );
}

export function CasesTab({ d, index, projectId }: SheetProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const targets = d.cycle.targets;
  const multi = targets.length > 1;
  const wide = useMediaQuery('(min-width: 1100px)');

  const rows = useMemo<Row[]>(
    () =>
      d.cases.map((tc) => ({
        tc,
        results: Object.fromEntries(targets.map((t) => [t.id, index.get(resultKey(tc.tcId, t.id))])),
      })),
    [d.cases, targets, index],
  );
  const counts = useMemo(() => caseVerdictCounts(d.cases, targets, index), [d.cases, targets, index]);
  const visible = useMemo(
    () => rows.filter((r) => matchesQuery(r.tc, query) && matchesVerdict(r.tc, targets, index, verdict)),
    [rows, query, verdict, targets, index],
  );

  /** 디바이스별 값을 한 칸에 보여줄 때: 모두 같으면 하나로, 다르면 "모델 값 · 모델 값" */
  const perDevice = (r: Row | undefined, fn: (x: CaseResult | undefined) => string | undefined) => {
    if (!r) return '';
    const vals = targets.map((t) => ({ t, v: fn(r.results[t.id]) }));
    const present = vals.filter((x) => x.v && x.v !== '—');
    if (present.length === 0) return '—';
    if (!multi || (present.length === vals.length && new Set(present.map((x) => x.v)).size === 1))
      return present[0]!.v!;
    return present.map((x) => `${x.t.model} ${x.v}`).join(' · ');
  };

  const caseHref = (row: Row) => {
    const deviceId = primaryDevice(targets, row.results);
    return deviceId && row.results[deviceId] ? traceUrl(projectId, d.cycle.id, row.tc.tcId, deviceId) : undefined;
  };

  const columns = useMemo<(ColDef<Row> | ColGroupDef<Row>)[]>(() => {
    const classify = (c: ColDef<Row>): ColDef<Row> => ({
      filter: 'agTextColumnFilter',
      suppressHeaderFilterButton: false,
      ...c,
    });
    const text = (c: ColDef<Row>): ColDef<Row> => ({ tooltipValueGetter: (p) => p.valueFormatted ?? p.value, ...c });
    return [
      {
        headerName: 'TC ID',
        colId: 'tcId',
        valueGetter: (p) => p.data?.tc.tcId,
        pinned: 'left',
        width: 168,
        cellRenderer: TcIdCell,
        cellRendererParams: { href: caseHref },
        sort: undefined,
      },
      text({ headerName: '제목', colId: 'title', valueGetter: (p) => p.data?.tc.title, width: 260 }),
      {
        headerName: '식별',
        children: [
          {
            headerName: '출처',
            colId: 'source',
            valueGetter: (p) => p.data && shortId(p.data.tc.sourceId),
            width: 96,
            cellClass: 'qc-mono',
          },
          text({
            headerName: '요구사항 ID',
            colId: 'reqs',
            valueGetter: (p) => p.data?.tc.requirementIds.map(shortId).join(', '),
            width: 150,
            cellClass: 'qc-mono',
          }),
          {
            headerName: '변경',
            colId: 'change',
            valueGetter: (p) => p.data && CHANGE_LABEL[p.data.tc.change],
            width: 80,
          },
        ],
      },
      {
        headerName: '분류',
        children: [
          classify(text({ headerName: '기능', colId: 'feature', valueGetter: (p) => p.data?.tc.feature, width: 160 })),
          classify(
            text({
              headerName: '세부 기능',
              colId: 'subFeature',
              valueGetter: (p) => p.data?.tc.subFeature,
              width: 200,
            }),
          ),
          classify({
            headerName: '테스트 유형',
            colId: 'type',
            valueGetter: (p) => p.data && TEST_TYPE_LABEL[p.data.tc.type],
            width: 112,
          }),
          classify({
            headerName: '우선순위',
            colId: 'priority',
            valueGetter: (p) => p.data && PRIORITY_LABEL[p.data.tc.priority],
            width: 104,
          }),
          classify({
            headerName: '플랫폼',
            colId: 'platform',
            valueGetter: (p) => p.data && PLATFORM_LABEL[p.data.tc.platform],
            width: 96,
          }),
          classify({
            headerName: '수행 방식',
            colId: 'mode',
            valueGetter: (p) => p.data && (p.data.tc.mode === 'auto' ? 'Auto' : 'Manual'),
            width: 104,
          }),
        ],
      },
      {
        headerName: '내용',
        children: [
          text({
            headerName: '사전 조건',
            colId: 'pre',
            valueGetter: (p) =>
              p.data &&
              [...p.data.tc.preconditions, p.data.tc.cleanState ? '클린 상태 필요' : undefined]
                .filter(Boolean)
                .join(' / '),
            width: 220,
          }),
          text({ headerName: '테스트 데이터', colId: 'data', valueGetter: (p) => p.data?.tc.data ?? '—', width: 130 }),
          text({
            headerName: '테스트 절차',
            colId: 'steps',
            valueGetter: (p) =>
              p.data?.tc.steps.map((s, i) => `${i + 1}. ${s.text}${s.manual ? ' (수동)' : ''}`).join(' '),
            width: 260,
          }),
          text({
            headerName: '기대 결과',
            colId: 'expected',
            valueGetter: (p) => p.data?.tc.verificationPoints.map((v) => v.expected).join(' / '),
            width: 280,
          }),
        ],
      },
      {
        headerName: '결과',
        children: [
          ...targets.map((t): ColDef<Row> => ({
            headerName: t.label,
            headerTooltip: `${t.label} 결과 — 셀을 누르면 판정 추적 뷰`,
            colId: `${DEVICE_COL}${t.id}`,
            valueGetter: (p) => {
              const r = p.data?.results[t.id];
              return r ? VERDICT_LABEL[r.verdict] : '';
            },
            tooltipValueGetter: (p) => {
              const r = p.data?.results[t.id];
              const s = oneLineSummary(r);
              return r ? `${VERDICT_LABEL[r.verdict]}${s ? ` — ${s}` : ''}` : undefined;
            },
            cellRenderer: ResultCell,
            width: wide ? 210 : 220,
            // 넓은 화면에서는 결과 열을 오른쪽에 고정해 가로 스크롤 없이 보이게 한다
            pinned: wide ? 'right' : undefined,
          })),
          {
            headerName: '판정 주체',
            colId: 'decidedBy',
            valueGetter: (p) => perDevice(p.data, decidedByLabel),
            width: 200,
            tooltipValueGetter: (p) => p.value,
          },
          {
            headerName: '결함 ID',
            colId: 'defect',
            // 결함이 연결되지 않은 Fail 칸이 있으면 "결함 없음"을 함께 보인다 (F-RP-19)
            valueGetter: (p) => {
              if (!p.data) return undefined;
              const results = Object.values(p.data.results);
              const ids = [...new Set(results.map((r) => r?.defectId).filter(Boolean))];
              const missing = results.some((r) => r?.verdict === 'fail' && !r.defectId);
              return [...ids, ...(missing ? ['결함 없음'] : [])].join(', ') || '—';
            },
            width: 120,
            cellClass: 'qc-mono',
            cellClassRules: { 'qs-no-defect': (p) => String(p.value ?? '').includes('결함 없음') },
          },
          {
            headerName: '수행일 / 수행자',
            colId: 'executed',
            valueGetter: (p) =>
              perDevice(p.data, (r) =>
                r?.executedAt ? `${fmtDateTime(r.executedAt)} ${r.executor ?? ''}`.trim() : undefined,
              ),
            tooltipValueGetter: (p) => p.value,
            width: 240,
          },
          text({
            headerName: '비고',
            colId: 'note',
            valueGetter: (p) => perDevice(p.data, (r) => r?.note),
            width: 200,
          }),
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, wide, projectId, d.cycle.id]);

  const open = (colId: string | undefined, row: Row | undefined) => {
    if (!row) return;
    if (colId === 'tcId') {
      const href = caseHref(row);
      if (href) navigate(href);
      return;
    }
    if (!colId?.startsWith(DEVICE_COL)) return;
    const deviceId = colId.slice(DEVICE_COL.length);
    if (!row.results[deviceId]) return;
    navigate(traceUrl(projectId, d.cycle.id, row.tc.tcId, deviceId));
  };

  return (
    <TabBody>
      <div className="qs-toolbar">
        <div className="qs-row" role="group" aria-label="판정 필터">
          <Chip size="small" active={verdict === 'all'} onClick={() => setVerdict('all')}>
            전체 {d.cases.length}
          </Chip>
          {VERDICTS.filter((v) => v !== 'na' || counts.na > 0).map((v) => (
            <Chip key={v} size="small" active={verdict === v} onClick={() => setVerdict(v)} disabled={counts[v] === 0}>
              {VERDICT_LABEL[v]} {counts[v]}
            </Chip>
          ))}
        </div>
        <div style={{ width: 'min(320px, 100%)' }}>
          <TextField
            aria-label="케이스 검색"
            placeholder="TC ID, 출처, 제목, 요구사항으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onReset={() => setQuery('')}
            size="medium"
            width="100%"
            leadingContent={
              <TextFieldContent variant="icon">
                <Icons.IconSearch />
              </TextFieldContent>
            }
          />
        </div>
      </div>
      <div className={`${textClass('caption1')} qs-muted`}>
        {visible.length === d.cases.length ? `${d.cases.length}건` : `${visible.length} / ${d.cases.length}건`} · 판정
        필터는 디바이스 중 한 칸이라도 해당하면 표시 · TC ID를 누르면 판정 추적 뷰 (결과 셀은 그 디바이스로 바로)
      </div>
      <div className="qs-grid">
        <AgGridReact<Row>
          theme={qcardGridTheme}
          rowData={visible}
          columnDefs={columns}
          getRowId={(p) => p.data.tc.tcId}
          defaultColDef={{ resizable: true, sortable: true, suppressHeaderMenuButton: true }}
          tooltipShowDelay={300}
          onCellClicked={(e: CellClickedEvent<Row>) => open(e.column.getColId(), e.data)}
          onCellKeyDown={(e: CellKeyDownEvent<Row>) => {
            const ev = e.event as KeyboardEvent | undefined;
            if (ev?.key === 'Enter') open(e.column.getColId(), e.data);
          }}
          overlayNoRowsTemplate="조건에 맞는 케이스가 없습니다"
        />
      </div>
    </TabBody>
  );
}

function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}
