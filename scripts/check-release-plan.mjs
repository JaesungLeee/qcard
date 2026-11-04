#!/usr/bin/env node
// scripts/release-plan.sh에 적은 앱별 패키지 목록이 실제 의존(간접 포함)과 같은지 확인한다.
// 목록이 빠지면 그 패키지만 바뀐 릴리스가 배포되지 않는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const qcardDeps = (pkg) =>
  Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((n) => n.startsWith('@qcard/'))
    .map((n) => n.slice('@qcard/'.length));

const packages = Object.fromEntries(
  readdirSync(join(root, 'packages')).map((d) => [d, qcardDeps(json(`packages/${d}/package.json`))]),
);
const closure = (app) => {
  const seen = new Set();
  const visit = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    (packages[n] ?? []).forEach(visit);
  };
  qcardDeps(json(`apps/${app}/package.json`)).forEach(visit);
  return [...seen].sort();
};

const script = readFileSync(join(root, 'scripts/release-plan.sh'), 'utf8');
const errors = [];
for (const [name, app] of [
  ['web_pkgs', 'web'],
  ['functions_pkgs', 'functions'],
  ['host_pkgs', 'host-agent'],
]) {
  const listed =
    script
      .match(new RegExp(`^${name}='([^']*)'`, 'm'))?.[1]
      .split('|')
      .sort() ?? [];
  const want = closure(app);
  if (listed.join('|') !== want.join('|')) errors.push(`${name}='${want.join('|')}' (지금 '${listed.join('|')}')`);
}

if (errors.length) {
  console.error(
    `scripts/release-plan.sh의 패키지 목록이 apps/*의 의존과 다릅니다. 이렇게 고치세요:\n${errors.join('\n')}`,
  );
  process.exit(1);
}
