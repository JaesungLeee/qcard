import type { PrepFlow } from '@qcard/fixtures';
import type { QADocument, TestCase } from '@qcard/shared';
import { Button, Icons, textClass, token } from '@qcard/ui';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePrepFlows, useQaDoc, useQaDocs } from '../../data/hooks';
import { Tag } from './Badges';
import { prepFlowUsage } from './logic';
import { RichText } from './RichText';
import { PREP_KIND_LABEL } from './params';
import './qa-doc.css';

/** 준비 플로우 (PRD §5.3): 프로젝트 단위 공통 사전조건 */
export function PrepFlowPage() {
  const { projectId = '' } = useParams();
  const flows = usePrepFlows(projectId);
  const docs = useQaDocs(projectId);
  const latestId = useMemo(
    () => [...(docs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.id,
    [docs.data],
  );
  return (
    <div className="qc-page">
      <PageHeader
        title="준비 플로우"
        meta="“온보딩 완료” 같은 공통 사전조건입니다. Agent가 먼저 확인 조건을 보고, 충족되지 않으면 수행 스텝을 UI로 실행합니다. 준비에 실패한 케이스는 Blocked가 됩니다."
        actions={
          <Button
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconPlus />}
            disabled
            title="서버 연결 후 사용할 수 있습니다"
          >
            준비 플로우 추가
          </Button>
        }
      />
      <QueryState query={flows}>
        {(list) =>
          latestId ? (
            <FlowsWithDoc flows={list} docId={latestId} projectId={projectId} />
          ) : (
            <FlowCards flows={list} projectId={projectId} />
          )
        }
      </QueryState>
    </div>
  );
}

function FlowsWithDoc({ flows, docId, projectId }: { flows: PrepFlow[]; docId: string; projectId: string }) {
  const doc = useQaDoc(docId);
  return <FlowCards flows={flows} doc={doc.data} projectId={projectId} />;
}

function FlowCards({ flows, doc, projectId }: { flows: PrepFlow[]; doc?: QADocument; projectId: string }) {
  const usage = useMemo(() => (doc ? prepFlowUsage(doc.cases) : new Map<string, TestCase[]>()), [doc]);
  return (
    <div className="qd-cards">
      {flows.map((f) => {
        const cases = usage.get(f.id) ?? [];
        return (
          <article key={f.id} className="qc-card qd-stack" style={{ gap: token('space-16') }}>
            <div className="qd-stack" style={{ gap: token('space-6') }}>
              <div className="qd-row" style={{ justifyContent: 'space-between' }}>
                <Tag tone={f.kind === 'env' ? 'neutral' : f.kind === 'login' ? 'blue' : 'violet'}>
                  {PREP_KIND_LABEL[f.kind]}
                </Tag>
                <span className={`${textClass('caption1')} qc-mono qd-faint`}>{f.id}</span>
              </div>
              <h2 className={textClass('headline2', 'bold')}>{f.name}</h2>
            </div>

            <div className="qd-block">
              <h3 className={`${textClass('label2', 'medium')} qd-block-title`}>확인 조건</h3>
              <div className={`${textClass('label1')} qd-source`}><span>
                  <RichText text={f.check} />
                </span>
              </div>
            </div>

            <div className="qd-block">
              <h3 className={`${textClass('label2', 'medium')} qd-block-title`}>수행 스텝 {f.steps.length}</h3>
              <ol className={`${textClass('label1')} qd-list`}>
                {f.steps.map((s, i) => (
                  <li key={i}>
                    <RichText text={s} />
                  </li>
                ))}
              </ol>
            </div>

            <hr className="qd-divider" style={{ marginTop: 'auto' }} />
            <div className="qd-row" style={{ justifyContent: 'space-between' }}>
              <span className={textClass('label1')}>
                {doc ? (
                  <>
                    <span className="qd-muted">QA 문서 {doc.appVersion}에서</span>{' '}
                    <span className={`${textClass('label1', 'bold')} qc-mono`}>{cases.length}</span>
                    <span className="qd-muted">개 케이스가 사용</span>
                  </>
                ) : (
                  <span className="qd-faint">사용처 계산 중…</span>
                )}
              </span>
              {doc && cases.length > 0 && (
                <Link
                  className={`${textClass('label2', 'medium')} qd-link`}
                  to={`/p/${projectId}/docs/${doc.id}?case=${cases[0]!.tcId}`}
                  title={cases.map((c) => c.tcId).join(', ')}
                >
                  첫 케이스 보기
                </Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
