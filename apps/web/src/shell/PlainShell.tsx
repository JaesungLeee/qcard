import { Icons, textClass, token } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeSwitch } from './AppShell';
import { CurrentUser } from './DevUserSwitch';
import './shell.css';

/**
 * 프로젝트 밖 화면(내 프로젝트·새 프로젝트·초대 수락·로그인)의 골격: 상단 바 + 가운데 본문.
 * 로그인 화면은 라우터 바깥에서 그리므로 `outsideRouter`로 라우터 링크를 쓰지 않는다.
 */
export function PlainShell({ children, outsideRouter = false }: { children: ReactNode; outsideRouter?: boolean }) {
  const brand = (
    <>
      <Icons.IconFolder aria-hidden style={{ width: 20, height: 20, color: token('foreground-brand-primary') }} />
      qcard
    </>
  );
  const brandClass = `qc-plain-brand ${textClass('headline2', 'bold')}`;
  return (
    <div className="qc-plain">
      <header className="qc-plain-top">
        {outsideRouter ? (
          <span className={brandClass}>{brand}</span>
        ) : (
          <Link to="/projects" className={brandClass}>
            {brand}
          </Link>
        )}
        <div className="qc-plain-right">
          <div className="qc-plain-user">
            <CurrentUser />
          </div>
          <div className="qc-plain-theme">
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <main className="qc-plain-main">{children}</main>
    </div>
  );
}
