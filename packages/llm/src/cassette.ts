import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, redactImages, sha256 } from './canonical';
import { assertNoSecrets } from './secrets';
import type { LlmCallMeta, LlmClient, LlmRequest, LlmResponse } from './types';

/*
 * LLM 녹화·재생. 요청을 정규화한 해시가 키이고, 파일 하나에 요청(이미지는 해시만)과 응답을 담는다.
 * 재생 모드에서 녹화가 없으면 실패한다 — 실제 API는 녹화 모드에서만 부른다.
 */

export type Cassette = {
  key: string;
  recordedAt: string;
  meta: LlmCallMeta;
  request: unknown;
  response: LlmResponse;
};

export class CassetteMissError extends Error {
  override name = 'CassetteMissError';
}

/** 키 순서·이미지 인코딩 차이와 무관한 요청 키 */
export const requestKey = (req: LlmRequest) => sha256(canonicalJson(redactImages(req)));

const fileOf = (dir: string, key: string) => join(dir, `${key.slice(0, 16)}.json`);

/**
 * replay: 녹화만 재생 (없으면 실패) · record: 항상 실제로 부르고 녹화 ·
 * resume: 녹화가 있으면 재생, 없으면 실제로 부르고 녹화 (중단된 작업을 이어 할 때 끝난 호출을 다시 부르지 않는다)
 */
export function createCassetteLlm(
  options: { dir: string; mode: 'replay' } | { dir: string; mode: 'record' | 'resume'; inner: LlmClient },
): LlmClient {
  const { dir } = options;
  return {
    async create(req, meta) {
      const key = requestKey(req);
      const file = fileOf(dir, key);
      if (options.mode !== 'record') {
        const raw = await readFile(file, 'utf8').catch(() => undefined);
        const cassette = raw ? (JSON.parse(raw) as Cassette) : undefined;
        if (cassette?.key === key) return cassette.response;
        if (options.mode === 'replay') {
          throw new CassetteMissError(
            `LLM 녹화 없음: ${key.slice(0, 16)} (${meta.role}${meta.caseId ? ` · ${meta.caseId}` : ''}). 요청이 바뀌었으면 LLM_MODE=record로 다시 녹화하세요`,
          );
        }
      }
      const response = await options.inner.create(req, meta);
      const cassette: Cassette = {
        key,
        recordedAt: new Date().toISOString(),
        meta,
        request: redactImages(req),
        response,
      };
      assertNoSecrets(cassette, undefined, 'LLM 녹화');
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(cassette, null, 2) + '\n');
      return response;
    },
  };
}
