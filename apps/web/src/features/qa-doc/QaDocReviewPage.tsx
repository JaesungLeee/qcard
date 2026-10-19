import type { QADocument } from '@qcard/shared';
import { Button, Icons, Tab, TabList, TabListItem, token } from '@qcard/ui';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime } from '../../components/format';
import { usePrepFlows, useQaDoc, useQaDocs, useSetApproval } from '../../data/hooks';
import { Progress, Tag } from './Badges';
import { CasesTab } from './CasesTab';
import { isSelectable } from './logic';
import { useDocParams } from './params';
import { QuestionsTab } from './QuestionsTab';
import { SuggestionsTab } from './SuggestionsTab';
import { TraceabilityTab } from './TraceabilityTab';
import './qa-doc.css';

/** QA 문서 검토·승인 (PRD §5.2) */
export function QaDocReviewPage() {
  const { projectId = '', docId = '' } = useParams();
  const doc = useQaDoc(docId);
  return (
    <div className="qc-page">
      <QueryState query={doc}>{(d) => <Review doc={d} projectId={projectId} />}</QueryState>
    </div>
  );
}

function Review({ doc, projectId }: { doc: QADocument; projectId: string }) {
  const { tab, set } = useDocParams();
  const docs = useQaDocs(projectId);
  const prepFlows = usePrepFlows(projectId);
  const setApproval = useSetApproval(doc.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionKey, setSelectionKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const prevVersion = docs.data?.find((d) => d.id === doc.prevDocId)?.appVersion;
  const counts = useMemo(() => {
    const c = { approved: 0, pending: 0, held: 0, rejected: 0 };
    for (const x of doc.cases) c[x.approval.status]++;
    return c;
  }, [doc.cases]);

  const selectable = doc.cases.filter((c) => selected.includes(c.tcId) && isSelectable(c));
  const toApprove = selectable.filter((c) => c.approval.status !== 'approved');

  const bulk = (status: 'approved' | 'rejected') => {
    const targets = status === 'approved' ? toApprove : selectable;
    if (targets.length === 0) return;
    setApproval.mutate(
      { tcIds: targets.map((c) => c.tcId), status },
      {
        onSuccess: () => {
          setNotice(`${targets.length}개 케이스를 ${status === 'approved' ? '승인' : '반려'}했습니다.`);
          setSelected([]);
          setSelectionKey((k) => k + 1);
        },
      },
    );
  };

  const changeTab = (next: string) => {
    set({ tab: next === 'cases' ? null : next, question: null, edit: null });
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'QA 문서', to: `/p/${projectId}/docs` }, { label: doc.appVersion }]}
        title={`QA 문서 ${doc.appVersion}`}
        meta={
          <span className="qd-meta">
            <span>
              <span className="qd-faint">스펙 묶음</span>
              <span className="qc-mono">{doc.specBundleId}</span>
              <span className="qd-faint">({doc.specs.map((s) => s.name).join(', ')})</span>
            </span>
            <span>
              <span className="qd-faint">생성</span>
              <span className="qd-num">{fmtDateTime(doc.createdAt)}</span>
            </span>
            <span>
              <span className="qd-faint">이전 버전</span>
              {doc.prevDocId ? (prevVersion ?? '…') : '없음 (최초 버전)'}
            </span>
            <span>
              <span className="qd-faint">승인</span>
              <Progress value={counts.approved} total={doc.cases.length} />
              {counts.pending > 0 && <Tag tone="neutral">미승인 {counts.pending}</Tag>}
              {counts.held > 0 && <Tag tone="check">보류 {counts.held}</Tag>}
              {counts.rejected > 0 && <Tag tone="fail">반려 {counts.rejected}</Tag>}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="outlined"
              color="assistive"
              leadingContent={<Icons.IconDownload />}
              disabled
              title="서버 연결 후 사용할 수 있습니다"
            >
              MD 다운로드
            </Button>
            <Button
              variant="outlined"
              color="primary"
              leadingContent={<Icons.IconCheck />}
              disabled={tab !== 'cases' || toApprove.length === 0}
              loading={setApproval.isPending}
              onClick={() => bulk('approved')}
            >
              일괄 승인{toApprove.length > 0 ? ` ${toApprove.length}` : ''}
            </Button>
          </>
        }
      />

      <div className="qd-stack" style={{ gap: token('space-16') }}>
        <Tab value={tab} onValueChange={changeTab}>
          <TabList size="medium">
            <TabListItem value="cases">케이스 {doc.cases.length}</TabListItem>
            <TabListItem value="questions">
              확인 질문 {doc.questions.length}
            </TabListItem>
            <TabListItem value="suggestions">보강 제안 {doc.suggestions.length}</TabListItem>
            <TabListItem value="traceability">추적성</TabListItem>
          </TabList>
        </Tab>

        {tab === 'cases' && (
          <CasesTab
            doc={doc}
            prepFlows={prepFlows.data ?? []}
            selected={selected}
            onSelectedChange={(ids) => {
              setSelected(ids);
              setNotice(null);
            }}
            selectionKey={selectionKey}
            onBulk={bulk}
            bulkPending={setApproval.isPending}
            notice={notice}
          />
        )}
        {tab === 'questions' && <QuestionsTab doc={doc} />}
        {tab === 'suggestions' && <SuggestionsTab doc={doc} />}
        {tab === 'traceability' && <TraceabilityTab doc={doc} />}
      </div>
    </>
  );
}
