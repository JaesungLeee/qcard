// 배포 폴더 dist/의 package.json. Cloud Build는 npm으로 설치하므로 workspace:* 없이 번들 밖 의존성만 둔다.
// 에뮬레이터는 dist/node_modules에서 SDK를 찾으므로 링크해 둔다(업로드에서는 firebase.json의 ignore로 빠진다).
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deploy = {
  name: 'qcard-functions',
  private: true,
  type: 'module',
  main: 'index.js',
  engines: pkg.engines,
  dependencies: pkg.dependencies,
};
writeFileSync(join(root, 'dist/package.json'), JSON.stringify(deploy, null, 2) + '\n');
if (!existsSync(join(root, 'dist/node_modules'))) symlinkSync('../node_modules', join(root, 'dist/node_modules'), 'dir');
