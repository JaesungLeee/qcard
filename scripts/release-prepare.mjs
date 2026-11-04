#!/usr/bin/env node
// release·hotfix 브랜치에서 바뀐 쪽의 버전을 올리고 CHANGELOG.md 초안 항목을 만든다. prepare-release.yml이 쓴다(docs/dev/ci.md).
//
//   node scripts/release-prepare.mjs <버전> <release|hotfix> <서비스 바뀜 0|1> <호스트 바뀜 0|1>
//
// 이미 맞춰져 있으면 아무것도 바꾸지 않는다. 초안 항목에는 DRAFT 표시가 붙고, 표시가 남아 있으면 main PR의 release-check가 실패한다.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DRAFT = '<!-- 초안: 사용자 관점의 "~합니다"체로 다듬고 이 줄을 지우세요 (docs/dev/branching.md#changelog) -->';
const REPO = 'https://github.com/JaesungLeee/qcard';

const [version, kind, serviceArg, hostArg] = process.argv.slice(2);
const service = serviceArg === '1';
const host = hostArg === '1';
const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
const changes = [];

// package.json의 version만 바꾼다(나머지 서식은 그대로)
function bump(path) {
  const text = read(path);
  const now = JSON.parse(text).version;
  if (now === version) return;
  writeFileSync(join(root, path), text.replace(`"version": "${now}"`, `"version": "${version}"`));
  changes.push(`${path} ${now} → ${version}`);
}
if (service) bump('package.json');
if (host) bump('apps/host-agent/package.json');

const latestTag = (prefix) => run('git', ['tag', '-l', `${prefix}*`, '--sort=-v:refname']).split('\n')[0] || '';
const hostNote = () =>
  `> 호스트 ${version}. PC에서 \`npm i -g @qcard/host\`로 ${version}으로 업데이트한 뒤 \`qcard serve\`를 다시 켜 주세요.\n` +
  `> (이전 호스트로 실행할 수 없게 바꿨다면 \`MIN_HOST_VERSION\`을 올리고 맨 앞에 "⚠ **호스트 업데이트가 필요합니다.**"를 쓰세요)`;

// 직전 릴리스 이후 develop에 머지된 PR(release) 또는 이 브랜치의 커밋(hotfix)을 종류별로 나눈다
function entries() {
  const sections = { Added: [], Changed: [], Fixed: [] };
  const add = (title, link) => {
    const m = title.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)$/);
    const type = m?.[1] ?? '';
    if (/^(docs|chore|test|ci|build|style)$/.test(type)) return;
    const section = type === 'feat' ? 'Added' : type === 'fix' ? 'Fixed' : 'Changed';
    sections[section].push(`- ${m?.[3] ?? title}${link}`);
  };
  if (kind === 'release') {
    // 직전 릴리스 태그 커밋 시각 (태그는 +09:00, PR은 UTC라 시각으로 비교한다)
    const since = Math.max(
      0,
      ...[latestTag('v'), latestTag('host-v')]
        .filter(Boolean)
        .map((t) => Date.parse(run('git', ['log', '-1', '--format=%cI', t]))),
    );
    const prs = JSON.parse(
      run('gh', [
        'pr',
        'list',
        '--base',
        'develop',
        '--state',
        'merged',
        '--limit',
        '200',
        '--json',
        'number,title,url,mergedAt,headRefName',
      ]),
    );
    prs
      .filter((p) => Date.parse(p.mergedAt) > since && !/^(release|hotfix)\//.test(p.headRefName))
      .sort((a, b) => a.number - b.number)
      .forEach((p) => add(p.title, ` ([#${p.number}](${p.url}))`));
  } else {
    run('git', ['log', '--no-merges', '--reverse', '--format=%s', 'origin/main..HEAD'])
      .split('\n')
      .filter(Boolean)
      .forEach((s) => add(s, ''));
  }
  return Object.entries(sections)
    .filter(([, items]) => items.length)
    .map(([name, items]) => `### ${name}\n\n${items.join('\n')}`)
    .join('\n\n');
}

let changelog = read('CHANGELOG.md');
const header = `## [${version}]`;
// 비교 링크는 서비스가 나가면 v 태그, 호스트만 나가면 host-v 태그 기준
const prefix = service ? 'v' : 'host-v';
const prev = latestTag(prefix);
const title = (date) =>
  prev ? `${header}(${REPO}/compare/${prev}...${prefix}${version}) - ${date}` : `${header} - ${date}`;
if (!changelog.includes(`\n${header}`)) {
  const body = [DRAFT, host && hostNote(), entries() || '### Changed\n\n- (변경 내용)'].filter(Boolean).join('\n\n');
  const at = changelog.indexOf('\n## [');
  const block = `${title(new Date().toISOString().slice(0, 10))}\n\n${body}\n`;
  changelog =
    at < 0 ? `${changelog.trimEnd()}\n\n${block}` : `${changelog.slice(0, at + 1)}${block}\n${changelog.slice(at + 1)}`;
  changes.push(`CHANGELOG.md ${version} 초안`);
} else {
  // 항목을 만든 뒤에 다른 쪽도 바뀌었으면 비교 링크·호스트 안내를 맞춘다
  const start = changelog.indexOf(`\n${header}`) + 1;
  const end = changelog.indexOf('\n## [', start);
  let entry = changelog.slice(start, end < 0 ? undefined : end);
  const lineEnd = entry.indexOf('\n') + 1;
  const date = entry.slice(0, lineEnd).match(/ - (\S+)\s*$/)?.[1] ?? new Date().toISOString().slice(0, 10);
  const next = title(date);
  if (entry.slice(0, lineEnd).trim() !== next) {
    entry = `${next}\n${entry.slice(lineEnd)}`;
    changes.push(`CHANGELOG.md ${version} 비교 링크`);
  }
  if (host && !entry.includes('@qcard/host')) {
    const at = entry.indexOf('\n') + 1;
    entry = `${entry.slice(0, at)}\n${hostNote()}\n${entry.slice(at)}`;
    changes.push(`CHANGELOG.md ${version}에 호스트 안내`);
  }
  changelog = changelog.slice(0, start) + entry + (end < 0 ? '' : changelog.slice(end));
}
writeFileSync(join(root, 'CHANGELOG.md'), changelog);

console.log(changes.length ? changes.join('\n') : '바꿀 것 없음');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changes.length ? 1 : ''}\n`);
