// README 대표 이미지(docs/images/hero-{light,dark}.png)를 hero.html에서 찍는다.
// 시작 가이드 스크린샷(apps/web/public/guide/)을 바꾸면 다시 돌린다: node scripts/readme-hero/render.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '../..');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
for (const theme of ['light', 'dark']) {
  await page.goto(`${pathToFileURL(join(import.meta.dirname, 'hero.html'))}?theme=${theme}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, `docs/images/hero-${theme}.png`) });
}
await browser.close();
