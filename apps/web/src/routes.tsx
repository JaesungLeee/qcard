import { Navigate, createBrowserRouter } from 'react-router';
import { UiCatalog } from './dev/UiCatalog';
import { ConsolePage } from './features/console';
import { LiveConsolePage } from './features/console/live';
import { ConsoleOpenPage } from './features/console/Open';
import { InvitePage, NewProjectPage, ProjectListPage, ProjectSettingsPage } from './features/projects';
import { NewQaDocPage, PrepFlowPage, QaDocListPage, QaDocReviewPage } from './features/qa-doc';
import { CycleListPage, NewCyclePage, QaSheetPage, TracePage } from './features/qa-sheet';
import { AppShell } from './shell/AppShell';

/**
 * 웹 대시보드 라우트. 화면별 쿼리 파라미터:
 * - QA 시트: `?tab=summary|cases|defects|traceability|env`
 * - QA 문서 검토: `?tab=cases|questions|suggestions|traceability&case=<TC ID>`
 */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/projects" replace /> },
  { path: '/projects', element: <ProjectListPage /> },
  { path: '/projects/new', element: <NewProjectPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
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
      { path: 'docs/:docId', element: <QaDocReviewPage /> },
      { path: 'prep-flows', element: <PrepFlowPage /> },
      { path: 'settings', element: <ProjectSettingsPage /> },
      { path: 'console', element: <ConsoleOpenPage /> },
    ],
  },
  { path: '/console', element: <ConsolePage /> },
  { path: '/console/live', element: <LiveConsolePage /> },
  { path: '/__ui', element: <UiCatalog /> },
]);
