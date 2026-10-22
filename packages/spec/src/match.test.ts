import type { TestCase } from '@qcard/shared';
import { describe, expect, it } from 'vitest';
import { matchVersions, readBundle, type MatchPlan } from '.';

const spec = (name: string, rows: string[], frs = '- **FR-001**: 첫 화면을 보여 준다.') => ({
  path: `${name}/spec.md`,
  content: `# 스펙 명세서: ${name}

## 1. 유저 시나리오

### 유저 플로우 1 - 흐름

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
${rows.join('\n')}

## 2. 요구사항

${frs}
`,
});
const row = (id: string, then: string) => `| ${id} | ${id} 제목 | 조건 | 조작 | ${then} | FR-001 |`;

/** 계획대로 케이스를 "만든" 것처럼 이전 버전 문서를 꾸민다 (생성기 대신) */
const asDoc = (plan: MatchPlan): { cases: TestCase[] } => ({
  cases: [
    ...plan.rows.map(
      (r) => ({ tcId: r.tcId, sourceId: r.sourceId, sourceHash: r.sourceHash, change: r.decision }) as TestCase,
    ),
    ...plan.removed.map((c) => ({ ...c, change: 'removed' as const })),
  ],
});

describe('matchVersions (F-QD-08)', () => {
  const v1 = matchVersions(
    readBundle([spec('room-list', [row('TS-001', 'A'), row('TS-002', 'B'), row('TS-003', 'C')])]),
  );

  it('처음 버전은 모두 신규이고 스펙 이름으로 TC ID를 만든다', () => {
    expect(v1.counts).toEqual({ same: 0, changed: 0, new: 3, removed: 0 });
    expect(v1.rows.map((r) => r.tcId)).toEqual(['TC-ROOM-LIST-001', 'TC-ROOM-LIST-002', 'TC-ROOM-LIST-003']);
  });

  it('동일·변경·신규·삭제를 가르고 TC ID를 이어받는다. 삭제된 번호는 다시 쓰지 않는다', () => {
    const v2 = matchVersions(
      readBundle([
        spec('room-list', [row('TS-001', 'A'), row('TS-002', 'B 바뀜'), row('TS-004', 'D')]),
        spec('room-detail', [row('TS-001', 'X')]),
      ]),
      asDoc(v1),
    );
    const by = Object.fromEntries(v2.rows.map((r) => [r.sourceId, [r.decision, r.tcId]]));
    expect(by).toEqual({
      'room-list/TS-001': ['same', 'TC-ROOM-LIST-001'],
      'room-list/TS-002': ['changed', 'TC-ROOM-LIST-002'],
      'room-list/TS-004': ['new', 'TC-ROOM-LIST-004'],
      'room-detail/TS-001': ['new', 'TC-ROOM-DETAIL-001'],
    });
    expect(v2.removed.map((c) => c.tcId)).toEqual(['TC-ROOM-LIST-003']);

    // 다음 버전: 삭제됐던 003은 다시 쓰지 않는다
    const v3 = matchVersions(readBundle([spec('room-list', [row('TS-001', 'A'), row('TS-005', 'E')])]), asDoc(v2));
    expect(v3.rows.find((r) => r.row.id === 'TS-005')!.tcId).toBe('TC-ROOM-LIST-005');
  });

  it('관련 요구사항 본문이 바뀌면 행이 그대로여도 변경이다', () => {
    const v2 = matchVersions(
      readBundle([
        spec(
          'room-list',
          [row('TS-001', 'A'), row('TS-002', 'B'), row('TS-003', 'C')],
          '- **FR-001**: 첫 화면을 바로 보여 준다.',
        ),
      ]),
      asDoc(v1),
    );
    expect(v2.counts).toEqual({ same: 0, changed: 3, new: 0, removed: 0 });
  });
});
