import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * 실기기 개발용 대상 앱 (본인 폰에 설치한 QA 빌드). 저장소에 두지 않는다 — 환경변수 QCARD_DEV_APP 또는
 * 저장소 루트의 qcard.local.json(`{ "devApp": "com.example.app.qa" }`, gitignore)에서 읽는다.
 * guard-bash.sh도 같은 파일을 읽어 `pm clear`를 이 앱에만 허용한다.
 */

export const LOCAL_CONFIG = 'qcard.local.json';

/** 이 폴더에서 위로 올라가며 qcard.local.json을 찾는다 */
function findLocalConfig(from = process.cwd()): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, LOCAL_CONFIG);
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

export function devAppPackage(): string | undefined {
  if (process.env.QCARD_DEV_APP) return process.env.QCARD_DEV_APP;
  const file = findLocalConfig();
  if (!file) return undefined;
  const devApp = (JSON.parse(readFileSync(file, 'utf8')) as { devApp?: unknown }).devApp;
  return typeof devApp === 'string' && devApp ? devApp : undefined;
}

/** 실기기 명령의 대상 앱: --package > 로컬 설정. 둘 다 없으면 설정 방법을 알려 준다 */
export function requireDevApp(flag?: string): string {
  const pkg = flag ?? devAppPackage();
  if (!pkg) {
    throw new Error(
      `실기기 대상 앱이 없습니다. --package로 주거나 저장소 루트 ${LOCAL_CONFIG}에 { "devApp": "<패키지>" }를 두세요 (또는 QCARD_DEV_APP).`,
    );
  }
  return pkg;
}
