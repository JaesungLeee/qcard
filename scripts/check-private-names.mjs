#!/usr/bin/env node
// 실제 팀(첫 사용 팀)의 앱 이름·패키지가 저장소에 들어오지 않게 한다. fixture·녹화는 가상 앱 하루콩 기준이다
// (.claude/rules/code.md). 실기기 개발용 앱 패키지는 qcard.local.json(gitignore)에 둔다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 이 파일에 이름이 그대로 남지 않게 조각으로 만든다
const NAMES = new RegExp(['\\bm' + 'ino\\b', 'gg' + 'uk', 'kk' + 'uk', '\\uAFB9'].join('|'), 'i');
const root = join(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/\.(png|jpe?g|webp|apk|woff2?|ico)$/.test(f));

const hits = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(join(root, f), 'utf8');
  } catch {
    continue; // 지운 파일
  }
  text.split('\n').forEach((line, i) => {
    if (NAMES.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (hits.length) {
  console.error(`실제 팀의 이름이 저장소에 있습니다 (가상 앱 하루콩으로 바꾸세요):\n${hits.join('\n')}`);
  process.exit(1);
}
