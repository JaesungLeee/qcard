import { describe, expect, it } from 'vitest';
import { readBundle, rowHash, parseSpec } from '.';

// 팀 스펙 템플릿 모양의 합성 문서 (실제 스펙 원문은 저장소에 두지 않는다)
const SPEC = `# 스펙 명세서: 샘플 기능 (Sample)

**버전**: 2.1.0

**기준 PRD 버전**: 9.0.0

**상태**: CREATED

## 1. 유저 시나리오 (User Scenarios) *(필수)*

### 유저 플로우 1 - 처음 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-001 | 첫 화면 | 처음 설치함 | 앱을 연다 | \`시작하기\`가 보인다 | FR-001, UX-001 |
| **TS-001a** | 끼워 넣은 행 | 처음 설치함 | 뒤로가기 | 앱이 백그라운드로 간다 \\| 다시 열면 그대로 | FR-002 |

| ID | 상황 | 처리 | 관련 FR |
|---|---|---|---|
| EC-001 | 네트워크가 없다 | 재시도 안내를 띄운다 | FR-001 |

### 유저 플로우 2 - 다시 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-002 | 재실행 | 한 번 열었음 | 앱을 다시 연다 | 홈이 열린다 | FR-003 |

## 2. 요구사항 (Requirements) *(필수)*

### 2.1 기능적 요구사항

- **FR-001**: 시스템은 반드시 첫 화면을 보여 준다. (근거: PRD [SCR-001])
- **FR-002**: 뒤로가기는 앱을 백그라운드로 보낸다.
  - **FR-002에서 바뀐 점**: 개정 메모 속 언급은 요구사항이 아니다
- **FR-003**: 재실행하면 홈을 연다.

### 2.2 핵심 UX 규칙

- **UX-001**: 버튼은 하단에 둔다. (근거: Figma \`001\`)
`;

describe('parseSpec', () => {
  const { spec, warnings } = parseSpec('sample', SPEC);

  it('머리말·요구사항(근거 분리)·플로우를 읽는다', () => {
    expect(spec).toMatchObject({
      title: '샘플 기능 (Sample)',
      version: '2.1.0',
      prdVersion: '9.0.0',
      status: 'CREATED',
    });
    expect(spec.requirements.map((r) => [r.id, r.kind])).toEqual([
      ['FR-001', 'FR'],
      ['FR-002', 'FR'],
      ['FR-003', 'FR'],
      ['UX-001', 'UX'],
    ]);
    expect(spec.requirements[0]).toMatchObject({
      text: '시스템은 반드시 첫 화면을 보여 준다.',
      basis: 'PRD [SCR-001]',
    });
    expect(spec.flows.map((f) => f.title)).toEqual(['처음 연다', '다시 연다']);
    expect(warnings).toEqual([]);
  });

  it('TS·EC 행: 굵은 ID·접미사 ID·이스케이프된 | 를 다루고 플로우·출처 위치를 붙인다', () => {
    expect(spec.rows.map((r) => r.id)).toEqual(['TS-001', 'TS-001a', 'EC-001', 'TS-002']);
    expect(spec.rows[1]).toMatchObject({
      then: '앱이 백그라운드로 간다 | 다시 열면 그대로',
      frs: ['FR-002'],
      flow: '처음 연다',
    });
    expect(spec.rows[2]).toMatchObject({
      kind: 'EC',
      title: '네트워크가 없다',
      given: '',
      when: '네트워크가 없다',
      then: '재시도 안내를 띄운다',
    });
    const line = SPEC.split('\n').findIndex((l) => l.startsWith('| TS-002 |')) + 1;
    expect(spec.rows[3]).toMatchObject({ flow: '다시 연다', line });
    expect(spec.rows[0]!.headingPath).toEqual([
      '스펙 명세서: 샘플 기능 (Sample)',
      '1. 유저 시나리오 (User Scenarios) *(필수)*',
      '유저 플로우 1 - 처음 연다',
    ]);
  });

  it('문서에 없는 요구사항을 가리키거나 같은 ID가 다시 나오면 경고한다', () => {
    const bad = SPEC.replace('FR-003 |', 'FR-999 |').replace('| TS-002 |', '| TS-001 |');
    const w = parseSpec('sample', bad).warnings.join('\n');
    expect(w).toContain('TS-001가 다시 나온다');
  });
});

describe('rowHash', () => {
  const base = parseSpec('sample', SPEC).spec;
  const hashOf = (md: string, id: string) => {
    const s = parseSpec('sample', md).spec;
    return rowHash(
      s.rows.find((r) => r.id === id)!,
      s.requirements,
    );
  };
  const h = (id: string) =>
    rowHash(
      base.rows.find((r) => r.id === id)!,
      base.requirements,
    );

  it('위치만 바뀌면 같고, 행 본문이나 관련 요구사항 본문이 바뀌면 다르다', () => {
    expect(hashOf(`\n\n${SPEC}`, 'TS-001')).toBe(h('TS-001')); // 줄 번호만 바뀜
    expect(hashOf(SPEC.replace('`시작하기`가 보인다', '`시작`이 보인다'), 'TS-001')).not.toBe(h('TS-001'));
    expect(hashOf(SPEC.replace('첫 화면을 보여 준다.', '첫 화면을 바로 보여 준다.'), 'TS-001')).not.toBe(h('TS-001'));
    // 관련 없는 요구사항이 바뀌면 그대로
    expect(hashOf(SPEC.replace('재실행하면 홈을 연다.', '재실행하면 홈을 바로 연다.'), 'TS-001')).toBe(h('TS-001'));
  });
});

describe('readBundle', () => {
  it('<스펙 이름>/spec.md만 읽고 나머지는 무시한다 (ZIP 앞 경로 상관없이)', () => {
    const b = readBundle([
      { path: 'docs/specs/sample/spec.md', content: SPEC },
      { path: 'docs/specs/sample/plan.md', content: '# 계획' },
      { path: 'docs/specs/sample/contracts/api.md', content: '' },
      { path: 'other\\spec.md', content: SPEC.replace('샘플 기능', '다른 기능') },
    ]);
    expect(b.specs.map((s) => s.name)).toEqual(['sample', 'other']);
    expect(b.ignored).toBe(2);
  });
});
