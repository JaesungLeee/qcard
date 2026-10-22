/**
 * Firebase 에뮬레이터를 띄워 명령을 실행한다. firebase-tools 15는 Java 21 이상이 필요하므로
 * Java 21을 찾아 PATH 앞에 둔다 (시스템 기본 Java는 바꾸지 않는다).
 *
 *   node scripts/emulators.mjs test 'vitest run'      Firestore·Storage 에뮬레이터를 띄워 명령 실행 후 종료 (테스트)
 *   node scripts/emulators.mjs dev 'tsx …'            Auth·Firestore·Functions를 띄워 명령 실행 (개발: 시드 후 대기)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  ...rest,
];
const child = spawn('firebase', args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: home,
    PATH: `${join(home, 'bin')}:${process.env.PATH}`,
    // 로컬에서는 GCP 메타데이터 서버가 없다 (Admin SDK가 찾느라 기다리고 경고를 내지 않게)
    METADATA_SERVER_DETECTION: 'none',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
