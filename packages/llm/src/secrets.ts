import { canonicalJson, redactImages } from './canonical';
import type { LlmClient } from './types';

/*
 * 테스트 계정 비밀값 (F-EX-09). Run 시작 때 배정된 계정분만 넣고 끝나면 비운다.
 * LLM에는 `{{secret.이름}}` 플레이스홀더만 가고, 디바이스에 입력할 때 실제 값으로 바꾼다.
 */

export class SecretLeakError extends Error {
  override name = 'SecretLeakError';
}

const PLACEHOLDER = /\{\{secret\.([a-z0-9_]+)\}\}/g;
const API_KEY = /sk-ant-[A-Za-z0-9_-]{8,}/;
/** 이보다 짧은 값은 우연히 겹칠 수 있어 유출 검사에서 뺀다 */
const MIN_LEAK_LENGTH = 4;

export class SecretVault {
  private readonly values = new Map<string, string>();

  set(name: string, value: string) {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`비밀값 이름은 소문자·숫자·밑줄만: ${name}`);
    this.values.set(name, value);
    return this.placeholder(name);
  }

  placeholder(name: string) {
    return `{{secret.${name}}}`;
  }

  /** 플레이스홀더 → 실제 값 (디바이스 입력 직전에만) */
  resolve(text: string) {
    return text.replace(PLACEHOLDER, (_m, name: string) => {
      const v = this.values.get(name);
      if (v === undefined) throw new Error(`배정되지 않은 비밀값: ${name}`);
      return v;
    });
  }

  /** 실제 값 → 플레이스홀더 (로그·리포트) */
  mask(text: string) {
    let out = text;
    for (const [name, v] of this.values) if (v.length > 0) out = out.split(v).join(this.placeholder(name));
    return out;
  }

  /** 들어 있는 비밀값 이름. JSON 문자열 안에서 이스케이프된 형태(따옴표·역슬래시)도 찾는다 */
  findLeak(text: string): string | undefined {
    for (const [name, v] of this.values) {
      if (v.length < MIN_LEAK_LENGTH) continue;
      if (text.includes(v) || text.includes(JSON.stringify(v).slice(1, -1))) return name;
    }
    return undefined;
  }

  clear() {
    this.values.clear();
  }
}

/** API 키나 비밀값이 들어 있으면 실패한다. 녹화 파일을 쓰기 전과 LLM에 보내기 전에 부른다. */
export function assertNoSecrets(value: unknown, vault?: SecretVault, where = '요청') {
  const text = canonicalJson(redactImages(value));
  if (API_KEY.test(text)) throw new SecretLeakError(`${where}에 API 키가 들어 있습니다`);
  const leaked = vault?.findLeak(text);
  if (leaked) throw new SecretLeakError(`${where}에 비밀값 '${leaked}'이(가) 들어 있습니다. 플레이스홀더를 쓰세요`);
}

export function withSecretGuard(inner: LlmClient, vault: SecretVault): LlmClient {
  return {
    async create(req, meta) {
      assertNoSecrets(req, vault);
      return inner.create(req, meta);
    },
  };
}
