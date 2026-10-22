import { defineConfig } from 'vitest/config';

// 두 테스트 파일이 같은 에뮬레이터 프로젝트(demo-qcard)를 비우고 쓰므로 차례로 돌린다
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20_000, hookTimeout: 20_000 } });
