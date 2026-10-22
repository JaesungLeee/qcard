import { Icons, textClass, token } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeSwitch } from './AppShell';
import { CurrentUser } from './DevUserSwitch';
import './shell.css';

/** 프로젝트 밖 화면(내 프로젝트·새 프로젝트·초대 수락)의 골격: 상단 바 + 가운데 본문 */
export function PlainShell({ children }: { children: ReactNode }) {
  return (
    <div className="qc-plain">
      <header className="qc-plain-top">
        <Link to="/projects" className={`qc-plain-brand ${textClass('headline2', 'bold')}`}>
          <Icons.IconFolder aria-hidden style={{ width: 20, height: 20, color: token('foreground-brand-primary') }} />
          qcard
        </Link>
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
