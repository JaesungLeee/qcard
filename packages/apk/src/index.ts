import { unzipSync } from 'fflate';

/*
 * APK 정보 읽기 (F-DV-05): 패키지명·버전·빌드 번호·서명 지문을 파일에서 바로 뽑는다. 브라우저·Node 공용(외부 도구 없음).
 *   - 매니페스트: 바이너리 XML(AXML)의 첫 요소 <manifest>와 <uses-sdk>
 *   - 서명: APK 서명 블록(v2·v3)의 첫 인증서, 없으면 META-INF/*.RSA|DSA|EC(v1, PKCS#7)의 첫 인증서
 *   - 지문: 인증서 DER의 SHA-1·SHA-256 (keytool·apksigner와 같은 값)
 * 서명이 없으면 `ApkError('unsigned')` — qcard는 재서명하지 않고 받은 파일을 그대로 설치한다.
 */

export type SigningScheme = 'v1' | 'v2' | 'v3';

export type ApkInfo = {
  packageName: string;
  versionCode: number;
  versionName?: string;
  minSdk?: number;
  signing: { schemes: SigningScheme[]; sha1: string; sha256: string };
  /** 파일 전체 SHA-256 (모든 실행자가 같은 파일을 설치하는지 확인) */
  fileSha256: string;
  size: number;
};

export class ApkError extends Error {
  override name = 'ApkError';
  constructor(
    readonly kind: 'not_apk' | 'unsigned',
    message: string,
  ) {
    super(message);
  }
}

export async function inspectApk(bytes: Uint8Array): Promise<ApkInfo> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => f.name === 'AndroidManifest.xml' || /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(f.name),
    });
  } catch {
    throw new ApkError('not_apk', 'APK(ZIP) 파일이 아닙니다.');
  }
  const manifest = entries['AndroidManifest.xml'];
  if (!manifest) throw new ApkError('not_apk', 'AndroidManifest.xml이 없습니다. APK 파일인지 확인하세요.');
  const m = readManifest(manifest);

  const certs: { scheme: SigningScheme; der: Uint8Array }[] = [];
  for (const [id, scheme] of [
    [0xf05368c0, 'v3'],
    [0x7109871a, 'v2'],
  ] as const) {
    const der = signingBlockCert(bytes, id);
    if (der) certs.push({ scheme, der });
  }
  const v1 = Object.entries(entries).find(([name]) => name.startsWith('META-INF/'));
  if (v1) certs.push({ scheme: 'v1', der: pkcs7FirstCert(v1[1]) });
  if (!certs.length) {
    throw new ApkError(
      'unsigned',
      '서명되지 않은 APK입니다. 배포와 같은 키로 서명된 APK를 올리세요 (qcard는 재서명하지 않습니다).',
    );
  }
  // 가장 새로운 방식의 인증서를 기준으로 삼는다
  const main = certs[0]!.der;
  return {
    packageName: m.packageName,
    versionCode: m.versionCode,
    ...(m.versionName ? { versionName: m.versionName } : {}),
    ...(m.minSdk !== undefined ? { minSdk: m.minSdk } : {}),
    signing: {
      schemes: certs.map((c) => c.scheme).sort(),
      sha1: fingerprint(await digest('SHA-1', main)),
      sha256: fingerprint(await digest('SHA-256', main)),
    },
    fileSha256: hex(await digest('SHA-256', bytes)),
    size: bytes.length,
  };
}

// ---------------------------------------------------------------- 해시

async function digest(alg: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest(alg, data as BufferSource));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fingerprint = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');

// ---------------------------------------------------------------- 바이너리 XML (AXML)

const ATTR = { versionCode: 0x0101021b, versionName: 0x0101021c, minSdkVersion: 0x0101020c } as const;

function readManifest(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0, true) !== 0x0003) throw new ApkError('not_apk', '매니페스트를 읽을 수 없습니다.');
  let strings: string[] = [];
  let resIds: number[] = [];
  const out: { packageName?: string; versionCode?: number; versionName?: string; minSdk?: number } = {};
  let off = v.getUint16(2, true);
  while (off + 8 <= buf.length) {
    const type = v.getUint16(off, true);
    const headerSize = v.getUint16(off + 2, true);
    const size = v.getUint32(off + 4, true);
    if (size < 8) break;
    if (type === 0x0001) strings = stringPool(buf, v, off);
    else if (type === 0x0180) {
      resIds = [];
      for (let p = off + headerSize; p < off + size; p += 4) resIds.push(v.getUint32(p, true));
    } else if (type === 0x0102) {
      const ext = off + headerSize;
      const name = strings[v.getUint32(ext + 4, true)];
      const attrStart = v.getUint16(ext + 8, true);
      const attrSize = v.getUint16(ext + 10, true);
      const count = v.getUint16(ext + 12, true);
      for (let i = 0; i < count; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIdx = v.getUint32(a + 4, true);
        const attr = strings[nameIdx] ?? '';
        const resId = resIds[nameIdx];
        const raw = v.getUint32(a + 8, true);
        const dataType = v.getUint8(a + 15);
        const data = v.getUint32(a + 16, true);
        const str = dataType === 0x03 ? strings[data] : raw !== 0xffffffff ? strings[raw] : undefined;
        const int = dataType === 0x10 || dataType === 0x11 ? data : undefined;
        if (name === 'manifest') {
          if (attr === 'package') out.packageName = str;
          if (attr === 'versionCode' || resId === ATTR.versionCode) out.versionCode = int ?? Number(str);
          if (attr === 'versionName' || resId === ATTR.versionName)
            out.versionName = str ?? (int !== undefined ? String(int) : undefined);
        } else if (name === 'uses-sdk' && (attr === 'minSdkVersion' || resId === ATTR.minSdkVersion)) {
          out.minSdk = int ?? Number(str);
        }
      }
      if (name === 'uses-sdk' || (name === 'application' && out.packageName)) break;
    }
    off += size;
  }
  if (!out.packageName || out.versionCode === undefined || Number.isNaN(out.versionCode)) {
    throw new ApkError('not_apk', '매니페스트에서 패키지명·버전 코드를 찾지 못했습니다.');
  }
  return out as { packageName: string; versionCode: number; versionName?: string; minSdk?: number };
}

function stringPool(buf: Uint8Array, v: DataView, off: number): string[] {
  const count = v.getUint32(off + 8, true);
  const utf8 = (v.getUint32(off + 16, true) & 0x100) !== 0;
  const stringsStart = off + v.getUint32(off + 20, true);
  const offsets = Array.from({ length: count }, (_, i) => v.getUint32(off + v.getUint16(off + 2, true) + i * 4, true));
  const dec8 = new TextDecoder('utf-8');
  const dec16 = new TextDecoder('utf-16le');
  return offsets.map((o) => {
    let p = stringsStart + o;
    if (utf8) {
      p += buf[p]! & 0x80 ? 2 : 1; // UTF-16 길이 (건너뜀)
      let len = buf[p]!;
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf[++p]!;
      p++;
      return dec8.decode(buf.subarray(p, p + len));
    }
    let len = v.getUint16(p, true);
    if (len & 0x8000) {
      len = ((len & 0x7fff) << 16) | v.getUint16(p + 2, true);
      p += 2;
    }
    p += 2;
    return dec16.decode(buf.subarray(p, p + len * 2));
  });
}

// ---------------------------------------------------------------- APK 서명 블록 (v2·v3)

/** 서명 블록에서 해당 방식(id)의 첫 서명자의 첫 인증서 DER. 블록·방식이 없으면 undefined */
function signingBlockCert(buf: Uint8Array, schemeId: number): Uint8Array | undefined {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 중앙 디렉터리 끝 레코드(EOCD)는 끝에서 22바이트 + 주석(최대 64KB) 안에 있다
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const cd = v.getUint32(eocd + 16, true);
  if (cd < 32) return undefined;
  const magic = new TextDecoder().decode(buf.subarray(cd - 16, cd));
  if (magic !== 'APK Sig Block 42') return undefined;
  const blockSize = Number(v.getBigUint64(cd - 24, true));
  const start = cd - blockSize - 8;
  for (let p = start + 8; p < cd - 24;) {
    const len = Number(v.getBigUint64(p, true));
    const id = v.getUint32(p + 8, true);
    if (id === schemeId) {
      // signers → signer → signedData → (digests, certificates) → 첫 인증서
      const signers = lp(v, p + 12);
      const signer = lp(v, signers.start);
      const signedData = lp(v, signer.start);
      const digests = lp(v, signedData.start);
      const certs = lp(v, digests.end);
      const cert = lp(v, certs.start);
      return buf.slice(cert.start, cert.end);
    }
    p += 8 + len;
  }
  return undefined;
}

/** 길이(uint32) 접두 값 */
function lp(v: DataView, at: number) {
  const len = v.getUint32(at, true);
  return { start: at + 4, end: at + 4 + len };
}

// ---------------------------------------------------------------- v1 (PKCS#7 SignedData)

type Tlv = { tag: number; start: number; end: number; next: number };
function tlv(b: Uint8Array, at: number): Tlv {
  const tag = b[at]!;
  let len = b[at + 1]!;
  let p = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p++]!;
  }
  return { tag, start: p, end: p + len, next: p + len };
}

/** ContentInfo { OID, [0] SignedData { version, digestAlgs, contentInfo, [0] certificates, … } } → 첫 인증서 DER */
function pkcs7FirstCert(b: Uint8Array): Uint8Array {
  const contentInfo = tlv(b, 0);
  const oid = tlv(b, contentInfo.start);
  const explicit = tlv(b, oid.next);
  const signedData = tlv(b, explicit.start);
  let p = signedData.start;
  for (let i = 0; i < 3; i++) p = tlv(b, p).next; // version, digestAlgorithms, contentInfo
  const certs = tlv(b, p);
  if (certs.tag !== 0xa0) throw new ApkError('unsigned', 'v1 서명에서 인증서를 찾지 못했습니다.');
  const first = tlv(b, certs.start);
  return b.slice(certs.start, first.next);
}
