import { expect, test } from '@playwright/test';

/**
 * 시작 가이드(`/guide`)에 넣는 화면 스크린샷을 `public/guide/<이름>-<light|dark>.jpg`로 찍는다.
 * `pnpm --filter @qcard/web guide:shots`로만 돈다 (`ui:snap`에서는 건너뛴다). 메모리 구현의 가상 앱 데이터(하루콩 등)를 쓴다.
 * 화면이 바뀌어 가이드 그림이 낡았으면 다시 찍는다. `selector`를 주면 그 요소만, 없으면 첫 화면(1280×800)만 찍는다.
 */
type Shot = { name: string; path: string; waitFor: string; selector?: string };
export const GUIDE_SHOTS: Shot[] = [
  { name: 'projects', path: '/projects', waitFor: '하루콩 위젯' },
  { name: 'members', path: '/p/haru/settings', waitFor: '@hyejin-han' },
  {
    name: 'run-limits',
    path: '/p/haru/settings',
    waitFor: '실행 안전장치',
    selector: 'section[aria-label="실행 안전장치"]',
  },
  {
    name: 'connect',
    path: '/connect?port=51234&nonce=abcdefghijklmnopqrstuvwx&name=MacBook%20Pro',
    waitFor: '이 PC의 터미널에서 직접',
    selector: '.qp-card',
  },
  { name: 'qa-doc-new', path: '/p/haru/docs/new', waitFor: '1. 스펙 폴더' },
  { name: 'qa-doc-job', path: '/p/haru/docs/jobs/job-140', waitFor: '진행 기록' },
  { name: 'qa-doc-cases', path: '/p/haru/docs/doc-130', waitFor: 'TC-ONBOARDING-001' },
  { name: 'qa-doc-questions', path: '/p/haru/docs/doc-130?tab=questions', waitFor: 'Q-1' },
  { name: 'accounts', path: '/p/moabook/accounts', waitFor: 'qa.sub02@moabook.test' },
  { name: 'prep-flows', path: '/p/haru/prep-flows', waitFor: '온보딩 완료' },
  { name: 'new-cycle', path: '/p/haru/cycles/new', waitFor: '1. QA 문서' },
  { name: 'cycles', path: '/p/haru/cycles', waitFor: '1.3.0 (130) 1차 회귀' },
  { name: 'console-home', path: '/console/live?demo=home', waitFor: '일시정지된 Run이 있습니다' },
  { name: 'case-pick', path: '/p/haru/cycles/cycle-130-1?tab=summary&pick=modal', waitFor: '모두 고르기' },
  { name: 'console-running', path: '/console/live?demo=running', waitFor: 'Agent 사고 로그' },
  { name: 'console-approval', path: '/console/live?demo=approval', waitFor: '위험 액션 — 승인이 필요합니다' },
  { name: 'sheet-summary', path: '/p/haru/cycles/cycle-130-1?tab=summary', waitFor: '진행 매트릭스' },
  { name: 'sheet-cases', path: '/p/haru/cycles/cycle-130-1?tab=cases', waitFor: 'TC-ONBOARDING-001' },
  {
    name: 'trace-fail',
    path: '/p/haru/cycles/cycle-130-1/results/TC-ONBOARDING-032/galaxy-s24-15',
    waitFor: '테스트 동작 흐름',
  },
  {
    name: 'trace-manual',
    path: '/p/haru/cycles/cycle-130-1/results/TC-ONBOARDING-027/pixel-8-16',
    waitFor: '수동 결과 입력',
  },
];

/** 화면 글자 바꾸기 (실명 → 가상 이름) */
const RENAME: [string, string][] = [
  ['이재성', '김하늘'],
  ['jaesung-lee', 'haneul-kim'],
];

test.describe('시작 가이드 스크린샷', () => {
  test.skip(!process.env.GUIDE_SHOTS, 'pnpm guide:shots에서만 찍는다');
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const shot of GUIDE_SHOTS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${shot.name} ${theme}`, async ({ page }) => {
        const sep = shot.path.includes('?') ? '&' : '?';
        await page.goto(`${shot.path}${sep}theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByText(shot.waitFor).first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState('networkidle');
        // 테스트 데이터의 Admin은 운영자 실명이다. 공개 가이드에는 가상 이름으로 바꿔 찍는다 (데이터는 그대로)
        await page.evaluate((pairs) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const [from, to] of pairs)
              if (n.nodeValue?.includes(from)) n.nodeValue = n.nodeValue.replaceAll(from, to);
          }
        }, RENAME);
        const opts = { path: `public/guide/${shot.name}-${theme}.jpg`, type: 'jpeg', quality: 80 } as const;
        if (shot.selector) await page.locator(shot.selector).screenshot({ ...opts, animations: 'disabled' });
        else await page.screenshot({ ...opts, animations: 'disabled' });
      });
    }
  }
});
