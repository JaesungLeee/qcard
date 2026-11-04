import { TECHNIQUE_LABEL, type QADocument, type SpecSuggestion } from '@qcard/shared';
import { Button, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { useMemo, useState } from 'react';
import { Tag } from './Badges';
import { shortReq } from './logic';
import { RichText } from './RichText';

/** 스펙 작성자에게 보낼 텍스트 (요구사항별 묶음) */
export function suggestionsText(doc: Pick<QADocument, 'appVersion' | 'suggestions'>): string {
  const lines = [`[QA 문서 ${doc.appVersion}] 스펙 보강 제안 ${doc.suggestions.length}건`, ''];
  for (const s of doc.suggestions) lines.push(`- ${s.requirementId} (${TECHNIQUE_LABEL[s.technique]}): ${s.text}`);
  return lines.join('\n');
}

/** 스펙 보강 제안. 케이스가 아니라 스펙에 TS·EC를 더하자는 제안이다. */
export function SuggestionsTab({ doc }: { doc: QADocument }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, SpecSuggestion[]>();
    for (const s of doc.suggestions) m.set(s.requirementId, [...(m.get(s.requirementId) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [doc.suggestions]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(suggestionsText(doc));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  return (
    <div className="qd-stack">
      <SectionMessage
        variant="info"
        description="테스트 설계 기법으로 요구사항 대비 TS·EC가 빠진 곳을 찾은 결과입니다. 제안은 케이스가 아니며 실행되지 않습니다. 스펙 작성자가 TS·EC를 추가하면 다음 버전 QA 문서부터 케이스가 됩니다."
      >
        보강 제안은 케이스가 아닙니다
      </SectionMessage>

      <div className="qd-toolbar">
        <span className={`${textClass('label1')} qd-muted`}>
          요구사항 <span className="qc-mono">{groups.length}</span>개에 제안{' '}
          <span className="qc-mono">{doc.suggestions.length}</span>건
        </span>
        <span className="qd-row">
          {copied && (
            <span
              className={textClass('label2')}
              role="status"
              style={{ color: token(copied === 'ok' ? 'qcard-verdict-pass-fg' : 'qcard-verdict-fail-fg') }}
            >
              {copied === 'ok' ? '클립보드에 복사했습니다' : '복사하지 못했습니다'}
            </span>
          )}
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconCopy />}
            disabled={doc.suggestions.length === 0}
            onClick={() => void copy()}
          >
            스펙 작성자에게 전달 (텍스트 복사)
          </Button>
        </span>
      </div>

      {doc.suggestions.length === 0 && <div className="qc-card qd-muted">보강 제안이 없습니다.</div>}

      {groups.map(([reqId, items]) => {
        const req = doc.requirements.find((r) => r.id === reqId);
        return (
          <section key={reqId} className="qc-card qd-stack" style={{ gap: token('space-12') }}>
            <div className="qd-stack" style={{ gap: token('space-4') }}>
              <h3 className={`${textClass('headline2', 'bold')} qd-row`} style={{ gap: token('space-8') }}>
                <span className="qc-mono">{shortReq(reqId)}</span>
                <span className={`${textClass('label2')} qd-faint`}>{req?.spec}</span>
              </h3>
              {req && (
                <p className={`${textClass('label1')} qd-muted`} style={{ margin: 0 }}>
                  <RichText text={req.text} />
                </p>
              )}
            </div>
            <ul className="qd-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: token('space-8') }}>
              {items.map((s) => (
                <li
                  key={s.id}
                  className="qd-source"
                  style={{ flexDirection: 'row', gap: token('space-12'), alignItems: 'flex-start' }}
                >
                  <span className="qd-stack" style={{ gap: token('space-4'), flex: 'none', alignItems: 'flex-start' }}>
                    <span className={`${textClass('caption1')} qc-mono qd-faint`}>{s.id}</span>
                    <Tag tone="violet">{TECHNIQUE_LABEL[s.technique]}</Tag>
                  </span>
                  <span className={textClass('body2-reading')}>{s.text}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
