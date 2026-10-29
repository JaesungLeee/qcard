import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 이 호스트 에이전트의 버전. 번들(dist/*.js)과 소스(src/*.ts) 모두 한 단계 위에 package.json이 있다 */
export const hostVersion = () =>
  (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
