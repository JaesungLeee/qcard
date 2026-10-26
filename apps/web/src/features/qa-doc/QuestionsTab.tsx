import type { CaseReviseJob, QADocument, SpecQuestion } from '@qcard/shared';
import { Button, Icons, SectionMessage, TextArea, textClass, token } from '@qcard/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { fmtDateTime } from '../../components/format';
import { useCaseRevisions, useCommentQuestion, useMyRole, useResolveQuestion } from '../../data/hooks';
import { Tag, type Tone } from './Badges';
import { CaseRevision } from './CaseRevision';
import {
  groupByCase,
  nextOpenCategory,
  NO_CASE_FEATURE,
  pickCategory,
  questionCategories,
  shortReq,
  type QuestionCategory,
  type QuestionGroup,
} from './logic';
import { RichText } from './RichText';
import { useDocHref, useDocParams } from './params';

const STATUS: Record<SpecQuestion['status'], { label: string; tone: Tone }> = {
  open: { label: '미답변', tone: 'check' },
  answered: { label: '답변됨', tone: 'pass' },
  proceed: { label: '현 스펙대로 진행', tone: 'neutral' },
};

const flowName = (c: QuestionCategory) =>
  c.subFeature || (c.feature === NO_CASE_FEATURE ? '질문' : '(유저 플로우 없음)');
const catName = (c: QuestionCategory) => `${c.feature} › ${flowName(c)}`;

/** 스펙 확인 질문 (F-QD-03). 기능 › 유저 플로우 카테고리를 하나씩 골라 그 안의 질문을 처리한다. */
export function QuestionsTab({ doc }: { doc: QADocument }) {
  const { question, feature, flow, set } = useDocParams();
  const cats = useMemo(() => questionCategories(doc), [doc]);
  const current = pickCategory(cats, { question, feature, flow });

  // 주소에 분류가 없으면 고른 카테고리를 적어 둔다. 마지막 질문을 처리해도 다음 카테고리로 저절로 넘어가지 않게
  useEffect(() => {
    if (!current || question) return;
    if (feature === current.feature && (flow ?? '') === current.subFeature) return;
    set({ feature: current.feature, flow: current.subFeature || null }, { replace: true });
  });

  if (!current) return <div className="qc-card qd-muted">이 QA 문서에는 스펙 확인 질문이 없습니다.</div>;

  const pick = (c: QuestionCategory) => set({ feature: c.feature, flow: c.subFeature || null, question: null });
  return (
    <div className="qd-cases">
      <QuestionNav cats={cats} current={current} onPick={pick} />
      <CategoryPanel doc={doc} cats={cats} current={current} onPick={pick} />
    </div>
  );
}

function QuestionNav({
  cats,
  current,
  onPick,
}: {
  cats: QuestionCategory[];
  current: QuestionCategory;
  onPick: (c: QuestionCategory) => void;
}) {
  const open = cats.reduce((n, c) => n + c.open, 0);
  const total = cats.reduce((n, c) => n + c.questions.length, 0);
  const features = [...new Set(cats.map((c) => c.feature))];
  return (
    <nav className={`qd-nav ${textClass('label1')}`} aria-label="질문 카테고리">
      <div className={`${textClass('label1', 'bold')} qd-nav-head`}>
        미답변 <span className="qc-mono">{open}</span>
        <span className={`${textClass('label2')} qd-faint`}>
          / 질문 <span className="qc-mono">{total}</span>
        </span>
      </div>
      {features.map((f) => (
        <div key={f} className="qd-nav-group">
          <div className={`${textClass('caption1', 'bold')} qd-nav-heading`} title={f}>
            {f}
          </div>
          {cats
            .filter((c) => c.feature === f)
            .map((c) => (
              <button
                key={c.subFeature}
                type="button"
                className="qd-nav-item"
                aria-current={c === current ? 'true' : undefined}
                onClick={() => onPick(c)}
              >
                <span className="qd-nav-label" title={flowName(c)}>
                  {flowName(c)}
                </span>
                {c.open > 0 ? (
                  <Tag tone="check" title={`미답변 ${c.open}건`}>
                    <span className="qc-mono">{c.open}</span>
                  </Tag>
                ) : (
                  <Tag tone="pass" title="모두 처리함">
                    <Icons.IconCheck aria-label="모두 처리함" className="qd-nav-done" />
                  </Tag>
                )}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}

function CategoryPanel({
  doc,
  cats,
  current,
  onPick,
}: {
  doc: QADocument;
  cats: QuestionCategory[];
  current: QuestionCategory;
  onPick: (c: QuestionCategory) => void;
}) {
  const { question } = useDocParams();
  const role = useMyRole(doc.projectId);
  const canEdit = role.data === 'admin' || role.data === 'qa';
  const revisions = useCaseRevisions(doc);
  const groups = useMemo(() => groupByCase(current.questions, doc.cases), [current, doc.cases]);
  const total = current.questions.length;
  const done = total - current.open;
  const next = nextOpenCategory(cats, current);

  return (
    <div className="qd-stack">
      <div className="qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-stack" style={{ gap: token('space-2') }}>
          <span className={`${textClass('label2', 'medium')} qd-faint`}>
            {current.feature === NO_CASE_FEATURE ? '카테고리' : `${current.feature} › 유저 플로우`}
          </span>
          <div className="qd-row" style={{ justifyContent: 'space-between' }}>
            <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
              {current.feature === NO_CASE_FEATURE ? NO_CASE_FEATURE : flowName(current)}
            </h2>
            <span className={`${textClass('label1')} qd-muted`}>
              처리 <span className="qc-mono">{done}</span> / <span className="qc-mono">{total}</span>
            </span>
          </div>
        </div>
        <div
          className="qd-progress"
          role="progressbar"
          aria-label="이 카테고리 질문 처리"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </div>

      {current.open === 0 && (
        <SectionMessage
          variant="positive"
          description={
            next
              ? `보류됐던 케이스는 이제 승인할 수 있습니다. 다음 카테고리: ${catName(next)} (미답변 ${next.open}건)`
              : '보류됐던 케이스는 이제 승인할 수 있습니다. 남은 미답변 질문이 없습니다.'
          }
          bottomButton={
            next && (
              <Button size="small" variant="solid" color="primary" onClick={() => onPick(next)}>
                다음 카테고리로
              </Button>
            )
          }
        >
          {next ? '이 카테고리의 질문을 모두 처리했습니다' : '모든 질문을 처리했습니다'}
        </SectionMessage>
      )}

      {groups.map((g) => (
        <CaseGroup
          key={g.caseId ?? ''}
          doc={doc}
          group={g}
          currentQuestion={question}
          revisions={revisions.data ?? []}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

function CaseGroup({
  doc,
  group,
  currentQuestion,
  revisions,
  canEdit,
}: {
  doc: QADocument;
  group: QuestionGroup;
  currentQuestion: string | null;
  revisions: CaseReviseJob[];
  canEdit: boolean;
}) {
  const href = useDocHref();
  return (
    <section className="qc-card qd-qgroup">
      <div className="qd-row qd-qgroup-head">
        {group.caseId ? (
          <Link className="qd-link" to={href({ tab: null, case: group.caseId, question: null, edit: null })}>
            <span className={`${textClass('label1', 'bold')} qc-mono`}>{group.caseId}</span>
          </Link>
        ) : (
          <span className={`${textClass('label1', 'bold')} qd-muted`}>연결 케이스 없음</span>
        )}
        {group.case && <span className={textClass('label1', 'bold')}>{group.case.title}</span>}
        {group.held && <Tag tone="check">승인 보류</Tag>}
      </div>
      {group.questions.map((q) => (
        <QuestionItem key={q.id} doc={doc} q={q} groupCaseId={group.caseId} current={q.id === currentQuestion} />
      ))}
      {group.case && <CaseRevision doc={doc} c={group.case} jobs={revisions} canEdit={canEdit} />}
    </section>
  );
}

function QuestionItem({
  doc,
  q,
  groupCaseId,
  current,
}: {
  doc: QADocument;
  q: SpecQuestion;
  groupCaseId: string | null;
  current: boolean;
}) {
  const href = useDocHref();
  const resolve = useResolveQuestion(doc);
  const comment = useCommentQuestion(doc);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const ref = useRef<HTMLElement>(null);
  const req = doc.requirements.find((r) => r.id === q.requirementId);
  const status = STATUS[q.status];
  const otherCases = q.caseIds.filter((id) => id !== groupCaseId);

  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'start' });
  }, [current]);

  return (
    <article
      ref={ref}
      id={`question-${q.id}`}
      className={`qd-stack qd-question${current ? ' qd-card-current' : ''}`}
      style={{ gap: token('space-16') }}
    >
      <div className="qd-stack" style={{ gap: token('space-8') }}>
        <div className="qd-row">
          <span className={`${textClass('label1', 'bold')} qc-mono`}>{q.id}</span>
          <Tag tone={status.tone}>{status.label}</Tag>
          <span className={`${textClass('label2')} qd-faint`} style={{ marginLeft: 'auto' }}>
            담당{' '}
            <span className={textClass('label2', 'medium')} style={{ color: token('foreground-neutral-secondary') }}>
              {q.assignee || '미지정'}
            </span>
          </span>
        </div>
        <p className={textClass('body2-reading')} style={{ margin: 0 }}>
          {q.text}
        </p>
      </div>

      <dl className={`${textClass('label1')} qd-fields`}>
        <dt>요구사항</dt>
        <dd>
          <span className="qc-mono" style={{ color: token('foreground-brand-primary') }}>
            {shortReq(q.requirementId)}
          </span>{' '}
          <span className="qd-muted">{req && <RichText text={req.text} />}</span>
        </dd>
        {otherCases.length > 0 && (
          <>
            <dt>다른 연결 케이스</dt>
            <dd>
              <span className="qd-row" style={{ gap: token('space-12') }}>
                {otherCases.map((id) => {
                  const c = doc.cases.find((x) => x.tcId === id);
                  return (
                    <Link key={id} className="qd-link" to={href({ tab: null, case: id, question: null, edit: null })}>
                      <span className="qc-mono">{id}</span>
                      {c && <span className="qd-muted"> {c.title}</span>}
                    </Link>
                  );
                })}
              </span>
            </dd>
          </>
        )}
      </dl>

      {q.answer && (
        <div className={`${textClass('label1')} qd-answer`}>
          <span className={textClass('label2', 'bold')} style={{ color: token('qcard-verdict-pass-fg') }}>
            답변
          </span>{' '}
          {q.answer}
        </div>
      )}

      {q.comments.length > 0 && (
        <div className="qd-thread">
          {q.comments.map((cm, i) => (
            <div key={i} className="qd-stack" style={{ gap: token('space-2') }}>
              <span className={textClass('label2')}>
                <span className={textClass('label2', 'bold')}>{cm.by}</span>{' '}
                <span className="qd-faint qd-num">{fmtDateTime(cm.at)}</span>
              </span>
              <span className={textClass('label1')}>{cm.text}</span>
            </div>
          ))}
        </div>
      )}

      {q.status === 'open' && (
        <div className="qd-stack" style={{ gap: token('space-8') }}>
          <TextArea
            width="100%"
            aria-label={`${q.id} 답변`}
            placeholder="답변을 입력하면 연결된 케이스의 보류가 풀립니다"
            minRows={2}
            maxRows={8}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="qd-row" style={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ questionId: q.id, resolution: { kind: 'proceed' } })}
            >
              현 스펙대로 진행
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              leadingContent={<Icons.IconCheck />}
              disabled={!answer.trim()}
              loading={resolve.isPending}
              onClick={() =>
                resolve.mutate(
                  { questionId: q.id, resolution: { kind: 'answer', text: answer.trim() } },
                  { onSuccess: () => setAnswer('') },
                )
              }
            >
              답변 등록
            </Button>
          </div>
        </div>
      )}

      <form
        className="qd-edit-line"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          comment.mutate({ questionId: q.id, text: note.trim() }, { onSuccess: () => setNote('') });
        }}
      >
        <div className="qd-grow">
          <TextArea
            width="100%"
            aria-label={`${q.id} 코멘트`}
            placeholder="코멘트 남기기"
            minRows={1}
            maxRows={6}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button
          size="small"
          variant="outlined"
          color="assistive"
          type="submit"
          disabled={!note.trim()}
          loading={comment.isPending}
        >
          코멘트
        </Button>
      </form>
    </article>
  );
}
