import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 테스트 계정 비밀값 암호화 (F-EX-09). 운영은 Cloud KMS, 에뮬레이터·테스트는 로컬 키(AES-256-GCM).
 * 봉인한 값에 방식이 붙어 있어 다른 방식의 값을 열려고 하면 실패한다.
 */
export interface SecretBox {
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

const LOCAL = 'local:';
const KMS = 'kms:';

/** 에뮬레이터·테스트용. `passphrase`로 키를 만든다 */
export function localBox(passphrase: string): SecretBox {
  const key = createHash('sha256').update(passphrase).digest();
  return {
    async seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return LOCAL + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
    },
    async open(sealed) {
      if (!sealed.startsWith(LOCAL)) throw new Error('로컬 키로 봉인한 값이 아닙니다.');
      const buf = Buffer.from(sealed.slice(LOCAL.length), 'base64');
      const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

/**
 * Cloud KMS 대칭 키 (`projects/…/locations/…/keyRings/…/cryptoKeys/…`). REST API를 부른다.
 * `accessToken`은 Functions 서비스 계정의 토큰(Admin SDK applicationDefault)
 */
export function kmsBox(keyName: string, accessToken: () => Promise<string>): SecretBox {
  const post = async (op: 'encrypt' | 'decrypt', body: object) => {
    const res = await fetch(`https://cloudkms.googleapis.com/v1/${keyName}:${op}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Cloud KMS ${op} 실패 (${res.status})`);
    return (await res.json()) as { ciphertext?: string; plaintext?: string };
  };
  return {
    async seal(plain) {
      const r = await post('encrypt', { plaintext: Buffer.from(plain, 'utf8').toString('base64') });
      return KMS + r.ciphertext!;
    },
    async open(sealed) {
      if (!sealed.startsWith(KMS)) throw new Error('Cloud KMS로 봉인한 값이 아닙니다.');
      const r = await post('decrypt', { ciphertext: sealed.slice(KMS.length) });
      return Buffer.from(r.plaintext ?? '', 'base64').toString('utf8');
    },
  };
}
