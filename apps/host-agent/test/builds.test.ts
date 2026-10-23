import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { PermissionError, RuleError } from '@qcard/data';
import { createFirebaseApi, writeAll } from '@qcard/data/firebase';
import { seedDocs } from '@qcard/data/seed';
import { FakeDevice } from '@qcard/device';
import { GITHUB, onboardingScenario, PEOPLE } from '@qcard/fixtures';
import { doc, setLogLevel, updateDoc, type Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BuildInstallError, ensureBuild } from '../src';

/*
 * 빌드 업로드 → 사이클 만들기 → 호스트가 사이클 빌드를 설치 (F-DV-05·06, F-CY-01·02).
 * APK는 packages/apk의 테스트 APK(코드 없는 앱, 테스트 키), 디바이스는 FakeDevice.
 */

setLogLevel('silent');
const ROOT = resolve(import.meta.dirname, '../../..');
const apk = (name: string) => new Uint8Array(readFileSync(join(ROOT, 'packages/apk/test/fixtures', name)));
const PKG = 'com.example.qcard.sample';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qcard-test',
    firestore: { rules: readFileSync(join(ROOT, 'firebase/firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(join(ROOT, 'firebase/storage.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled((c) => writeAll(c.firestore() as unknown as Firestore, seedDocs()));
});

function as(name: string) {
  const uid = GITHUB[name]!;
  const ctx = env.authenticatedContext(uid);
  const db = ctx.firestore() as unknown as Firestore;
  const storage = ctx.storage() as unknown as FirebaseStorage;
  const api = createFirebaseApi({
    db,
    storage,
    user: () => ({ uid, name }),
    call: () => Promise.reject(new Error('x')),
  });
  return { db, storage, api };
}

describe('빌드 업로드 (F-DV-05)', () => {
  it('서명된 APK에서 패키지·버전·지문을 읽어 올리고, 같은 파일·서명 없는 파일·Viewer는 거부한다', async () => {
    const { api, db } = as(PEOPLE.lead);
    const build = await api.uploadBuild('haru', { name: 'app-qa release.apk', bytes: apk('signed-v1v2v3.apk') });
    expect(build).toMatchObject({
      packageName: PKG,
      version: '1.4.2',
      buildNumber: 42,
      signingSha1: 'DC:AD:CE:90:0A:61:B9:35:B8:A3:C3:3E:E0:44:16:A4:F3:69:32:A1',
      signingSchemes: ['v1', 'v2', 'v3'],
      uploadedBy: PEOPLE.lead,
      storagePath: `projects/haru/builds/${build.id}/app-qa_release.apk`,
    });
    expect((await api.listBuilds('haru'))[0]?.id).toBe(build.id);

    await expect(
      api.uploadBuild('haru', { name: 'again.apk', bytes: apk('signed-v1v2v3.apk') }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(api.uploadBuild('haru', { name: 'u.apk', bytes: apk('unsigned.apk') })).rejects.toThrow(
      /서명되지 않은/,
    );
    await expect(
      as(PEOPLE.planner).api.uploadBuild('haru', { name: 'v.apk', bytes: apk('signed-v2.apk') }),
    ).rejects.toBeInstanceOf(PermissionError);
    // 올린 빌드는 바꿀 수 없다
    await expect(updateDoc(doc(db, 'projects', 'haru', 'builds', build.id), { version: '9.9.9' })).rejects.toThrow();
  });
});

describe('사이클 만들기 (F-CY-01·02)', () => {
  it('승인된 케이스를 스냅샷으로 고정하고 케이스 × 대상 칸을 N/T로 만든다', async () => {
    const { api } = as(PEOPLE.qa);
    const doc = await api.getQaDoc({ projectId: 'haru', docId: 'doc-130' });
    const approved = doc.cases.filter((c) => c.change !== 'removed' && c.approval.status === 'approved');
    const cycle = await api.createCycle('haru', {
      name: '1.3.0 (130) 2차',
      docId: 'doc-130',
      buildId: 'build-130',
      targets: [
        { model: 'SM-S711N', osMajor: 16, resolution: '1080×2340' },
        { model: 'Pixel 8', osMajor: 16 },
        { model: 'SM-S711N', osMajor: 16 }, // 같은 대상은 한 번만
      ],
      serverEnv: 'stage',
    });
    expect(cycle.targets.map((t) => [t.id, t.label])).toEqual([
      ['sm-s711n-16', 'SM-S711N (Android 16)'],
      ['pixel-8-16', 'Pixel 8 (Android 16)'],
    ]);
    expect(cycle.snapshot).toEqual(approved.map((c) => ({ tcId: c.tcId, contentHash: c.contentHash })));

    const detail = await api.getCycle({ projectId: 'haru', cycleId: cycle.id });
    expect(detail.results).toHaveLength(approved.length * 2);
    expect(new Set(detail.results.map((r) => r.verdict))).toEqual(new Set(['nt']));
    const summary = (await api.listCycles('haru')).find((s) => s.cycle.id === cycle.id);
    expect(summary).toMatchObject({ total: approved.length * 2, done: 0, docVersion: '1.3.0' });

    await expect(
      api.createCycle('haru', { name: 'x', docId: 'doc-130', buildId: 'build-130', targets: [], serverEnv: 'dev' }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      as(PEOPLE.planner).api.createCycle('haru', {
        name: 'x',
        docId: 'doc-130',
        buildId: 'build-130',
        targets: [{ model: 'A', osMajor: 15 }],
        serverEnv: 'dev',
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('호스트: 사이클 빌드 설치 (F-DV-05·06)', () => {
  it('다른 버전이면 내려받아(해시 확인·캐시) 설치하고, 같은 버전이면 그대로, 높은 버전이면 멈춘다', async () => {
    const lead = as(PEOPLE.lead);
    const build = await lead.api.uploadBuild('haru', { name: 'app.apk', bytes: apk('signed-v1v2v3.apk') });
    const cacheDir = mkdtempSync(join(tmpdir(), 'qcard-builds-'));
    const device = new FakeDevice(onboardingScenario());
    const opts = { storage: lead.storage, build, device, appPackage: PKG, cacheDir };

    device.apps[PKG] = { versionCode: 41, versionName: '1.4.1' };
    expect(await ensureBuild(opts)).toEqual({ status: 'installed', from: 41 });
    expect(device.installed).toEqual([join(cacheDir, `${build.fileSha256}.apk`)]);
    expect(readFileSync(device.installed[0]!)).toEqual(Buffer.from(apk('signed-v1v2v3.apk')));

    device.apps[PKG] = { versionCode: 42, versionName: '1.4.2' };
    expect(await ensureBuild(opts)).toEqual({ status: 'same' });

    device.apps[PKG] = { versionCode: 50 };
    await expect(ensureBuild(opts)).rejects.toBeInstanceOf(BuildInstallError);
    await expect(ensureBuild({ ...opts, appPackage: 'com.other' })).rejects.toThrow(/패키지/);
    expect(device.installed).toHaveLength(1);
  });

  it('저장 파일이 없는 빌드(시드)는 설치된 앱으로 진행한다', async () => {
    const lead = as(PEOPLE.lead);
    const { build } = await lead.api.getCycle({ projectId: 'haru', cycleId: 'cycle-130-1' });
    const device = new FakeDevice(onboardingScenario());
    expect(
      await ensureBuild({ storage: lead.storage, build, device, appPackage: build.packageName, cacheDir: tmpdir() }),
    ).toEqual({ status: 'no_file' });
  });
});
