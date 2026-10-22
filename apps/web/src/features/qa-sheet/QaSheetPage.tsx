// 사이클 QA 시트 (PRD §5.10): ① 요약 ② 테스트 케이스 ③ 결함 목록 ④ 추적성 매트릭스 ⑤ 환경
import { Tab, TabList, TabListItem, TabPanel, token } from '@qcard/ui';
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { CycleDetail } from '../../data/api';
import { useCycle, useProject } from '../../data/hooks';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { CasesTab } from './CasesTab';
import { DefectsTab } from './DefectsTab';
import { EnvTab } from './EnvTab';
import { indexResults, parseTab, type QaTab, type ResultIndex } from './model';
import { SERVER_ENV_LABEL, periodLabel } from './parts';
import { SummaryTab } from './SummaryTab';
import { TraceabilityTab } from './TraceabilityTab';
import './qa-sheet.css';

export type SheetProps = { d: CycleDetail; index: ResultIndex; projectId: string; projectName: string };

export function QaSheetPage() {
  const { projectId = '', cycleId = '' } = useParams();
  const cycle = useCycle(projectId, cycleId);
  return (
    <div className="qc-page">
      <QueryState query={cycle}>{(d) => <Sheet d={d} projectId={projectId} />}</QueryState>
    </div>
  );
}

function Sheet({ d, projectId }: { d: CycleDetail; projectId: string }) {
  const project = useProject(projectId);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const index = useMemo(() => indexResults(d.results), [d.results]);
  const setTab = (t: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('tab', t);
        return next;
      },
      { replace: true },
    );
  const props: SheetProps = { d, index, projectId, projectName: project.data?.name ?? projectId };
  const check = d.results.filter((r) => r.verdict === 'check').length;

  const TABS: { value: QaTab; label: string; count?: number }[] = [
    { value: 'summary', label: '요약' },
    { value: 'cases', label: '테스트 케이스', count: d.cases.length },
    { value: 'defects', label: '결함 목록', count: d.defects.length },
    { value: 'traceability', label: '추적성 매트릭스' },
    { value: 'env', label: '환경' },
  ];

  const local = d.cycle.origin === 'local_run';
  return (
    <>
      <PageHeader
        crumbs={[{ label: '테스트 사이클', to: `/p/${projectId}/cycles` }, { label: d.cycle.name }]}
        title={d.cycle.name}
        meta={
          <span className="qs-row" style={{ columnGap: token('space-16'), rowGap: token('space-2') }}>
            {local ? (
              <span>로컬 실행 · 설치된 앱 {d.build.packageName}</span>
            ) : (
              <span>
                빌드 {d.build.version} ({d.build.buildNumber})
              </span>
            )}
            <span>QA 문서 v{d.doc.appVersion}</span>
            <span>기간 {periodLabel(d.cycle.period)}</span>
            {!local && <span>서버 {SERVER_ENV_LABEL[d.cycle.serverEnv]}</span>}
            {check > 0 && <span style={{ color: token('qcard-verdict-check-fg') }}>확인필요 {check}칸</span>}
          </span>
        }
      />
      <Tab value={tab} onValueChange={setTab}>
        <div className="qs-scroll-x">
          <TabList size="medium" resize="hug">
            {TABS.map((t, i) => (
              <TabListItem key={t.value} value={t.value}>
                {`${'①②③④⑤'[i]} ${t.label}${t.count !== undefined ? ` ${t.count}` : ''}`}
              </TabListItem>
            ))}
          </TabList>
        </div>
        <TabPanel value="summary">
          <SummaryTab {...props} />
        </TabPanel>
        <TabPanel value="cases">
          <CasesTab {...props} />
        </TabPanel>
        <TabPanel value="defects">
          <DefectsTab {...props} />
        </TabPanel>
        <TabPanel value="traceability">
          <TraceabilityTab {...props} />
        </TabPanel>
        <TabPanel value="env">
          <EnvTab {...props} />
        </TabPanel>
      </Tab>
    </>
  );
}
