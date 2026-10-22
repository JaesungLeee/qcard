import {
  Icons,
  SectionMessage,
  SegmentedControl,
  SegmentedControlItem,
  textClass,
  token,
  useThemeControl,
} from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { fmtDate } from '../components/format';
import { useProject } from '../data/hooks';
import { CurrentUser } from './DevUserSwitch';
import { PlainShell } from './PlainShell';
import './shell.css';

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: 'cycles', label: '테스트 사이클', icon: <Icons.IconListOrdered /> },
  { to: 'docs', label: 'QA 문서', icon: <Icons.IconDocumentText /> },
  { to: 'prep-flows', label: '준비 플로우', icon: <Icons.IconFlag /> },
  { to: 'settings', label: '프로젝트 설정', icon: <Icons.IconSetting /> },
];

/** 웹 대시보드 골격: 왼쪽 내비게이션 + 본문. 좁은 화면에서는 내비게이션이 위로 올라간다. */
export function AppShell() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const p = project.data;
  // 멤버가 아니거나 없는 프로젝트: 사이드바(프로젝트 메뉴) 없이 안내만
  if (project.isError) {
    return (
      <PlainShell>
        <SectionMessage variant="negative" description={project.error.message}>
          이 프로젝트를 볼 수 없습니다
        </SectionMessage>
        <Link to="/projects" className={textClass('label1', 'medium')}>
          내 프로젝트로
        </Link>
      </PlainShell>
    );
  }
  return (
    <div className="qc-shell">
      <aside className="qc-sidebar" aria-label="내비게이션">
        <div className="qc-sidebar-project">
          <Link to="/projects" aria-label="내 프로젝트 목록으로 (프로젝트 전환)">
            <span style={{ minWidth: 0 }}>
              <span className={textClass('headline2', 'bold')} style={{ display: 'block' }}>
                {p?.name ?? ' '}
              </span>
              <span
                className={textClass('caption1')}
                style={{ display: 'block', color: token('foreground-neutral-tertiary') }}
              >
                {p ? `${p.appName} · ${p.packageName}` : ' '}
              </span>
            </span>
            <Icons.IconChevronRightSmall aria-hidden className="qc-sidebar-switch" />
          </Link>
        </div>
        <nav className="qc-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={textClass('label1', 'medium')}>
              {n.icon}
              {n.label}
            </NavLink>
          ))}
          <NavLink to="/console" className={textClass('label1', 'medium')}>
            <Icons.IconPhone />
            로컬 콘솔
          </NavLink>
        </nav>
        <div className="qc-sidebar-foot">
          <ThemeSwitch />
          <CurrentUser />
        </div>
      </aside>
      <main className="qc-main">
        {p?.deletedAt && (
          <div className="qc-page" style={{ paddingBottom: 0 }}>
            <SectionMessage
              variant="cautionary"
              description={`${fmtDate(p.purgeAt!)}에 모든 데이터가 영구 삭제됩니다. 프로젝트 설정에서 Admin이 복구할 수 있습니다.`}
            >
              삭제 예정인 프로젝트입니다
            </SectionMessage>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme } = useThemeControl();
  return (
    <SegmentedControl size="small" value={theme ?? 'system'} onValueChange={setTheme} name="theme">
      <SegmentedControlItem value="light">라이트</SegmentedControlItem>
      <SegmentedControlItem value="dark">다크</SegmentedControlItem>
      <SegmentedControlItem value="system">시스템</SegmentedControlItem>
    </SegmentedControl>
  );
}
