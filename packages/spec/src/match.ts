import type { TestCase } from '@qcard/shared';
import type { SpecBundle } from './bundle';
import { rowHash, sourceId, type SpecDoc, type SpecRow } from './parse';

/*
 * 버전 간 결정적 매칭. LLM을 쓰지 않는다.
 *   - 출처 ID(`<스펙>/TS-001`)가 같고 출처 해시가 같으면 **동일**: 이전 케이스 블록을 그대로 복사 (사람의 수정·승인 유지)
 *   - 출처 ID가 같고 해시가 다르면 **변경**: 같은 TC ID로 다시 만든다 (사람이 고친 이전 블록을 LLM에 함께 넘긴다)
 *   - 이전에 없던 출처는 **신규**: 새 TC ID
 *   - 스냅샷에서 사라진 출처는 **삭제**
 * TC ID는 한 번 쓰면 다시 쓰지 않는다 (삭제된 번호 포함).
 */

export type RowDecision = 'same' | 'changed' | 'new';

export type RowPlan = {
  spec: SpecDoc;
  row: SpecRow;
  sourceId: string;
  sourceHash: string;
  decision: RowDecision;
  tcId: string;
  /** 동일·변경일 때 이전 버전 케이스 */
  previous?: TestCase;
};

export type MatchPlan = {
  rows: RowPlan[];
  /** 이번 스냅샷에서 사라진 이전 케이스 */
  removed: TestCase[];
  counts: Record<RowDecision | 'removed', number>;
};

/** 스펙 이름 → TC ID 접두어. `room-detail` → `ROOM-DETAIL` */
export const defaultPrefix = (spec: string) => spec.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

const NUM = /^TC-(.+)-(\d+)$/;

export function matchVersions(bundle: SpecBundle, prev?: { cases: TestCase[] }): MatchPlan {
  const prevCases = prev?.cases ?? [];
  const bySource = new Map(prevCases.filter((c) => c.change !== 'removed').map((c) => [c.sourceId, c]));

  // 스펙별 접두어(이전 버전에서 쓰던 것 우선)와 이미 쓴 가장 큰 번호
  const prefix = new Map<string, string>();
  const used = new Map<string, number>();
  for (const c of prevCases) {
    const m = NUM.exec(c.tcId);
    if (!m) continue;
    const spec = c.sourceId.split('/')[0]!;
    if (!prefix.has(spec)) prefix.set(spec, m[1]!);
    used.set(m[1]!, Math.max(used.get(m[1]!) ?? 0, Number(m[2])));
  }
  const nextId = (spec: string) => {
    const p = prefix.get(spec) ?? defaultPrefix(spec);
    prefix.set(spec, p);
    const n = (used.get(p) ?? 0) + 1;
    used.set(p, n);
    return `TC-${p}-${String(n).padStart(3, '0')}`;
  };

  const rows: RowPlan[] = [];
  const seen = new Set<string>();
  for (const spec of bundle.specs) {
    for (const row of spec.rows) {
      const sid = sourceId(spec.name, row.id);
      seen.add(sid);
      const h = rowHash(row, spec.requirements);
      const old = bySource.get(sid);
      const decision: RowDecision = !old ? 'new' : old.sourceHash === h ? 'same' : 'changed';
      rows.push({
        spec,
        row,
        sourceId: sid,
        sourceHash: h,
        decision,
        tcId: old ? old.tcId : nextId(spec.name),
        ...(old ? { previous: old } : {}),
      });
    }
  }
  const removed = [...bySource.values()].filter((c) => !seen.has(c.sourceId));
  const count = (d: RowDecision) => rows.filter((r) => r.decision === d).length;
  return {
    rows,
    removed,
    counts: { same: count('same'), changed: count('changed'), new: count('new'), removed: removed.length },
  };
}
