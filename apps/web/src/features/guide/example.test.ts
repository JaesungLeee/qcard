import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const specs = join(root, '../../packages/fixtures/spec');

describe('시작 가이드 예시 스펙 ZIP', () => {
  it('하루콩 스펙과 같다 (다르면 pnpm --filter @qcard/web guide:example)', () => {
    const zip = unzipSync(new Uint8Array(readFileSync(join(root, 'public/guide/harukong-specs.zip'))));
    const want = Object.fromEntries(
      readdirSync(specs).map((name) => [
        `docs/specs/${name}/spec.md`,
        readFileSync(join(specs, name, 'spec.md'), 'utf8'),
      ]),
    );
    const got = Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, new TextDecoder().decode(v)]));
    expect(got).toEqual(want);
  });
});
