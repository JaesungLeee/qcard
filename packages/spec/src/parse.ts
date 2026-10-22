import { hash } from '@qcard/shared';

/*
 * 스펙 문서(spec.md) 파서 (F-IN-01·03·08, F-QD-01·02). LLM 없이 결정적으로 뽑는다.
 *
 * 읽는 것 (팀 스펙 템플릿 기준)
 *   - 머리말:      **버전**: 1.2.1 · **기준 PRD 버전** · **상태** · **최종 수정일**
 *   - 요구사항:    줄 맨 앞의 `- **FR-001**: 본문 (근거: …)` · `- **UX-001**: …` (들여쓴 줄은 개정 메모 속 언급이라 뺀다)
 *   - 시나리오:    `### 유저 플로우 N - 제목` 아래의 표
 *                   TS: | ID | 시나리오 | Given | When | Then | 관련 FR |
 *                   EC: | ID | 상황 | 처리 | 관련 FR |
 * 케이스는 TS·EC 행에서만 만든다 (PRD v0.6). 행마다 출처 위치(헤딩 경로·줄)와 내용 해시를 둔다.
 */

export type SpecRequirement = {
  /** FR-001 · UX-001 */
  id: string;
  kind: 'FR' | 'UX';
  /** `(근거: …)`를 뺀 본문 */
  text: string;
  basis?: string;
  headingPath: string[];
  line: number;
};

export type SpecRow = {
  kind: 'TS' | 'EC';
  id: string;
  title: string;
  /** EC는 비어 있다 */
  given: string;
  /** EC는 「상황」 */
  when: string;
  /** EC는 「처리」 */
  then: string;
  /** 관련 요구사항 (FR·UX) */
  frs: string[];
  /** 속한 유저 플로우 제목 */
  flow: string;
  headingPath: string[];
  line: number;
};

export type SpecDoc = {
  /** 폴더 이름 (예: onboarding-flow) — 요구사항·출처 ID의 접두어 */
  name: string;
  title: string;
  version?: string;
  prdVersion?: string;
  status?: string;
  updatedAt?: string;
  requirements: SpecRequirement[];
  rows: SpecRow[];
  flows: { title: string; line: number }[];
};

export type ParseResult = { spec: SpecDoc; warnings: string[] };

const META: Record<string, keyof SpecDoc> = {
  버전: 'version',
  '기준 PRD 버전': 'prdVersion',
  상태: 'status',
  '최종 수정일': 'updatedAt',
};

/** 표 칸 나누기. `\|`는 칸 구분이 아니다 */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const unbold = (s: string) => s.replace(/^\*\*(.*)\*\*$/, '$1').trim();

/** 머리줄 이름 → 행 필드 */
function columnsOf(
  header: string[],
): Partial<Record<'id' | 'title' | 'given' | 'when' | 'then' | 'frs', number>> | undefined {
  const at = (...names: string[]) => header.findIndex((h) => names.includes(h.replace(/\s+/g, '').toLowerCase()));
  const id = at('id');
  if (id < 0) return undefined;
  const scenario = at('시나리오');
  if (scenario >= 0) {
    return { id, title: scenario, given: at('given'), when: at('when'), then: at('then'), frs: at('관련fr', 'fr') };
  }
  const situation = at('상황');
  if (situation >= 0) return { id, title: situation, when: situation, then: at('처리'), frs: at('관련fr', 'fr') };
  return undefined;
}

export function parseSpec(name: string, markdown: string): ParseResult {
  const warnings: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const spec: SpecDoc = { name, title: name, requirements: [], rows: [], flows: [] };
  const headings: string[] = [];
  let flow = '';
  let table: ReturnType<typeof columnsOf> | undefined;
  const seen = new Set<string>();

  lines.forEach((raw, i) => {
    const line = i + 1;
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(raw);
    if (h) {
      const depth = h[1]!.length;
      const text = h[2]!;
      headings.length = depth - 1;
      headings[depth - 1] = text;
      if (depth === 1) spec.title = text.replace(/^스펙 명세서\s*[:：]\s*/, '');
      const f = /^유저 플로우\s*\d+\s*[-–—:]\s*(.+)$/.exec(text);
      if (f) {
        flow = f[1]!.trim();
        spec.flows.push({ title: flow, line });
      } else if (depth <= 2) flow = '';
      table = undefined;
      return;
    }

    const meta = /^\*\*(.+?)\*\*\s*[:：]\s*(.+)$/.exec(raw.trim());
    if (meta && META[meta[1]!] && headings.filter(Boolean).length <= 1) {
      (spec as Record<string, unknown>)[META[meta[1]!]!] = meta[2]!.trim();
      return;
    }

    const req = /^[-*]\s+\*\*((FR|UX)-\d+)\*\*\s*[:：]\s*(.+)$/.exec(raw);
    if (req) {
      const [, id, kind, body] = req as unknown as [string, string, 'FR' | 'UX', string];
      const basis = /\s*\(근거\s*[:：]\s*(.+)\)\s*$/.exec(body);
      if (spec.requirements.some((r) => r.id === id))
        warnings.push(`${line}: 요구사항 ${id}가 다시 나온다 (앞의 것을 쓴다)`);
      else
        spec.requirements.push({
          id,
          kind,
          text: (basis ? body.slice(0, basis.index) : body).trim(),
          ...(basis ? { basis: basis[1]!.trim() } : {}),
          headingPath: headings.filter(Boolean),
          line,
        });
      return;
    }

    if (!raw.trim().startsWith('|')) {
      if (raw.trim()) table = undefined;
      return;
    }
    const row = cells(raw);
    if (row.every((c) => /^:?-{2,}:?$/.test(c))) return; // 구분줄
    const header = columnsOf(row);
    if (header) {
      table = header;
      return;
    }
    if (!table) return;
    const id = unbold(row[table.id!] ?? '');
    // 끼워 넣은 행은 TS-002a·TS-003-1처럼 접미사가 붙는다
    const kind = /^(TS|EC)-\d+(?:[a-z]|-\d+)*$/.exec(id)?.[1] as 'TS' | 'EC' | undefined;
    if (!kind) return;
    if (seen.has(id)) {
      warnings.push(`${line}: ${id}가 다시 나온다 (앞의 것을 쓴다)`);
      return;
    }
    seen.add(id);
    const get = (k: keyof NonNullable<typeof table>) => {
      const at = table![k];
      return at === undefined || at < 0 ? '' : (row[at] ?? '').trim();
    };
    const frs = [...get('frs').matchAll(/(FR|UX)-\d+/g)].map((m) => m[0]);
    const r: SpecRow = {
      kind,
      id,
      title: get('title'),
      given: get('given'),
      when: get('when'),
      then: get('then'),
      frs,
      flow,
      headingPath: headings.filter(Boolean),
      line,
    };
    if (!r.then) warnings.push(`${line}: ${id}에 Then(처리)이 없다`);
    if (!flow) warnings.push(`${line}: ${id}가 유저 플로우 밖에 있다`);
    spec.rows.push(r);
  });

  const known = new Set(spec.requirements.map((r) => r.id));
  for (const r of spec.rows) {
    const missing = r.frs.filter((f) => !known.has(f));
    if (missing.length) warnings.push(`${r.line}: ${r.id}의 관련 요구사항 ${missing.join(', ')}가 문서에 없다`);
  }
  return { spec, warnings };
}

/**
 * 행의 내용 해시 (F-QD-08). 행 본문과 관련 요구사항 본문이 같으면 같다 — 이 값이 같으면 이전 버전 케이스를
 * LLM 없이 그대로 복사하고, 다르면 재생성한다. 줄 번호·플로우 이름처럼 위치만 바뀐 것은 반영하지 않는다.
 */
export function rowHash(
  row: Pick<SpecRow, 'kind' | 'title' | 'given' | 'when' | 'then' | 'frs'>,
  requirements: Pick<SpecRequirement, 'id' | 'text'>[],
): string {
  const related = row.frs.map((id) => requirements.find((r) => r.id === id)?.text ?? '');
  return hash({
    kind: row.kind,
    title: row.title,
    given: row.given,
    when: row.when,
    then: row.then,
    frs: row.frs,
    related,
  });
}

/** 출처 ID: `<스펙 이름>/TS-001` */
export const sourceId = (spec: string, rowId: string) => `${spec}/${rowId}`;
