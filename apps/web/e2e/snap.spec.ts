import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 찍을 화면은 `e2e/screens/<기능>.json`에 둔다: `[{ "name": "qa-sheet-cases", "path": "/p/haru/cycles/cycle-130-1?tab=cases" }]`
 * 화면 이름은 전체에서 겹치지 않게 기능 이름으로 시작한다. `waitFor`를 주면 그 텍스트가 보일 때까지 기다린다.
 */
type Screen = { name: string; path: string; waitFor?: string };
const dir = join(import.meta.dirname, 'screens');
const only = process.env.SNAP_ONLY?.split(',');
const SCREENS: Screen[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && (!only || only.includes(f.replace(/\.json$/, ''))))
  .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Screen[]);
const THEMES = ['light', 'dark'] as const;

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    test(`${screen.name} ${theme}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

      const sep = screen.path.includes('?') ? '&' : '?';
      await page.goto(`${screen.path}${sep}theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (screen.waitFor) await expect(page.getByText(screen.waitFor).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');

      // 가로 스크롤이 생기면 레이아웃이 깨진 것이다.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '가로 스크롤 발생').toBeLessThanOrEqual(0);

      await page.screenshot({
        path: `.snap/${screen.name}.${info.project.name}.${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      expect(errors, '콘솔 에러').toEqual([]);
    });
  }
}
