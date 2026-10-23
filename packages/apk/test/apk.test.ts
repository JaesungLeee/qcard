import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApkError, inspectApk } from '../src';

// scripts/make-fixtures.sh로 만든 테스트 APK (코드 없는 앱, 버리는 테스트 키). 지문은 keytool 출력과 같아야 한다
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)));
const KEY = {
  sha1: 'DC:AD:CE:90:0A:61:B9:35:B8:A3:C3:3E:E0:44:16:A4:F3:69:32:A1',
  sha256: 'ED:48:07:DC:78:F3:C6:5B:9B:C4:C5:5C:19:66:A9:4F:AB:89:A9:44:24:E4:A6:1D:DE:D6:F0:20:7F:44:97:97',
};

describe('inspectApk (F-DV-05)', () => {
  it('매니페스트에서 패키지·버전·빌드 번호·minSdk를 읽고, 서명 지문은 keytool과 같다', async () => {
    const info = await inspectApk(fixture('signed-v1v2v3.apk'));
    expect(info).toMatchObject({
      packageName: 'com.example.qcard.sample',
      versionCode: 42,
      versionName: '1.4.2',
      minSdk: 21,
      signing: { schemes: ['v1', 'v2', 'v3'], ...KEY },
      size: fixture('signed-v1v2v3.apk').length,
    });
    expect(info.fileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('v1만·v2만 서명된 APK도 같은 지문을 낸다', async () => {
    expect((await inspectApk(fixture('signed-v1.apk'))).signing).toEqual({ schemes: ['v1'], ...KEY });
    const v2 = await inspectApk(fixture('signed-v2.apk'));
    expect(v2.signing).toEqual({ schemes: ['v2'], ...KEY });
    expect(v2.minSdk).toBe(24);
  });

  it('서명되지 않은 APK·APK가 아닌 파일은 거부한다', async () => {
    await expect(inspectApk(fixture('unsigned.apk'))).rejects.toMatchObject({ kind: 'unsigned' });
    await expect(inspectApk(new TextEncoder().encode('not a zip'))).rejects.toBeInstanceOf(ApkError);
  });
});
