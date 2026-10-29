import { textClass } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PlainShell } from '../../shell/PlainShell';
import '../legal/legal.css';
import './guide.css';

export type GuideSection = { id: string; heading: string; body: ReactNode };

/** 시작 가이드 공통 골격 (목차 + 번호 붙은 절). 로그인하지 않아도 볼 수 있다 */
export function GuideLayout({
  title,
  intro,
  sections,
  links,
}: {
  title: string;
  intro: ReactNode;
  sections: GuideSection[];
  links: { to: string; label: string }[];
}) {
  return (
    <PlainShell showUser={false}>
      <article className="ql-doc qg-doc">
        <header className="ql-head">
          <h1 className={textClass('title3', 'bold')}>{title}</h1>
          <p className={`${textClass('label1')} ql-muted`}>{intro}</p>
        </header>
        <nav className="ql-toc" aria-label="목차">
          <ol className={textClass('label2')}>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="ql-section" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} className={textClass('headline2', 'bold')}>
              {i + 1}. {s.heading}
            </h2>
            <div className={`${textClass('label1')} ql-body`}>{s.body}</div>
          </section>
        ))}
        <footer className={`${textClass('label2')} ql-foot`}>
          {links.map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label}
            </Link>
          ))}
        </footer>
      </article>
    </PlainShell>
  );
}

/**
 * 화면 스크린샷. `pnpm --filter @qcard/web guide:shots`가 찍은 `public/guide/<name>-<light|dark>.jpg`를
 * 지금 테마에 맞는 쪽만 보인다 (숨긴 쪽은 lazy라 내려받지 않는다)
 */
export function Shot({ name, alt, caption }: { name: string; alt: string; caption?: ReactNode }) {
  return (
    <figure className="qg-shot">
      <img className="qg-shot-light" src={`/guide/${name}-light.jpg`} alt={alt} loading="lazy" />
      <img className="qg-shot-dark" src={`/guide/${name}-dark.jpg`} alt={alt} loading="lazy" />
      {caption && <figcaption className={`${textClass('caption1')} ql-faint`}>{caption}</figcaption>}
    </figure>
  );
}

/** 화면의 버튼·메뉴 이름 */
export const Ui = ({ children }: { children: ReactNode }) => <span className="qg-ui">{children}</span>;

/** 따라 하는 순서 */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="qg-steps">{children}</ol>;
}

/** 알아 둘 점 */
export function Note({ children }: { children: ReactNode }) {
  return <div className={`qg-note ${textClass('label2')}`}>{children}</div>;
}

/** 터미널 명령 */
export function Code({ children }: { children: string }) {
  return (
    <pre className="qg-pre">
      <code>{children}</code>
    </pre>
  );
}
