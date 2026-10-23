import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localRuns } from './vite/local-runs';

export default defineConfig({
  plugins: [react(), localRuns()],
  server: {
    port: 5173,
    strictPort: true,
    // 로컬 콘솔(/console/live): 호스트 에이전트의 콘솔 서버로 넘긴다 (run-cycle이 띄운다)
    proxy: {
      '/console-api': { target: `http://127.0.0.1:${process.env.QCARD_CONSOLE_PORT ?? 4801}`, ws: true },
    },
  },
  preview: { port: 4173, strictPort: true },
});
