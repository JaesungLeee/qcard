import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localRuns } from './vite/local-runs';

export default defineConfig({
  plugins: [react(), localRuns()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
