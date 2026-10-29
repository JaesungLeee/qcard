#!/usr/bin/env node
// 시작 가이드의 예시 스펙 ZIP(public/guide/harukong-specs.zip)을 가상 앱 하루콩 스펙(packages/fixtures/spec)으로 만든다.
// 스펙을 바꾸면 다시 돌린다 (src/features/guide/example.test.ts가 내용이 같은지 확인한다).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const root = join(import.meta.dirname, '..');
const specs = join(root, '../../packages/fixtures/spec');
const files = {};
for (const name of readdirSync(specs)) {
  files[`docs/specs/${name}/spec.md`] = readFileSync(join(specs, name, 'spec.md'));
}
// 날짜를 고정해 같은 스펙이면 같은 파일이 나오게 한다
writeFileSync(
  join(root, 'public/guide/harukong-specs.zip'),
  zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') }),
);
console.log(`public/guide/harukong-specs.zip: ${Object.keys(files).join(', ')}`);
