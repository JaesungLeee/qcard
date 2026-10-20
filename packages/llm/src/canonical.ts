import { createHash } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** base64 이미지 데이터를 해시로 바꾼다. 녹화 키·파일을 작게 유지하고, 비밀값 검사에서 오탐을 막는다. */
export function redactImages(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactImages);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'base64' && typeof o.data === 'string') {
      const { data, ...rest } = o;
      return { ...rest, sha256: sha256(data) };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, redactImages(x)]));
  }
  return v;
}

/** 키 순서와 무관한 JSON (undefined·함수는 JSON.stringify처럼 뺀다) */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : x,
  );
}
