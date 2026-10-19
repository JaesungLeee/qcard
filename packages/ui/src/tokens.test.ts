import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('생성된 토큰 파일이 tokens.json과 일치한다 (다르면 `pnpm tokens`)', () => {
  const root = join(import.meta.dirname, '..');
  const r = spawnSync(join(root, 'node_modules/.bin/tsx'), ['scripts/build-tokens.ts', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
});
