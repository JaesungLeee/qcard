#!/usr/bin/env node
// 앱·UI 소스에 색 값을 직접 쓰지 못하게 한다. 색은 `token('...')` / `var(--qc-*)`로만 쓴다 (packages/ui/docs/DESIGN.md).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', '.snap', 'test-results', 'tokens', 'docs', 'e2e']);
const EXT = /\.(tsx?|css)$/;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/;

const root = join(import.meta.dirname, '..');
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path);
    } else if (EXT.test(name) && !name.endsWith('.test.ts')) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (COLOR.test(line) && !line.includes('allow-raw-color'))
            hits.push(`${relative(root, path)}:${i + 1}: ${line.trim()}`);
        });
    }
  }
}

for (const r of ROOTS) walk(join(root, r));

if (hits.length) {
  console.error(
    `색 값을 직접 썼습니다. token('<이름>')을 쓰세요 (불가피하면 같은 줄에 // allow-raw-color):\n${hits.join('\n')}`,
  );
  process.exit(1);
}
