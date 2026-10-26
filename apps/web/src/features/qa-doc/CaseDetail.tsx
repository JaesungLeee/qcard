import {
  PLATFORM_LABEL,
  POINT_COMPARE_LABEL,
  POINT_METHOD_LABEL,
  type PrepFlow,
  PRIORITY_LABEL,
  type QADocument,
  TEST_TYPE_LABEL,
  type CaseBody,
  type TestCase,
} from '@qcard/shared';
import { Button, IconButton, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { fmtDateTime } from '../../components/format';
import { useSetApproval } from '../../data/hooks';
import { ApprovalBadge, ChangeBadge, ModeBadge, StepRiskTag, Tag } from './Badges';
import { CaseDiff } from './CaseDiff';
import { CaseEditForm } from './CaseEditForm';
import { diffCase, shortReq, shortSource, toBody } from './logic';
import { RichText } from './RichText';
import { useDocHref, useDocParams } from './params';

export function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="qd-block">
      <div className="qd-row" style={{ justifyContent: 'space-between' }}>
        <h3 className={`${textClass('label2', 'medium')} qd-block-title`}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 선택한 케이스의 상세: 보기·편집·승인 (F-QD-04, F-QD-09, F-QD-10) */
export function CaseDetail({
  doc,
  c,
  prepFlows,
  onClose,
}: {
  doc: QADocument;
  c: TestCase;
  prepFlows: PrepFlow[];
  onClose: () => void;
}) {
  const { edit, set } = useDocParams();
  const href = useDocHref();
  const setApproval = useSetApproval(doc);
  const prepName = useMemo(() => {
    const byId = new Map(prepFlows.map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [prepFlows]);
  const removed = c.change === 'removed';
  const held = c.approval.status === 'held';
  const questions = doc.questions.filter((q) => c.questionIds.includes(q.id) || q.caseIds.includes(c.tcId));
  const openQuestions = questions.filter((q) => q.status === 'open');
  const diffs = useMemo(() => (c.previous ? diffCase(c.previous, toBody(c), prepName) : []), [c, prepName]);
  const approve = (status: 'approved' | 'rejected' | 'pending') => setApproval.mutate({ tcIds: [c.tcId], status });

  return (
    <aside className="qc-card qd-panel" aria-label={`${c.tcId} 상세`}>
      {/* 머리 */}
      <div className="qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <span className="qd-row">
            <span className={`${textClass('label1', 'bold')} qc-mono`}>{c.tcId}</span>
            <ChangeBadge change={c.change} />
            {!removed && <ApprovalBadge status={c.approval.status} />}
          </span>
          <IconButton aria-label="상세 닫기" size="medium" onClick={onClose}>
            <Icons.IconClose />
          </IconButton>
        </div>
        <h2
          className={textClass('headline2', 'bold')}
          style={removed ? { color: token('foreground-neutral-tertiary') } : undefined}
        >
          {c.title}
        </h2>
        <div className={`${textClass('label2')} qd-faint`}>
          <span className="qc-mono">{c.sourceId}</span>
          <span className="qd-dot-sep" />
          rev <span className="qc-mono">{c.rev}</span>
          {c.updatedBy && c.updatedAt && (
            <>
              <span className="qd-dot-sep" />
              {c.updatedBy} · <span className="qd-num">{fmtDateTime(c.updatedAt)}</span> 수정
            </>
          )}
        </div>
      </div>

      {/* 상태별 안내 + 승인 동작 */}
      {removed ? (
        <SectionMessage
          variant="info"
          description={`출처 ${shortSource(c.sourceId)}가 이번 버전 스펙에서 사라졌습니다. 이전 버전 기록 확인용으로만 남겨 둡니다.`}
        >
          삭제됨 — 다음 사이클에서 제외
        </SectionMessage>
      ) : held ? (
        <SectionMessage
          variant="cautionary"
          description={
            <span>
              스펙 확인 질문{' '}
              {openQuestions.map((q, i) => (
                <span key={q.id}>
                  {i > 0 && ', '}
                  <Link className="qd-link" to={href({ tab: 'questions', question: q.id, case: null, edit: null })}>
                    {q.id}
                  </Link>
                </span>
              ))}
              {openQuestions.length === 0 && '(없음)'}에 답변이 없어 승인할 수 없습니다. 답변하거나 "현 스펙대로 진행"을
              고르면 보류가 풀립니다.
            </span>
          }
        >
          승인 보류
        </SectionMessage>
      ) : (
        !edit && (
          <div className="qd-stack" style={{ gap: token('space-8') }}>
            <div className="qd-row">
              {c.approval.status !== 'approved' && (
                <Button
                  size="small"
                  variant="solid"
                  color="primary"
                  leadingContent={<Icons.IconCheck />}
                  loading={setApproval.isPending}
                  onClick={() => approve('approved')}
                >
                  승인
                </Button>
              )}
              {c.approval.status !== 'rejected' && (
                <Button
                  size="small"
                  variant="solid"
                  color="negative"
                  disabled={setApproval.isPending}
                  onClick={() => approve('rejected')}
                >
                  반려
                </Button>
              )}
              {c.approval.status !== 'pending' && (
                <Button
                  size="small"
                  variant="outlined"
                  color="assistive"
                  disabled={setApproval.isPending}
                  onClick={() => approve('pending')}
                >
                  {c.approval.status === 'approved' ? '승인 취소' : '반려 취소'}
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                leadingContent={<Icons.IconPencil />}
                onClick={() => set({ edit: '1' })}
              >
                편집
              </Button>
            </div>
            {c.approval.status === 'approved' && c.approval.by && c.approval.at && (
              <span className={`${textClass('label2')} qd-faint`}>
                {c.approval.by} · <span className="qd-num">{fmtDateTime(c.approval.at)}</span> 승인 · 내용 해시{' '}
                <span className="qc-mono">{c.approval.contentHash}</span>
              </span>
            )}
            {c.approval.status === 'rejected' && c.approval.by && c.approval.at && (
              <span className={`${textClass('label2')} qd-faint`}>
                {c.approval.by} · <span className="qd-num">{fmtDateTime(c.approval.at)}</span> 반려
              </span>
            )}
          </div>
        )
      )}
      {held && !edit && (
        <div className="qd-row">
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconPencil />}
            onClick={() => set({ edit: '1' })}
          >
            편집
          </Button>
        </div>
      )}

      {edit && !removed ? (
        <CaseEditForm doc={doc} c={c} prepFlows={prepFlows} onDone={() => set({ edit: null })} />
      ) : (
        <CaseView doc={doc} c={c} prepName={prepName} diffs={diffs} />
      )}
    </aside>
  );
}

function CaseView({
  doc,
  c,
  prepName,
  diffs,
}: {
  doc: QADocument;
  c: TestCase;
  prepName: (id: string) => string;
  diffs: ReturnType<typeof diffCase>;
}) {
  const reqs = c.requirementIds.map((id) => ({ id, req: doc.requirements.find((r) => r.id === id) }));
  return (
    <>
      {c.change === 'changed' && c.previous && (
        <Block title="이전 버전 대비 변경">
          <p className={`${textClass('label2')} qd-muted`}>
            출처 행이나 관련 요구사항이 바뀌어 다시 만든 케이스입니다. 바뀐 부분을 확인하고 다시 승인하세요.
          </p>
          <CaseDiff diffs={diffs} />
        </Block>
      )}

      <Block title="요구사항">
        <ul className="qd-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
          {reqs.map(({ id, req }) => (
            <li key={id} className={textClass('label1')} style={{ display: 'flex', gap: token('space-8') }}>
              <span className="qc-mono" style={{ flex: 'none', color: token('foreground-brand-primary') }}>
                {shortReq(id)}
              </span>
              <span className="qd-muted">{req ? <RichText text={req.text} /> : '요구사항 원문 없음'}</span>
            </li>
          ))}
        </ul>
      </Block>

      <CaseBodyBlocks body={c} tcId={c.tcId} prepName={prepName}>
        <dt>세부 기능</dt>
        <dd>
          {c.feature} › {c.subFeature}
        </dd>
      </CaseBodyBlocks>

      <Block title="원본 스펙 근거">
        <div className={`${textClass('label2')} qd-source`}>
          <span className="qc-mono">{c.sourceRef.file}</span>
          <span className="qd-muted">{c.sourceRef.headingPath.join(' › ')}</span>
          <span className="qd-faint">
            {c.sourceRef.lineStart === c.sourceRef.lineEnd
              ? `${c.sourceRef.lineStart}번째 줄`
              : `${c.sourceRef.lineStart}–${c.sourceRef.lineEnd}번째 줄`}{' '}
            · 출처 ID <span className="qc-mono">{c.sourceId}</span>
          </span>
        </div>
      </Block>
    </>
  );
}

/** 케이스 본문(준비·단계·검증 포인트·속성). 문서의 케이스와 생성 중인 초안이 함께 쓴다. children은 속성 끝에 붙는다 */
export function CaseBodyBlocks({
  body,
  tcId,
  prepName,
  children,
}: {
  body: CaseBody;
  tcId: string;
  prepName: (id: string) => string;
  children?: ReactNode;
}) {
  return (
    <>
      <Block title="준비">
        <dl className={`${textClass('label1')} qd-fields`}>
          <dt>사전 조건</dt>
          <dd>
            {body.preconditions.length === 1 ? (
              <RichText text={body.preconditions[0]!} />
            ) : body.preconditions.length ? (
              <ul className="qd-list">
                {body.preconditions.map((p, i) => (
                  <li key={i}>
                    <RichText text={p} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="qd-faint">없음</span>
            )}
          </dd>
          <dt>준비 플로우</dt>
          <dd>
            {body.prepFlowIds.length ? (
              <span className="qd-row" style={{ gap: token('space-4') }}>
                {body.prepFlowIds.map((id, i) => (
                  <span key={id} className="qd-row" style={{ gap: token('space-4') }}>
                    {i > 0 && (
                      <Icons.IconChevronRightSmall
                        aria-hidden
                        style={{ color: token('foreground-neutral-quaternary') }}
                      />
                    )}
                    <Tag tone="quiet">{prepName(id)}</Tag>
                  </span>
                ))}
              </span>
            ) : (
              <span className="qd-faint">없음</span>
            )}
          </dd>
          <dt>클린 상태</dt>
          <dd>{body.cleanState ? '필요 — 시작 전 앱 데이터 초기화' : '필요 없음 — 앱 재시작만'}</dd>
          {body.accountKind && (
            <>
              <dt>필요 계정 종류</dt>
              <dd>{body.accountKind}</dd>
            </>
          )}
          {body.restoreFlowId && (
            <>
              <dt>원복 플로우</dt>
              <dd>
                <Tag tone="quiet">{prepName(body.restoreFlowId)}</Tag>
                <span className="qd-faint"> — 끝나면 수행, 실패하면 계정 격리</span>
              </dd>
            </>
          )}
          <dt>테스트 데이터</dt>
          <dd>{body.data ? <RichText text={body.data} /> : <span className="qd-faint">없음</span>}</dd>
        </dl>
      </Block>

      <Block title={`단계 ${body.steps.length}`}>
        <ol className={`${textClass('body2-reading')} qd-list`}>
          {body.steps.map((s, i) => (
            <li key={i}>
              <RichText text={s.text} />{' '}
              {s.manual && s.risk !== 'human' && (
                <Tag tone="blocked" title="실행자가 직접 수행하는 스텝">
                  수동
                </Tag>
              )}{' '}
              <StepRiskTag risk={s.risk} />
            </li>
          ))}
        </ol>
      </Block>

      <Block title={`검증 포인트 ${body.verificationPoints.length}`}>
        <div className="qd-points">
          {body.verificationPoints.map((p) => (
            <div key={p.id} className="qd-point">
              <div className="qd-row" style={{ gap: token('space-6') }}>
                <span className={`${textClass('caption1')} qc-mono qd-faint`}>{p.id.replace(`${tcId}-`, '')}</span>
                <span className={textClass('label2', 'medium')}>{p.target}</span>
                <Tag tone="quiet">{POINT_COMPARE_LABEL[p.compare]}</Tag>
                <Tag tone={p.method === 'vision' ? 'violet' : 'neutral'}>{POINT_METHOD_LABEL[p.method]}</Tag>
              </div>
              <div className={textClass('body2-reading')}>
                <RichText text={p.expected} />
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="속성">
        <dl className={`${textClass('label1')} qd-fields`}>
          <dt>우선순위</dt>
          <dd>{PRIORITY_LABEL[body.priority]}</dd>
          <dt>유형</dt>
          <dd>{TEST_TYPE_LABEL[body.type]}</dd>
          <dt>플랫폼</dt>
          <dd>{PLATFORM_LABEL[body.platform]}</dd>
          <dt>수행 방식</dt>
          <dd>
            <ModeBadge c={body} />
          </dd>
          {children}
        </dl>
      </Block>
    </>
  );
}
