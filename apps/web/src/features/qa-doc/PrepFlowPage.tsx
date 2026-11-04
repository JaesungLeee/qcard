import { prepFlowDeleteBlocker, type PrepFlow, type PrepFlowUse } from '@qcard/shared';
import { Button, Icons, Option, Select, TextButton, textClass, token } from '@qcard/ui';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime } from '../../components/format';
import type { DocRef } from '../../data/api';
import { useDeletePrepFlow, useMyRole, usePrepFlowUses, usePrepFlows, useQaDocs } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';
import { Tag } from './Badges';
import { PrepFlowForm } from './PrepFlowForm';
import { RichText } from './RichText';
import { PREP_KIND_LABEL } from './params';
import './qa-doc.css';

/**
 * 준비 플로우 (docs/product/prep-flows.md): QA 문서 버전마다 사본을 두는 공통 사전조건. Admin·QA가 추가·편집·삭제하고 Viewer는 읽기만 한다.
 * 주소: `?doc=<id>`는 볼 QA 문서 버전(없으면 최신), `?new=1`은 추가 폼, `?edit=<id>`는 그 플로우의 편집 폼,
 * `?uses=<id>`는 그 플로우를 쓰는 케이스 목록을 연다
 */
export function PrepFlowPage() {
  const { projectId = '' } = useParams();
  const role = useMyRole(projectId);
  const editor = role.data === 'admin' || role.data === 'qa';
  const docs = useQaDocs(projectId);
  const [params, setParams] = useSearchParams();
  const latestDocs = useMemo(
    () => [...(docs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [docs.data],
  );
  const current = latestDocs.find((d) => d.id === params.get('doc')) ?? latestDocs[0];
  const docRef: DocRef = { projectId, docId: current?.id ?? '' };
  const flows = usePrepFlows(projectId, current?.id);
  const uses = usePrepFlowUses(projectId, docRef.docId);
  const param = (key: string, value?: string) =>
    setParams(
      (p) => {
        // 폼은 하나만 연다. 버전을 바꾸면 열린 폼·사용처를 닫는다
        if (value && key === 'new') p.delete('edit');
        if (value && key === 'edit') p.delete('new');
        if (key === 'doc') ['new', 'edit', 'uses'].forEach((k) => p.delete(k));
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const adding = editor && params.get('new') !== null;
  const editing = editor ? (params.get('edit') ?? undefined) : undefined;
  return (
    <div className="qc-page">
      <PageHeader
        title="준비 플로우"
        meta="“온보딩 완료” 같은 공통 사전조건입니다. Agent가 먼저 확인 조건을 보고, 충족되지 않으면 수행 스텝을 UI로 실행합니다. 준비에 실패한 케이스는 Blocked가 됩니다. QA 문서 버전마다 따로 두며, 새 버전은 이전 버전에서 이어받습니다."
        actions={
          editor &&
          current &&
          !adding && (
            <Button
              variant="solid"
              color="primary"
              leadingContent={<Icons.IconPlus />}
              onClick={() => param('new', '1')}
            >
              준비 플로우 추가
            </Button>
          )
        }
      />
      <QueryState query={docs}>
        {() =>
          current ? (
            <>
              <div className="qd-flow-version">
                <Select aria-label="QA 문서 버전" value={current.id} onChange={(v) => param('doc', String(v))}>
                  {latestDocs.map((d, i) => (
                    <Option key={d.id} value={d.id}>
                      QA 문서 {d.appVersion}
                      {i === 0 ? ' (최신)' : ''} · {fmtDateTime(d.createdAt)}
                    </Option>
                  ))}
                </Select>
              </div>
              <QueryState query={flows}>
                {(list) => {
                  const edited = list.find((f) => f.id === editing);
                  return (
                    <>
                      {/* 폼은 목록 위에 둔다 — 카드 칸에서는 좁고, 줄 끝으로 밀리면 어디를 고치는지 놓친다 */}
                      {(adding || edited) && (
                        <article className="qc-card qd-flow-form">
                          <PrepFlowForm
                            key={edited?.id ?? 'new'}
                            docRef={docRef}
                            appVersion={current.appVersion}
                            flow={edited}
                            onDone={() => param(edited ? 'edit' : 'new')}
                          />
                        </article>
                      )}
                      <div className="qd-cards">
                        {list
                          .filter((f) => f !== edited)
                          .map((f) => (
                            <FlowCard
                              key={f.id}
                              flow={f}
                              docRef={docRef}
                              uses={uses.data?.[f.id]}
                              editor={editor}
                              open={params.get('uses') === f.id}
                              onOpen={(v) => param('uses', v ? f.id : undefined)}
                              onEdit={() => param('edit', f.id)}
                            />
                          ))}
                        {list.length === 0 && !adding && (
                          <p className={`${textClass('body2-reading')} qd-muted`}>
                            QA 문서 {current.appVersion}에는 준비 플로우가 없습니다. 직접 추가할 수 있습니다.
                          </p>
                        )}
                      </div>
                    </>
                  );
                }}
              </QueryState>
            </>
          ) : (
            <p className={`${textClass('body2-reading')} qd-muted`}>
              아직 QA 문서가 없습니다. 준비 플로우는 QA 문서 버전마다 두며, QA 문서를 만들면 스펙의 사전조건에서 후보를
              제안합니다.
            </p>
          )
        }
      </QueryState>
    </div>
  );
}

function FlowCard({
  flow: f,
  docRef,
  uses,
  editor,
  open,
  onOpen,
  onEdit,
}: {
  flow: PrepFlow;
  docRef: DocRef;
  /** 계산 중이면 undefined */
  uses?: PrepFlowUse[];
  editor: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  onEdit: () => void;
}) {
  const del = useDeletePrepFlow(docRef);
  const [confirm, setConfirm] = useState(false);
  const list = uses ?? [];
  const blocker = uses && prepFlowDeleteBlocker(uses);
  return (
    <article className="qc-card qd-stack" style={{ gap: token('space-16') }} aria-label={f.name}>
      <div className="qd-stack" style={{ gap: token('space-6') }}>
        <div className="qd-row" style={{ justifyContent: 'space-between' }}>
          <Tag tone={f.kind === 'env' ? 'neutral' : f.kind === 'login' || f.kind === 'restore' ? 'blue' : 'violet'}>
            {PREP_KIND_LABEL[f.kind]}
          </Tag>
          <span className={`${textClass('caption1')} qc-mono qd-faint`}>{f.id}</span>
        </div>
        <h2 className={textClass('headline2', 'bold')}>{f.name}</h2>
      </div>

      <div className="qd-block">
        <h3 className={`${textClass('label2', 'medium')} qd-block-title`}>확인 조건</h3>
        <div className={`${textClass('label1')} qd-source`}>
          <span>
            <RichText text={f.check} />
          </span>
        </div>
      </div>

      <div className="qd-block">
        <h3 className={`${textClass('label2', 'medium')} qd-block-title`}>
          수행 스텝 {f.steps.length}
          {f.kind === 'env' && ' · 코드가 수행'}
        </h3>
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
          {uses ? (
            <>
              <span className={`${textClass('label1', 'bold')} qc-mono`}>{list.length}</span>
              <span className="qd-muted">개 케이스가 사용</span>
            </>
          ) : (
            <span className="qd-faint">사용처 계산 중…</span>
          )}
        </span>
        {list.length > 0 && (
          <TextButton size="small" color="assistive" type="button" onClick={() => onOpen(!open)} aria-expanded={open}>
            {open ? '접기' : '사용하는 케이스'}
          </TextButton>
        )}
      </div>
      {open && list.length > 0 && <UseList uses={list} projectId={docRef.projectId} />}
      {f.updatedBy && f.updatedAt && (
        <span className={`${textClass('caption1')} qd-faint`}>
          {f.updatedBy} · {f.updatedAt.slice(0, 10)} 편집 · rev {f.rev ?? 0}
        </span>
      )}

      {editor && (
        <div className="qd-stack" style={{ gap: token('space-8') }}>
          <ErrorMessage error={del.error} title="삭제할 수 없습니다" />
          {confirm ? (
            <div className="qd-row" style={{ justifyContent: 'flex-end' }}>
              <span className={`${textClass('label2')} qd-muted`} style={{ marginRight: 'auto' }}>
                이 플로우를 삭제할까요?
              </span>
              <Button size="small" variant="outlined" color="assistive" type="button" onClick={() => setConfirm(false)}>
                취소
              </Button>
              <Button
                size="small"
                variant="solid"
                color="negative"
                type="button"
                leadingContent={<Icons.IconTrash />}
                loading={del.isPending}
                onClick={() => del.mutate(f.id, { onSuccess: () => setConfirm(false) })}
              >
                삭제
              </Button>
            </div>
          ) : (
            <div className="qd-row" style={{ justifyContent: 'flex-end' }}>
              {blocker && (
                <span className={`${textClass('caption1')} qd-faint`} style={{ marginRight: 'auto' }}>
                  사용 중이라 삭제할 수 없음
                </span>
              )}
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                type="button"
                leadingContent={<Icons.IconTrash />}
                disabled={!uses || !!blocker}
                title={blocker}
                onClick={() => setConfirm(true)}
              >
                삭제
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                type="button"
                leadingContent={<Icons.IconPencil />}
                onClick={onEdit}
              >
                편집
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 쓰는 곳(QA 문서 버전·사이클)별로 케이스를 묶어 보인다. 많으면 앞의 몇 개만 */
function UseList({ uses, projectId }: { uses: PrepFlowUse[]; projectId: string }) {
  const groups = new Map<string, PrepFlowUse[]>();
  for (const u of uses) {
    const k = u.in === 'doc' ? `doc:${u.docId}` : `cycle:${u.cycleId}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  const SHOW = 5;
  return (
    <div className="qd-stack qd-uses" style={{ gap: token('space-12') }}>
      {[...groups.values()].map((g) => {
        const first = g[0]!;
        const href = (u: PrepFlowUse) =>
          u.in === 'doc' ? `/p/${projectId}/docs/${u.docId}?case=${u.tcId}` : `/p/${projectId}/cycles/${u.cycleId}`;
        return (
          <div key={href(first)} className="qd-stack" style={{ gap: token('space-4') }}>
            <span className={textClass('label2', 'bold')}>
              {first.in === 'doc' ? `QA 문서 ${first.appVersion}` : `사이클 “${first.cycleName}”`}{' '}
              <span className="qd-muted">· {g.length}개</span>
            </span>
            <span className={`${textClass('label2')} qd-row`} style={{ gap: token('space-8') }}>
              {g.slice(0, SHOW).map((u) =>
                u.in === 'doc' ? (
                  <Link key={u.tcId} className="qd-link qc-mono" to={href(u)}>
                    {u.tcId}
                  </Link>
                ) : (
                  <span key={u.tcId} className="qc-mono">
                    {u.tcId}
                  </span>
                ),
              )}
              {g.length > SHOW && <span className="qd-faint">외 {g.length - SHOW}개</span>}
              {first.in === 'cycle' && (
                <Link className="qd-link" to={href(first)}>
                  사이클 보기
                </Link>
              )}
            </span>
          </div>
        );
      })}
      <span className={`${textClass('caption1')} qd-faint`}>
        삭제하려면 이 버전의 케이스에서 이 플로우를 빼세요. 이 버전으로 만든 진행 중인 사이클의 케이스 사본은 사이클을
        완료하면 풀립니다.
      </span>
    </div>
  );
}
