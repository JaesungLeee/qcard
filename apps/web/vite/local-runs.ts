import { createReadStream, existsSync } from 'node:fs';
import { open, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { CaseResult, Screenshot } from '@qcard/shared';
import type { Plugin } from 'vite';
import type { LocalRun } from '../src/data/localRuns';

/*
 * 개발 서버 전용: 호스트에서 돌린 실행(packages/agent/runs/<실행>/<TC>/result.json + obs-*.png)을
 * /__runs/index.json(목록)과 /__runs/<실행>/<TC>/<파일>.png로 제공한다. 웹은 이걸 "로컬 실행" 사이클로 보여 준다.
 *
 * QCARD_RUNS_DIR로 폴더를 바꾼다 (ui:snap은 고정 샘플 폴더를 쓴다). `off`면 끈다.
 */

const DEFAULT_DIR = resolve(import.meta.dirname, '../../../packages/agent/runs');

/** PNG 헤더의 가로·세로 (IHDR) */
async function pngSize(file: string): Promise<{ w: number; h: number } | undefined> {
  const fh = await open(file, 'r').catch(() => undefined);
  if (!fh) return undefined;
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    return buf.toString('ascii', 12, 16) === 'IHDR' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : undefined;
  } finally {
    await fh.close();
  }
}

async function readRun(root: string, id: string): Promise<LocalRun | undefined> {
  const dir = join(root, id);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: CaseResult[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const raw = await readFile(join(dir, e.name, 'result.json'), 'utf8').catch(() => undefined);
    if (!raw) continue;
    const r = JSON.parse(raw) as CaseResult;
    // 상대 경로 스크린샷 → 서버 URL, 크기가 없으면 PNG에서 읽는다
    const fix = async (s: Screenshot): Promise<Screenshot> => {
      if (s.kind !== 'url' || s.url.startsWith('/') || s.url.includes(':')) return s;
      const size = s.w && s.h ? undefined : await pngSize(join(dir, e.name, s.url));
      return {
        ...s,
        ...size,
        url: `/__runs/${encodeURIComponent(id)}/${encodeURIComponent(e.name)}/${encodeURIComponent(s.url)}`,
      };
    };
    r.steps = await Promise.all(r.steps.map(async (st) => ({ ...st, screenshot: await fix(st.screenshot) })));
    r.points = await Promise.all(r.points.map(async (p) => ({ ...p, evidence: await fix(p.evidence) })));
    results.push(r);
  }
  if (results.length === 0) return undefined;

  const meta = await readFile(join(dir, 'run.json'), 'utf8')
    .then((t) => JSON.parse(t) as Partial<LocalRun>)
    .catch(() => ({}) as Partial<LocalRun>);
  // run.json이 없던 초기 실행: deviceId(`모델-OS`)와 결과 시각으로 채운다
  const [model = '?', os = '0'] = (results[0]!.deviceId.match(/^(.*)-(\d+)$/)?.slice(1) ?? [
    results[0]!.deviceId,
  ]) as string[];
  const startedAt = meta.startedAt ?? results.map((r) => r.executedAt ?? '').sort()[0] ?? new Date(0).toISOString();
  return {
    id,
    startedAt,
    finishedAt: meta.finishedAt,
    device: meta.device ?? { model, osMajor: Number(os) },
    appPackage: meta.appPackage ?? '알 수 없음',
    docId: meta.docId ?? 'doc-130',
    costUsd: meta.costUsd,
    results: results.sort((a, b) => a.tcId.localeCompare(b.tcId)),
  };
}

export async function listLocalRuns(root: string): Promise<LocalRun[]> {
  if (!existsSync(root)) return [];
  const ids = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const runs = await Promise.all(ids.map((id) => readRun(root, id).catch(() => undefined)));
  return runs.filter((r): r is LocalRun => Boolean(r)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function localRuns(dir = process.env.QCARD_RUNS_DIR ?? DEFAULT_DIR): Plugin {
  const root = resolve(dir);
  return {
    name: 'qcard-local-runs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__runs', (req, res, next) => {
        if (dir === 'off') return next();
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (path === '/index.json') {
          listLocalRuns(root)
            .then((runs) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(JSON.stringify(runs));
            })
            .catch(next);
          return;
        }
        // 실행 폴더 밖으로 나가는 경로와 PNG가 아닌 파일은 거부한다
        const file = resolve(root, `.${path}`);
        if (!file.startsWith(root + sep) || !file.endsWith('.png') || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'image/png');
        createReadStream(file).pipe(res);
      });
    },
  };
}
