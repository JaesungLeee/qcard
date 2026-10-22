import { createFixtureDb, GITHUB } from '@qcard/fixtures';
import type { CaseResult, TestCycle } from '@qcard/shared';

/*
 * fixture → Firestore 문서 목록 [경로, 데이터]. 에뮬레이터 개발용 시드(pnpm emu)와 에뮬레이터 테스트가 함께 쓴다.
 * 순서가 필요한 하위 문서에는 `_i`를 붙인다 (Firestore 구현이 읽을 때 정렬하고 뗀다).
 */
export function seedDocs(opts: { deviceCycle?: boolean } = {}): [string, Record<string, unknown>][] {
  const db = createFixtureDb();
  const out: [string, Record<string, unknown>][] = [];
  const put = (path: string, data: unknown) => out.push([path, JSON.parse(JSON.stringify(data))]);

  for (const [name, github] of Object.entries(GITHUB)) put(`users/${github}`, { name, github });
  for (const p of db.projects) put(`projects/${p.id}`, p);
  for (const m of db.members) put(`projects/${m.projectId}/members/${m.uid}`, m);
  for (const inv of db.invitations) {
    put(`projects/${inv.projectId}/invitations/${inv.id}`, inv);
    put(`invitationTokens/${inv.token}`, { projectId: inv.projectId, invitationId: inv.id });
  }
  for (const { cases, ...meta } of db.qaDocs) {
    const base = `projects/${meta.projectId}/qaDocs/${meta.id}`;
    put(base, meta);
    cases.forEach((c, i) => put(`${base}/cases/${c.tcId}`, { ...c, _i: i }));
  }
  // 준비 플로우는 하루콩 스펙에서 나온 것
  db.prepFlows.forEach((f, i) => put(`projects/haru/prepFlows/${f.id}`, { ...f, _i: i }));
  for (const c of db.cycles) {
    const base = `projects/${c.projectId}/cycles/${c.id}`;
    put(base, c);
    const build = db.builds.find((b) => b.id === c.buildId);
    if (build) put(`projects/${c.projectId}/builds/${build.id}`, build);
    (db.results[c.id] ?? []).forEach((r, i) => put(`${base}/results/${r.tcId}__${r.deviceId}`, { ...r, _i: i }));
    (db.runs[c.id] ?? []).forEach((r, i) => put(`${base}/runs/${r.id}`, { ...r, _i: i }));
    (db.defects[c.id] ?? []).forEach((d, i) => put(`${base}/defects/${d.id}`, { ...d, _i: i }));
  }
  if (opts.deviceCycle) deviceCycle(db, put);
  return out;
}

/** 개발용: 연결된 실기기(SM-S711N)를 대상으로 하는 사이클. 호스트 에이전트(run-cycle)를 실제로 돌려 보는 용도 */
export const DEVICE_CYCLE = { id: 'cycle-130-device', deviceId: 'sm-s711n-16' };

function deviceCycle(db: ReturnType<typeof createFixtureDb>, put: (path: string, data: unknown) => void) {
  const base = db.cycles.find((c) => c.id === 'cycle-130-1')!;
  const doc = db.qaDocs.find((d) => d.id === base.docId)!;
  const target = {
    id: DEVICE_CYCLE.deviceId,
    model: 'SM-S711N',
    osMajor: 16,
    resolution: '1080×2340',
    label: 'SM-S711N (Android 16)',
  };
  const cycle: TestCycle = {
    ...base,
    id: DEVICE_CYCLE.id,
    name: '1.3.0 (130) 실기기 확인',
    targets: [target],
    period: { start: '2026-10-22T10:00:00+09:00' },
  };
  const path = `projects/${cycle.projectId}/cycles/${cycle.id}`;
  put(path, cycle);
  const ids = new Set(cycle.snapshot.map((s) => s.tcId));
  doc.cases
    .filter((c) => ids.has(c.tcId))
    .forEach((c, i) => {
      const nt: CaseResult = {
        tcId: c.tcId,
        deviceId: target.id,
        verdict: 'nt',
        autoConfirmed: false,
        unmetConditions: [],
        attempts: 0,
        steps: [],
        points: [],
        history: [],
      };
      put(`${path}/results/${c.tcId}__${target.id}`, { ...nt, _i: i });
    });
}

/** 에뮬레이터 로그인용 테스트 사용자 (uid = GitHub 사용자명) */
export const SEED_USERS = Object.entries(GITHUB).map(([name, github]) => ({
  uid: github,
  name,
  github,
  email: `${github}@qcard.test`,
}));

/** 시드 사용자 비밀번호 (에뮬레이터 전용) */
export const SEED_PASSWORD = 'qcard-dev';
