/**
 * Firebase 에뮬레이터를 띄워 명령을 실행한다. firebase-tools 15는 Java 21 이상이 필요하므로
 * Java 21을 찾아 PATH 앞에 둔다 (시스템 기본 Java는 바꾸지 않는다).
 *
 *   node scripts/emulators.mjs test 'vitest run'      Firestore·Storage 에뮬레이터를 띄워 명령 실행 후 종료 (테스트)
 *   node scripts/emulators.mjs dev 'tsx …'            Auth·Firestore·Functions를 띄워 명령 실행 (개발: 시드 후 대기)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
// 테스트는 프로젝트도 따로 쓴다 — CLI가 프로젝트 id별로 에뮬레이터 허브를 공유해서, 같은 id면
// 테스트 에뮬레이터가 뜨고 내려갈 때 개발용 에뮬레이터(pnpm emu)가 함께 죽는다
const args = [
  'emulators:exec',
  '--project',
  mode === 'dev' ? 'demo-qcard' : 'demo-qcard-test',
  // 테스트는 다른 포트(firebase.test.json)를 써서 개발용 에뮬레이터(pnpm emu)가 떠 있어도 돈다
  ...(mode === 'dev'
    ? ['--only', 'auth,firestore,functions,storage']
    : ['--only', 'firestore,storage', '--config', join(import.meta.dirname, '../../../firebase.test.json')]),
  // QCARD_EMU_DEBUG=1: CLI 디버그 로그 (에뮬레이터가 죽는 원인 확인용)
  ...(process.env.QCARD_EMU_DEBUG ? ['--debug'] : []),
  ...rest,
];
// Storage 에뮬레이터는 업로드를 임시 폴더(<TMPDIR>/firebase/storage)에 쓰고, 끝날 때 그 폴더를 지운다.
// 같은 폴더를 쓰면 테스트 에뮬레이터(pnpm verify)가 끝날 때 개발용 에뮬레이터의 폴더까지 지워져
// 다음 업로드에서 개발용이 통째로 죽는다(ENOENT) — 에뮬레이터마다 임시 폴더를 따로 준다
const tmp =
  mode === 'dev'
    ? join(tmpdir(), 'qcard-emu-dev')
    : mkdtempSync(join(tmpdir(), 'qcard-emu-test-'));
mkdirSync(tmp, { recursive: true });

const child = spawn('firebase', args, {
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
