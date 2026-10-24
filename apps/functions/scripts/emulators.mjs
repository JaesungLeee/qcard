/**
 * Firebase 에뮬레이터를 띄워 명령을 실행한다. firebase-tools 15는 Java 21 이상이 필요하므로
 * Java 21을 찾아 PATH 앞에 둔다 (시스템 기본 Java는 바꾸지 않는다).
 *
 *   node scripts/emulators.mjs test 'vitest run'      Firestore·Storage 에뮬레이터를 띄워 명령 실행 후 종료 (테스트)
 *   node scripts/emulators.mjs dev 'tsx …'            Auth·Firestore·Functions를 띄워 명령 실행 (개발: 시드 후 대기)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** `java -version`은 stderr로 출력한다 */
const major = (home) =>
  Number(
    /version "(\d+)/.exec(spawnSync(join(home, 'bin', 'java'), ['-version'], { encoding: 'utf8' }).stderr)?.[1] ?? 0,
  );

const javaHome = spawnSync('/usr/libexec/java_home', ['-v', '21+'], { encoding: 'utf8' }).stdout?.trim();
const home = [
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  javaHome,
]
  .filter((h) => h && existsSync(join(h, 'bin', 'java')))
  .find((h) => major(h) >= 21);
if (!home) {
  console.error('Firebase 에뮬레이터에는 Java 21 이상이 필요합니다. 예: brew install openjdk@21');
  process.exit(1);
}

const [mode, ...rest] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../../..');

// Storage 에뮬레이터는 업로드를 임시 폴더(<TMPDIR>/firebase/storage)에 쓰고, 끝날 때 그 폴더를 지운다.
// 같은 폴더를 쓰면 테스트 에뮬레이터(pnpm verify)가 끝날 때 개발용 에뮬레이터의 폴더까지 지워져
// 다음 업로드에서 개발용이 통째로 죽는다(ENOENT) — 에뮬레이터마다 임시 폴더를 따로 준다
const tmp = mode === 'dev' ? join(tmpdir(), 'qcard-emu-dev') : mkdtempSync(join(tmpdir(), 'qcard-emu-test-'));
mkdirSync(tmp, { recursive: true });

/** OS가 비어 있는 포트를 하나 고른다 */
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer().once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

/**
 * 테스트용 설정: firebase.test.json에 실행마다 빈 포트를 넣어 임시 폴더에 쓴다. 고정 포트면 워크트리 여러 곳에서
 * 동시에 `pnpm verify`를 돌릴 때 충돌한다. 테스트는 포트를 CLI가 넣어 주는 *_EMULATOR_HOST로 찾는다.
 * 허브 위치 파일도 TMPDIR에 생겨서 실행마다 따로다
 */
async function testConfig() {
  const config = JSON.parse(readFileSync(join(root, 'firebase.test.json'), 'utf8'));
  const e = config.emulators;
  for (const key of ['hub', 'logging', 'firestore', 'storage']) e[key].port = await freePort();
  e.firestore.websocketPort = await freePort();
  // 설정 파일이 임시 폴더에 있으니 규칙 경로는 절대 경로로
  for (const key of ['firestore', 'storage']) config[key].rules = join(root, config[key].rules);
  config.firestore.indexes = join(root, config.firestore.indexes);
  const file = join(tmp, 'firebase.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

// 테스트는 프로젝트도 따로 쓴다 — CLI가 프로젝트 id별로 에뮬레이터 허브를 공유해서, 같은 id면
// 테스트 에뮬레이터가 뜨고 내려갈 때 개발용 에뮬레이터(pnpm emu)가 함께 죽는다
const args = [
  'emulators:exec',
  '--project',
  mode === 'dev' ? 'demo-qcard' : 'demo-qcard-test',
  // 테스트는 실행마다 다른 포트를 써서 개발용 에뮬레이터(pnpm emu)나 다른 워크트리의 테스트가 떠 있어도 돈다
  ...(mode === 'dev'
    ? ['--only', 'auth,firestore,functions,storage']
    : ['--only', 'firestore,storage', '--config', await testConfig()]),
  // QCARD_EMU_DEBUG=1: CLI 디버그 로그 (에뮬레이터가 죽는 원인 확인용)
  ...(process.env.QCARD_EMU_DEBUG ? ['--debug'] : []),
  ...rest,
];

// 전역 설치가 아니라 이 패키지에 고정한 firebase-tools (호스트 에이전트 테스트처럼 다른 패키지에서 불러도 같은 버전)
const child = spawn(join(import.meta.dirname, '../node_modules/.bin/firebase'), args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: home,
    PATH: `${join(home, 'bin')}:${process.env.PATH}`,
    TMPDIR: tmp,
    // 로컬에서는 GCP 메타데이터 서버가 없다 (Admin SDK가 찾느라 기다리고 경고를 내지 않게)
    METADATA_SERVER_DETECTION: 'none',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
