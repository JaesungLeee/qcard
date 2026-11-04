import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeviceDriver } from '@qcard/device';
import type { Build } from '@qcard/shared';
import { getBytes, ref, type FirebaseStorage } from 'firebase/storage';

/*
 * 사이클 빌드 설치: 사이클에 지정된 APK를 내려받아 캐시하고, 디바이스의 앱이 다른 버전이면 그대로 설치한다.
 * - 내려받은 파일은 빌드 문서의 SHA-256과 같아야 한다 (모든 실행자가 같은 파일을 설치)
 * - `install -r`: 앱 데이터는 유지한다. 낮은 버전으로 내리거나 서명이 다른 앱을 덮으려면 기존 앱을 지워야 해서
 *   (앱 데이터가 사라진다) 자동으로 하지 않고 이유를 알려 멈춘다
 */

export class BuildInstallError extends Error {
  override name = 'BuildInstallError';
}

export type EnsureBuildResult =
  | { status: 'installed'; from?: number }
  | { status: 'same' }
  /** 저장 파일이 없는 빌드(시드 데이터): 설치된 앱으로 진행 */
  | { status: 'no_file' };

export async function ensureBuild(opts: {
  storage: FirebaseStorage;
  build: Build;
  device: DeviceDriver;
  /** 실행할 앱 패키지 (--package). 빌드의 패키지와 같아야 한다 */
  appPackage: string;
  cacheDir: string;
  log?: (line: string) => void;
}): Promise<EnsureBuildResult> {
  const { build, device } = opts;
  const log = opts.log ?? (() => {});
  // 저장 파일이 없는 빌드(시드)는 설치하지 않으므로 패키지도 맞춰 보지 않는다
  if (!build.storagePath || !build.fileSha256) return { status: 'no_file' };
  if (build.packageName !== opts.appPackage) {
    throw new BuildInstallError(
      `사이클 빌드의 패키지(${build.packageName})가 실행할 앱(${opts.appPackage})과 다릅니다. --package를 확인하세요`,
    );
  }

  const installed = await device.installedApp(build.packageName);
  if (installed?.versionCode === build.buildNumber) {
    log(`앱 ${build.packageName} ${installed.versionName ?? installed.versionCode}: 사이클 빌드와 같은 버전`);
    return { status: 'same' };
  }
  if (installed && installed.versionCode > build.buildNumber) {
    throw new BuildInstallError(
      `디바이스의 앱(${installed.versionName ?? ''} · ${installed.versionCode})이 사이클 빌드(${build.version} · ${build.buildNumber})보다 높습니다. ` +
        '낮은 버전 설치는 앱을 지워야 해서(데이터 삭제) 자동으로 하지 않습니다. 디바이스에서 앱을 직접 지운 뒤 다시 실행하세요',
    );
  }

  const file = await cachedApk(opts.storage, build, opts.cacheDir, log);
  log(`앱 설치: ${build.version} (${build.buildNumber})${installed ? ` ← ${installed.versionCode}` : ' (새로 설치)'}`);
  try {
    await device.installApk(file);
  } catch (e) {
    const msg = (e as Error).message;
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(msg)) {
      throw new BuildInstallError(
        '디바이스의 앱이 다른 키로 서명되어 있어 덮어쓸 수 없습니다. 앱을 지우면 데이터가 사라지므로 직접 지운 뒤 다시 실행하세요',
      );
    }
    throw e;
  }
  return { status: 'installed', ...(installed ? { from: installed.versionCode } : {}) };
}

/** `<cacheDir>/<sha256>.apk`. 없으면 Storage에서 받아 해시를 확인한 뒤 저장한다 */
async function cachedApk(storage: FirebaseStorage, build: Build, cacheDir: string, log: (l: string) => void) {
  const file = join(cacheDir, `${build.fileSha256}.apk`);
  const cached = await readFile(file).catch(() => undefined);
  if (cached && (await sha256(cached)) === build.fileSha256) return file;
  log(`빌드 내려받는 중: ${build.fileName ?? build.storagePath} (${((build.size ?? 0) / 1e6).toFixed(1)}MB)`);
  const bytes = new Uint8Array(await getBytes(ref(storage, build.storagePath!), 400 * 1024 * 1024));
  const got = await sha256(bytes);
  if (got !== build.fileSha256) {
    throw new BuildInstallError(
      `내려받은 빌드의 해시가 다릅니다 (${got.slice(0, 12)}… ≠ ${build.fileSha256!.slice(0, 12)}…)`,
    );
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${file}.part`, bytes);
  await rename(`${file}.part`, file);
  return file;
}

async function sha256(bytes: Uint8Array) {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
