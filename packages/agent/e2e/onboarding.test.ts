import { describe, expect, it } from 'vitest';
import { E2E_CASES, runE2E } from './onboarding';

/** 녹화된 실제 모델 응답으로 케이스를 재생한다 (API 호출 없음) */
describe('온보딩 e2e (녹화 재생)', () => {
  for (const c of E2E_CASES) {
    it(`${c.tcId}${'buggy' in c ? ' · 버그 앱' : ''} → ${c.expect}`, async () => {
      const { result } = await runE2E(c, 'replay');
      expect(result.blockedReason).toBeUndefined();
      expect(result.verdict).toBe(c.expect);
    });
  }
});
