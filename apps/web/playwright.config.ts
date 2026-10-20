import { defineConfig } from '@playwright/test';

/**
 * `pnpm ui:snap`: 화면을 데스크톱·좁은 폭 × 라이트·다크로 찍어 `.snap/`에 저장한다.
 * - `SNAP_ONLY=qa-sheet` — `e2e/screens/qa-sheet.json`의 화면만 찍는다 (쉼표로 여러 개)
 * - `SNAP_PORT=5181` — 개발 서버 포트. 여러 작업을 동시에 돌릴 때 서로 다른 포트를 쓴다.
 * - 로컬 실행 사이클은 `e2e/runs-sample`(고정 샘플)을 쓴다. 실제 실행(`packages/agent/runs`)은 `pnpm dev`에서 본다.
 */
const port = Number(process.env.SNAP_PORT ?? 5180);

export default defineConfig({
  testDir: 'e2e',
  outputDir: `test-results/${port}`,
  reporter: [['list']],
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // "로컬 실행" 사이클은 고정 샘플로 찍는다 (packages/agent의 sample-runs로 생성)
    env: { QCARD_RUNS_DIR: 'e2e/runs-sample' },
  },
});
