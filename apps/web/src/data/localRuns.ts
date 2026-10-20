import type { Build, CaseResult, QADocument, TestCycle } from '@qcard/shared';

/** 호스트에서 돌린 실행 하나 (개발 서버의 /__runs/index.json, `apps/web/vite/local-runs.ts`) */
export type LocalRun = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  device: { serial?: string; model: string; osMajor: number; size?: { w: number; h: number }; density?: number };
  appPackage: string;
  docId: string;
  costUsd?: number;
  results: CaseResult[];
};

export async function fetchLocalRuns(url = '/__runs/index.json'): Promise<LocalRun[]> {
  const res = await fetch(url).catch(() => undefined);
  if (!res?.ok || !res.headers.get('content-type')?.includes('json')) return [];
  return (await res.json()) as LocalRun[];
}

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * 로컬 실행 → 사이클. 실행한 케이스만 스냅샷에 넣고, 대상 디바이스는 실행한 기기 하나다.
 * 빌드는 실제 업로드 빌드가 아니므로 설치된 앱 패키지로 표시한다.
 */
export function localRunCycle(run: LocalRun, doc: QADocument): { cycle: TestCycle; build: Build } {
  const deviceId = run.results[0]?.deviceId ?? `${run.device.model}-${run.device.osMajor}`;
  const size = run.device.size;
  const hashOf = new Map(doc.cases.map((c) => [c.tcId, c.contentHash]));
  const build: Build = {
    id: `local-${run.id}`,
    version: run.appPackage,
    buildNumber: 0,
    packageName: run.appPackage,
    signingSha1: '—',
    uploadedAt: run.startedAt,
  };
  const cycle: TestCycle = {
    id: `run-${run.id}`,
    projectId: 'haru',
    name: `로컬 실행 · ${stamp(run.startedAt)} · ${run.device.model}`,
    docId: doc.id,
    buildId: build.id,
    targets: [
      {
        id: deviceId,
        model: run.device.model,
        osMajor: run.device.osMajor,
        resolution: size ? `${size.w}×${size.h}` : '—',
        label: `${run.device.model} · Android ${run.device.osMajor}`,
      },
    ],
    period: { start: run.startedAt, end: run.finishedAt ?? run.startedAt },
    serverEnv: 'dev',
    snapshot: run.results.map((r) => ({ tcId: r.tcId, contentHash: hashOf.get(r.tcId) ?? '' })),
    accounts: [],
    createdBy: 'host-agent',
    origin: 'local_run',
  };
  return { cycle, build };
}
