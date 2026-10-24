import { textClass, token } from '@qcard/ui';
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
      <BrandMark />
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

/** 로고: favicon(`public/favicon.svg`)과 같은 모양. 테마와 무관하게 같은 색이다 */
function BrandMark() {
  const white = token('static-white');
  return (
    <svg viewBox="0 0 64 64" width={24} height={24} aria-hidden>
      <rect width="64" height="64" rx="16" fill={token('atomic-blue-50')} />
      <circle cx="32" cy="32" r="17" fill="none" stroke={white} strokeOpacity=".3" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r="17"
        fill="none"
        stroke={white}
        strokeWidth="6"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="72 28"
        transform="rotate(-90 32 32)"
      />
      <path
        d="M24.5 32.5l5 5 10-10.5"
        fill="none"
        stroke={white}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
