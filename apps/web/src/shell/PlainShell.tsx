import { Icons, textClass, token } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeSwitch } from './AppShell';
import { CurrentUser } from './DevUserSwitch';
import './shell.css';

/**
 * 프로젝트 밖 화면(내 프로젝트·새 프로젝트·초대 수락·로그인)의 골격: 상단 바 + 가운데 본문.
 * 로그인 화면은 아직 사용자가 없으므로 `showUser={false}`로 사용자 영역을 숨긴다.
 */
export function PlainShell({ children, showUser = true }: { children: ReactNode; showUser?: boolean }) {
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
        <Link to="/projects" className={brandClass}>
          {brand}
        </Link>
        <div className="qc-plain-right">
          {showUser && (
            <div className="qc-plain-user">
              <CurrentUser />
            </div>
          )}
          <div className="qc-plain-theme">
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <main className="qc-plain-main">{children}</main>
    </div>
  );
}
