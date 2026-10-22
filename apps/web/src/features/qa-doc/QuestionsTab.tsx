import type { QADocument, SpecQuestion } from '@qcard/shared';
import { Button, Icons, SectionMessage, TextArea, textClass, token } from '@qcard/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { fmtDateTime } from '../../components/format';
import { useCommentQuestion, useResolveQuestion } from '../../data/hooks';
import { Tag, type Tone } from './Badges';
import { shortReq } from './logic';
import { RichText } from './RichText';
import { useDocHref, useDocParams } from './params';

const STATUS: Record<SpecQuestion['status'], { label: string; tone: Tone }> = {
  open: { label: '미답변', tone: 'check' },
  answered: { label: '답변됨', tone: 'pass' },
  proceed: { label: '현 스펙대로 진행', tone: 'neutral' },
};

/** 스펙 확인 질문 (F-QD-03) */
export function QuestionsTab({ doc }: { doc: QADocument }) {
  const { question } = useDocParams();
  const open = doc.questions.filter((q) => q.status === 'open');
  const ordered = [...open, ...doc.questions.filter((q) => q.status !== 'open')];
  return (
    <div className="qd-stack">
      {open.length > 0 ? (
        <SectionMessage
          variant="cautionary"
          description={`미답변 질문 ${open.length}건에 연결된 케이스는 승인 보류 상태입니다. 나머지 케이스는 그대로 검토·승인할 수 있습니다.`}
        >
          답변을 기다리는 질문이 있습니다
        </SectionMessage>
      ) : (
        doc.questions.length > 0 && (
          <SectionMessage variant="positive" description="모든 질문이 처리되어 보류된 케이스가 없습니다.">
            열린 질문 없음
          </SectionMessage>
        )
      )}
      {doc.questions.length === 0 && <div className="qc-card qd-muted">이 QA 문서에는 스펙 확인 질문이 없습니다.</div>}
      {ordered.map((q) => (
        <QuestionCard key={q.id} doc={doc} q={q} current={q.id === question} />
      ))}
    </div>
  );
}

function QuestionCard({ doc, q, current }: { doc: QADocument; q: SpecQuestion; current: boolean }) {
  const href = useDocHref();
  const resolve = useResolveQuestion(doc);
  const comment = useCommentQuestion(doc);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const ref = useRef<HTMLElement>(null);
  const req = doc.requirements.find((r) => r.id === q.requirementId);
  const status = STATUS[q.status];

  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'start' });
  }, [current]);

  return (
    <article
      ref={ref}
      id={`question-${q.id}`}
      className={`qc-card qd-stack${current ? ' qd-card-current' : ''}`}
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
        <dt>연결 케이스</dt>
        <dd>
          <span className="qd-row" style={{ gap: token('space-12') }}>
            {q.caseIds.map((id) => {
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
