import { Navigate, createBrowserRouter } from 'react-router';
import { UiCatalog } from './dev/UiCatalog';
import { ConsolePage } from './features/console';
import { LiveConsolePage } from './features/console/live';
import { ConsoleOpenPage } from './features/console/Open';
import { ConnectHostPage, HostsPage } from './features/hosts';
import { InvitePage, NewProjectPage, ProjectListPage, ProjectSettingsPage } from './features/projects';
import { JobProgressPage, NewQaDocPage, PrepFlowPage, QaDocListPage, QaDocReviewPage } from './features/qa-doc';
import { CycleListPage, NewCyclePage, QaSheetPage, TracePage } from './features/qa-sheet';
import { AppShell } from './shell/AppShell';
import { RequireAuth } from './shell/AuthGate';
import { LoginPage } from './shell/LoginPage';

/**
 * 웹 대시보드 라우트. 화면별 쿼리 파라미터:
 * - QA 시트: `?tab=summary|cases|defects|traceability|env`
 * - QA 문서 검토: `?tab=cases|questions|suggestions|traceability&case=<TC ID>`
 * - QA 문서 생성 작업: `?spec=<스펙>&row=<행 ID>&page=<행 페이지>&same=hide&log=<기록 페이지>`
 * - 로그인: `/login?next=<돌아갈 주소>`. 나머지 화면은 모두 RequireAuth 아래에 둔다 (F-TM-01)
 * - 로컬 콘솔 `/console/live`는 예외: 호스트의 콘솔 서버(127.0.0.1)가 웹 빌드를 직접 주고 일회용 주소·쿠키로 확인한다.
 *   웹 로그인을 쓰지 않는다 (127.0.0.1은 Firebase 승인된 도메인이 아니고, 로그인 세션도 따로다)
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/console/live', element: <LiveConsolePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Navigate to="/projects" replace /> },
      { path: '/projects', element: <ProjectListPage /> },
      { path: '/projects/new', element: <NewProjectPage /> },
      { path: '/invite/:token', element: <InvitePage /> },
      { path: '/hosts', element: <HostsPage /> },
      { path: '/connect', element: <ConnectHostPage /> },
      {
        path: '/p/:projectId',
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="cycles" replace /> },
          { path: 'cycles', element: <CycleListPage /> },
          { path: 'cycles/new', element: <NewCyclePage /> },
          { path: 'cycles/:cycleId', element: <QaSheetPage /> },
          { path: 'cycles/:cycleId/results/:tcId/:deviceId', element: <TracePage /> },
          { path: 'docs', element: <QaDocListPage /> },
          { path: 'docs/new', element: <NewQaDocPage /> },
          { path: 'docs/jobs/:jobId', element: <JobProgressPage /> },
          { path: 'docs/:docId', element: <QaDocReviewPage /> },
          { path: 'prep-flows', element: <PrepFlowPage /> },
          { path: 'settings', element: <ProjectSettingsPage /> },
          { path: 'console', element: <ConsoleOpenPage /> },
        ],
      },
      { path: '/console', element: <ConsolePage /> },
      { path: '/__ui', element: <UiCatalog /> },
    ],
  },
]);
