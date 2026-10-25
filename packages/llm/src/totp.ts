import { createHmac } from 'node:crypto';

/*
 * TOTP (RFC 6238, SHA-1 · 30초 · 6자리) — 인증 앱 2단계 로그인이 있는 테스트 계정 (F-EX-09).
 * 시드는 base32. 코드는 입력 직전에 계산하고, LLM에는 플레이스홀더만 간다.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(seed: string): Buffer {
  const clean = seed.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('TOTP 시드가 base32가 아닙니다');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(seed: string, nowMs: number, digits = 6, stepSec = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / stepSec)));
  const h = createHmac('sha1', base32(seed)).update(counter).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}
