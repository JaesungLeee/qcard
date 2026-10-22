/** 키 순서와 무관한 JSON (undefined 필드는 뺀다) */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/**
 * FNV-1a 32bit 결정적 내용 해시. 케이스 내용 해시(승인 기준, F-QD-10)와
 * 스펙 행 해시(버전 간 동일·변경 판정, F-QD-08)에 쓴다.
 */
export function hash(value: unknown): string {
  const s = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
