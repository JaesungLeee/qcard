import { SectionMessage, textClass } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PlainShell } from '../../shell/PlainShell';
import { CONTACT_EMAIL, EFFECTIVE_DATE, isDraft, OPERATOR } from './policy';
import './legal.css';

export type LegalSection = { heading: string; body: ReactNode };

/** 개인정보처리방침·이용약관 공통 골격. 로그인하지 않아도 볼 수 있다 */
export function LegalPage({
  title,
  intro,
  sections,
  other,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  other: { to: string; label: string };
}) {
  return (
    <PlainShell showUser={false}>
      <article className="ql-doc">
        <header className="ql-head">
          <h1 className={textClass('title3', 'bold')}>{title}</h1>
          <span className={`${textClass('label2')} ql-faint`}>
            시행일 {EFFECTIVE_DATE ?? '미정'} · {OPERATOR}
          </span>
        </header>
        {isDraft() && (
          <SectionMessage
            variant="info"
            description="시행일은 서비스를 정식 공개할 때 정합니다. 그 전까지 내용이 바뀔 수 있습니다."
          >
            초안입니다
          </SectionMessage>
        )}
        <p className={`${textClass('label1')} ql-muted`}>{intro}</p>
        <nav className="ql-toc" aria-label="목차">
          <ol className={textClass('label2')}>
            {sections.map((s, i) => (
              <li key={s.heading}>
                <a href={`#s${i + 1}`}>{s.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.heading} id={`s${i + 1}`} className="ql-section" aria-labelledby={`s${i + 1}-h`}>
            <h2 id={`s${i + 1}-h`} className={textClass('headline2', 'bold')}>
              {i + 1}. {s.heading}
            </h2>
            <div className={`${textClass('label1')} ql-body`}>{s.body}</div>
          </section>
        ))}
        <footer className={`${textClass('label2')} ql-foot`}>
          <Link to={other.to}>{other.label}</Link>
          <Link to="/login">로그인</Link>
        </footer>
      </article>
    </PlainShell>
  );
}

/** 문의처 문장. 아직 정하지 않았으면 그렇게 쓴다 */
export function Contact() {
  return CONTACT_EMAIL ? (
    <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  ) : (
    <span>정식 공개 때 이 자리에 안내합니다</span>
  );
}
