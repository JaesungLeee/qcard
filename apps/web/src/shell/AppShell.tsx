import { Icons, SegmentedControl, SegmentedControlItem, textClass, token, useThemeControl } from '@qcard/ui';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
import { useApi, useProject } from '../data/hooks';
import './shell.css';

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: 'cycles', label: '테스트 사이클', icon: <Icons.IconListOrdered /> },
  { to: 'docs', label: 'QA 문서', icon: <Icons.IconDocumentText /> },
  { to: 'prep-flows', label: '준비 플로우', icon: <Icons.IconFlag /> },
];

/** 웹 대시보드 골격: 왼쪽 내비게이션 + 본문. 좁은 화면에서는 내비게이션이 위로 올라간다. */
export function AppShell() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const api = useApi();
  return (
    <div className="qc-shell">
      <aside className="qc-sidebar" aria-label="내비게이션">
        <div className="qc-sidebar-project">
          <div className={textClass('headline2', 'bold')}>{project.data?.name ?? ' '}</div>
          <div className={textClass('caption1')} style={{ color: token('foreground-neutral-tertiary') }}>
            {project.data ? `${project.data.appName} · ${project.data.packageName}` : ' '}
          </div>
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
          <div className={textClass('label2')} style={{ color: token('foreground-neutral-secondary') }}>
            {api.currentUser}
          </div>
        </div>
      </aside>
      <main className="qc-main">
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
