// 배포 패키지 @qcard/host를 pkg/에 만든다: `qcard` 명령 번들(dist/) + 로컬 콘솔용 웹 빌드(dist/web/) + package.json.
// 내부 패키지(workspace:*)까지 모두 번들에 넣어 의존성 없이 설치된다. 올리기: npm publish apps/host-agent/pkg --access public
import { build } from 'esbuild';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = join(root, 'pkg');
const web = join(root, '../web/dist');
const src = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 로컬 콘솔 화면은 운영 웹 빌드여야 한다 (apps/web/.env.production이 없으면 메모리 구현으로 빌드된다)
const assets = existsSync(join(web, 'assets')) ? readdirSync(join(web, 'assets')) : [];
if (!assets.some((f) => f.endsWith('.js') && readFileSync(join(web, 'assets', f), 'utf8').includes('qcard-d2ade'))) {
  throw new Error(
    'apps/web/dist가 운영 빌드가 아닙니다. apps/web/.env.production을 두고 웹을 다시 빌드하세요 (docs/dev/deploy.md)',
  );
}

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: { qcard: join(root, 'src/main.ts') },
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: join(out, 'dist'),
  // 번들에 들어간 CommonJS 의존성(ws 등)이 require를 쓴다
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'warning',
});
cpSync(web, join(out, 'dist/web'), { recursive: true });

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: src.name,
      version: src.version,
      description: 'qcard 호스트 에이전트 — 스펙 기반 QA를 내 PC의 Android 기기와 Claude Code로 실행합니다',
      homepage: 'https://qcard-d2ade.web.app',
      keywords: ['qa', 'android', 'adb', 'claude-code', 'test-automation'],
      type: 'module',
      bin: { qcard: 'dist/qcard.js' },
      files: ['dist'],
      engines: { node: '>=22' },
      os: ['darwin'],
    },
    null,
    2,
  ) + '\n',
);
// npm 페이지에 보이는 사용자 안내
cpSync(join(root, 'README.npm.md'), join(out, 'README.md'));
console.log(`pkg/ ← ${src.name}@${src.version}`);
