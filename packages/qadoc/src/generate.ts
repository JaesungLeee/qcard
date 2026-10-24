import { cachedSystem, LlmOutputError, MODELS, outputFormat, parseOutput, type LlmClient } from '@qcard/llm';
import {
  CaseBody,
  hash,
  type PrepFlow,
  type QADocument,
  type QaDocJobDraft,
  type QaDocJobSpec,
  type Requirement,
  type SpecQuestion,
  type SpecSuggestion,
  type TestCase,
} from '@qcard/shared';
import { matchVersions, sourceId, type RowPlan, type SpecBundle, type SpecDoc, type SpecRow } from '@qcard/spec';
import { nameChecker, unmarkUnknownNames } from './names';
import { CASE_SYSTEM, CaseBatchOutput, PLAN_SYSTEM, SpecPlanOutput, type GenCase } from './prompts';

/*
 * QA Doc Generator (PRD §5.2, §6.3): 앱 버전 스펙 묶음 + 이전 QA 문서 → 새 QA 문서.
 *   - 매칭·동일 케이스 복사·TC ID·출처 근거·해시·승인 상태는 코드가 정한다 (F-QD-08·10)
 *   - LLM(요청자의 Claude Code, Opus)은 신규·변경 행만 케이스로 바꾸고, 스펙마다 준비 플로우·보강 제안을 만든다
 * 실행은 요청자의 호스트 에이전트에서 한다. 이 모듈은 Firestore를 모른다 — 결과를 돌려주면 호출한 쪽이 쓴다.
 */

export type GenerateMeta = Pick<QADocument, 'id' | 'projectId' | 'appVersion' | 'specBundleId' | 'createdAt'> & {
  prevDocId?: string;
};

export type GenerateInput = {
  bundle: SpecBundle;
  /** 이전 버전 QA 문서. 없으면 모든 행이 신규 */
  prev?: QADocument;
  /** 이전 버전 스펙 묶음. 있으면 변경 행에 이전 행 본문을 함께 넘긴다 */
  prevBundle?: SpecBundle;
  /** 프로젝트에 이미 있는 준비 플로우 (F-PF-01) */
  prepFlows: PrepFlow[];
  llm: LlmClient;
  meta: GenerateMeta;
  /** 스펙 파일 경로 앞부분 (근거 표시용). 기본 `docs/specs` */
  specRoot?: string;
  model?: string;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (e: GenerateProgress) => void;
};

export type GenerateProgress =
  /** 이전 문서와 매칭한 결과 (스펙마다 행과 신규·변경·동일). 모델을 부르기 전에 한 번 */
  | { kind: 'match'; specs: QaDocJobSpec[]; removed: number }
  /** index: 이번에 계획하는 스펙 순번(0부터) · total: 바뀐 행이 있는 스펙 수 */
  | { kind: 'plan'; spec: string; targets: number; index: number; total: number }
  /** 스펙 계획이 끝났다. prepFlows: 이 스펙에서 새로 만든 준비 플로우 */
  | { kind: 'planned'; spec: string; prepFlows: PrepFlow[]; suggestions: number; index: number; total: number }
  /** 행 묶음을 모델에 보냈다 (출처 ID) */
  | { kind: 'batch_start'; spec: string; sources: string[] }
  /** 행 묶음이 끝났다. drafts: 묶음의 케이스 초안 */
  | {
      kind: 'batch';
      spec: string;
      rows: string[];
      sources: string[];
      drafts: Omit<QaDocJobDraft, 'at'>[];
      done: number;
      total: number;
    }
  | { kind: 'warning'; text: string };

export type GenerateResult = {
  doc: QADocument;
  /** 이번 생성에서 새로 만든 준비 플로우 (프로젝트에 추가할 것) */
  prepFlows: PrepFlow[];
  /** 케이스로 만들지 않은 행 (MVP는 공통·Android만, F-QD-06) */
  skipped: { sourceId: string; reason: string }[];
  warnings: string[];
};

const GENERATOR = 'QA Doc Generator';

/**
 * 코드가 수행하는 유일한 환경 준비 (F-PF-03): 대상 앱 데이터 초기화 후 실행. 모델은 env 플로우를 만들 수 없다 —
 * 기기 설정·다른 앱을 바꾸는 준비가 개인 기기에서 실행되지 않게 (CLAUDE.md "하지 말 것").
 */
export const CLEAN_FLOW: PrepFlow = {
  id: 'pf-clean',
  name: '빈 사용자 (앱 데이터 초기화)',
  kind: 'env',
  check: '앱이 첫 실행 화면으로 열린다',
  steps: ['앱 데이터 초기화(pm clear)', '앱 실행'],
};

export async function generateQaDoc(input: GenerateInput): Promise<GenerateResult> {
  const { bundle, prev, llm, meta } = input;
  const model = input.model ?? MODELS.generator;
  const specRoot = input.specRoot ?? 'docs/specs';
  const fileOf = (spec: string) => `${specRoot}/${spec}/spec.md`;
  const warnings = {
    list: [] as string[],
    push(...texts: string[]) {
      for (const text of texts) {
        this.list.push(text);
        input.onProgress?.({ kind: 'warning', text });
      }
      return this.list.length;
    },
  };
  const plan = matchVersions(bundle, prev);
  const targets = plan.rows.filter((r) => r.decision !== 'same');
  input.onProgress?.({ kind: 'match', specs: planSpecsOf(bundle, plan.rows), removed: plan.removed.length });

  // ------------------------------------------------------------ 1. 스펙 계획 (스펙 순서대로 — 앞 스펙이 만든 준비 플로우를 뒤 스펙이 재사용)
  const flows = [...input.prepFlows];
  const added: PrepFlow[] = [];
  if (!flows.some((f) => f.id === CLEAN_FLOW.id)) {
    flows.unshift(CLEAN_FLOW);
    added.push(CLEAN_FLOW);
  }
  const startOf = new Map<string, { prepFlowIds: string[]; cleanState: boolean }>();
  const newSuggestions: (Omit<SpecSuggestion, 'id'> & { spec: string })[] = [];
  const replannedSpecs = new Set<string>();
  // 버튼 이름의 근거: 스펙 본문 + 사람이 검토한 기존 준비 플로우
  const reviewedFlows = input.prepFlows.flatMap((f) => [f.check, ...f.steps]);
  const unmark = (texts: string[], sources: string[], where: string) => {
    const known = nameChecker(sources);
    return texts.map((t) => {
      const r = unmarkUnknownNames(t, known);
      if (r.guessed.length) warnings.push(`${where}: 스펙에 없는 버튼 이름 ${r.guessed.map((n) => `[${n}]`).join(' ')}을 추정으로 표시했다`);
      return r.text;
    });
  };

  const planSpecs = bundle.specs.filter((s) => targets.some((r) => r.spec === s));
  for (const [index, spec] of planSpecs.entries()) {
    const rows = targets.filter((r) => r.spec === spec);
    replannedSpecs.add(spec.name);
    input.onProgress?.({ kind: 'plan', spec: spec.name, targets: rows.length, index, total: planSpecs.length });
    const out = await ask(llm, model, PLAN_SYSTEM, SpecPlanOutput, planPrompt(spec, rows, flows), (o) =>
      missingRows(rows, o.rows),
    );
    const addedBefore = added.length;
    for (const f of out.prep_flows) {
      if (flows.some((x) => x.id === f.id)) {
        warnings.push(`${spec.name}: 준비 플로우 ID ${f.id}가 이미 있어 기존 것을 쓴다`);
        continue;
      }
      const steps = unmark(f.steps, [...specSources(spec), ...reviewedFlows], `${spec.name}/${f.id}`);
      const flow: PrepFlow = { id: f.id, name: f.name, kind: f.kind, check: f.check, steps };
      flows.push(flow);
      added.push(flow);
    }
    for (const r of out.rows) {
      const unknown = r.prep_flow_ids.filter((id) => !flows.some((f) => f.id === id));
      if (unknown.length) warnings.push(`${spec.name}/${r.row_id}: 없는 준비 플로우 ${unknown.join(', ')}를 뺐다`);
      const ids = r.prep_flow_ids.filter((id) => !unknown.includes(id));
      // 초기화는 다른 준비보다 먼저 한다
      const clean = ids.includes(CLEAN_FLOW.id);
      startOf.set(sourceId(spec.name, r.row_id), {
        prepFlowIds: clean ? [CLEAN_FLOW.id, ...ids.filter((id) => id !== CLEAN_FLOW.id)] : ids,
        cleanState: clean,
      });
    }
    for (const s of out.suggestions) {
      const req = requirementOf(spec, s.requirement_id);
      if (!req) {
        warnings.push(`${spec.name}: 보강 제안의 요구사항 ${s.requirement_id}가 없어 뺐다`);
        continue;
      }
      newSuggestions.push({ spec: spec.name, requirementId: req, technique: s.technique, text: s.text });
    }
    input.onProgress?.({
      kind: 'planned',
      spec: spec.name,
      prepFlows: added.slice(addedBefore),
      suggestions: newSuggestions.filter((s) => s.spec === spec.name).length,
      index,
      total: planSpecs.length,
    });
  }

  // ------------------------------------------------------------ 2. 케이스 변환 (행 묶음, 동시에 몇 개씩)
  const batches: RowPlan[][] = [];
  const size = input.batchSize ?? 8;
  for (const spec of bundle.specs) {
    const rows = targets.filter((r) => r.spec === spec);
    for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  }
  const generated = new Map<string, GenCase>();
  let done = 0;
  await pool(batches, input.concurrency ?? 3, async (batch) => {
    const spec = batch[0]!.spec.name;
    input.onProgress?.({ kind: 'batch_start', spec, sources: batch.map((r) => r.sourceId) });
    const out = await ask(
      llm,
      model,
      CASE_SYSTEM,
      CaseBatchOutput,
      casePrompt(batch, flows, startOf, prev, input.prevBundle),
      (o) => missingRows(batch, o.cases),
    );
    for (const c of out.cases) generated.set(sourceId(spec, c.row_id), c);
    done += batch.length;
    input.onProgress?.({
      kind: 'batch',
      spec,
      rows: batch.map((r) => r.row.id),
      sources: batch.map((r) => r.sourceId),
      drafts: batch.flatMap((r) => {
        const g = generated.get(r.sourceId);
        if (!g) return [];
        const body = bodyOf(g, r.tcId, startOf.get(r.sourceId) ?? { prepFlowIds: [], cleanState: false });
        return [{ spec, rowId: r.row.id, tcId: r.tcId, body, questions: g.questions.map((q) => q.text) }];
      }),
      done,
      total: targets.length,
    });
  });

  // ------------------------------------------------------------ 3. 조립
  const prevQuestions = prev?.questions ?? [];
  const keptTcIds = new Set(plan.rows.filter((r) => r.previous).map((r) => r.tcId));
  const questions: SpecQuestion[] = prevQuestions.filter((q) => q.caseIds.some((id) => keptTcIds.has(id)));
  let qn = maxNum(
    prevQuestions.map((q) => q.id),
    'Q',
  );

  const skipped: GenerateResult['skipped'] = [];
  const cases: TestCase[] = [];
  for (const r of plan.rows) {
    const where = {
      sourceHash: r.sourceHash,
      requirementIds: r.row.frs.map((f) => `${r.spec.name}/${f}`),
      feature: r.spec.title,
      subFeature: r.row.flow,
      sourceRef: {
        spec: r.spec.name,
        file: fileOf(r.spec.name),
        headingPath: r.row.headingPath,
        lineStart: r.row.line,
        lineEnd: r.row.line,
      },
    };
    if (r.decision === 'same') {
      // 사람의 수정·승인을 그대로 둔다. 위치(줄·헤딩)만 새 스냅샷 기준으로 바꾼다
      const { previous: _, ...old } = r.previous!;
      cases.push({ ...old, ...where, change: 'same' });
      continue;
    }
    const generatedCase = generated.get(r.sourceId)!;
    const prevSteps = r.previous ? r.previous.steps.map((x) => x.text) : [];
    const g: GenCase = {
      ...generatedCase,
      steps: generatedCase.steps.map((x, i) => ({
        ...x,
        text: unmark([x.text], [...specSources(r.spec), ...reviewedFlows, ...prevSteps], `${r.tcId} 단계 ${i + 1}`)[0]!,
      })),
    };
    if (g.platform === 'ios') {
      skipped.push({ sourceId: r.sourceId, reason: 'iOS 전용 (MVP는 공통·Android 케이스만 만든다)' });
      continue;
    }
    const start = startOf.get(r.sourceId) ?? { prepFlowIds: [], cleanState: false };
    const body = bodyOf(g, r.tcId, start);
    const contentHash = hash(body);
    const asked = g.questions.map((q) => {
      const requirementId = requirementOf(r.spec, q.requirement_id) ?? where.requirementIds[0] ?? r.sourceId;
      const question: SpecQuestion = {
        id: `Q-${++qn}`,
        requirementId,
        caseIds: [r.tcId],
        text: q.text,
        assignee: '',
        status: 'open',
        comments: [],
      };
      return question;
    });
    questions.push(...asked);
    const questionIds = [
      ...questions.filter((q) => !asked.includes(q) && q.caseIds.includes(r.tcId)).map((q) => q.id),
      ...asked.map((q) => q.id),
    ];
    const held = questions.some((q) => q.status === 'open' && questionIds.includes(q.id));
    cases.push({
      ...body,
      tcId: r.tcId,
      sourceId: r.sourceId,
      ...where,
      change: r.decision,
      ...(r.previous ? { previous: CaseBody.parse(r.previous) } : {}),
      contentHash,
      rev: r.previous ? r.previous.rev + 1 : 1,
      approval: { status: held ? 'held' : 'pending' },
      questionIds,
      updatedBy: GENERATOR,
      updatedAt: meta.createdAt,
    });
  }
  for (const c of plan.removed) {
    const { previous: _, ...old } = c;
    cases.push({ ...old, change: 'removed' });
  }

  // 보강 제안: 다시 계획한 스펙은 새 제안, 나머지 스펙은 이전 제안을 그대로
  let sn = maxNum(prev?.suggestions.map((s) => s.id) ?? [], 'S');
  const suggestions: SpecSuggestion[] = [
    ...(prev?.suggestions ?? []).filter((s) => {
      const spec = s.requirementId.split('/')[0]!;
      return !replannedSpecs.has(spec) && bundle.specs.some((x) => x.name === spec);
    }),
    ...newSuggestions.map(({ spec: _, ...s }) => ({ id: `S-${++sn}`, ...s })),
  ];

  const doc: QADocument = {
    id: meta.id,
    projectId: meta.projectId,
    appVersion: meta.appVersion,
    specBundleId: meta.specBundleId,
    ...((meta.prevDocId ?? prev?.id) ? { prevDocId: meta.prevDocId ?? prev!.id } : {}),
    createdAt: meta.createdAt,
    specs: bundle.specs.map((s) => ({ name: s.name, feature: s.title, file: fileOf(s.name) })),
    requirements: bundle.specs.flatMap((s) => requirementsOf(s, fileOf(s.name))),
    cases,
    questions,
    suggestions,
  };
  return { doc, prepFlows: added, skipped, warnings: warnings.list };
}

/** 진행 화면용 생성 계획: 스펙마다 행과 매칭 결과. 변경 행에는 비교할 이전 케이스를 붙인다 */
function planSpecsOf(bundle: SpecBundle, rows: RowPlan[]): QaDocJobSpec[] {
  return bundle.specs.map((spec, order) => ({
    spec: spec.name,
    title: spec.title,
    order,
    rows: rows
      .filter((r) => r.spec === spec)
      .map((r) => ({
        id: r.row.id,
        tcId: r.tcId,
        kind: r.row.kind,
        flow: r.row.flow,
        title: r.row.title,
        given: r.row.given,
        when: r.row.when,
        then: r.row.then,
        requirementIds: r.row.frs.map((f) => `${spec.name}/${f}`),
        change: r.decision,
        ...(r.decision === 'changed' && r.previous ? { previous: CaseBody.parse(r.previous) } : {}),
      })),
  }));
}

// ---------------------------------------------------------------- 조립 도우미

function bodyOf(g: GenCase, tcId: string, start: { prepFlowIds: string[]; cleanState: boolean }): CaseBody {
  return CaseBody.parse({
    title: g.title,
    preconditions: g.preconditions,
    prepFlowIds: start.prepFlowIds,
    cleanState: start.cleanState,
    ...(g.account_role ? { accountRole: g.account_role } : {}),
    ...(g.data ? { data: g.data } : {}),
    steps: g.steps,
    verificationPoints: g.points.map((p, i) => ({
      id: `${tcId}-P${i + 1}`,
      target: p.target,
      compare: p.compare,
      // 개수 포인트가 숫자만 오면 문장으로 바꾼다
      expected: /^\d+$/.test(p.expected.trim()) ? `${p.target} ${p.expected.trim()}개` : p.expected,
      method: p.method,
    })),
    priority: g.priority,
    type: g.type,
    platform: g.platform,
    mode: g.mode,
  });
}

function requirementsOf(spec: SpecDoc, file: string): Requirement[] {
  return spec.requirements.map((r) => ({
    id: `${spec.name}/${r.id}`,
    spec: spec.name,
    text: r.text,
    sourceRef: { spec: spec.name, file, headingPath: r.headingPath, lineStart: r.line, lineEnd: r.line },
  }));
}

/** `FR-011` 또는 `<스펙>/FR-011` → 스펙에 있으면 `<스펙>/FR-011` */
function requirementOf(spec: SpecDoc, id: string): string | undefined {
  const bare = id.split('/').at(-1)!.trim();
  return spec.requirements.some((r) => r.id === bare) ? `${spec.name}/${bare}` : undefined;
}

const maxNum = (ids: string[], prefix: string) =>
  ids.reduce((m, id) => Math.max(m, Number(new RegExp(`^${prefix}-(\\d+)$`).exec(id)?.[1] ?? 0)), 0);

function missingRows(rows: RowPlan[], out: { row_id: string }[]): string[] {
  const got = new Set(out.map((o) => o.row_id));
  return rows.filter((r) => !got.has(r.row.id)).map((r) => r.row.id);
}

/** 스펙에 쓰인 글 (버튼 이름의 근거) */
function specSources(spec: SpecDoc): string[] {
  return [
    ...spec.requirements.map((r) => r.text),
    ...spec.rows.flatMap((r) => [r.title, r.given, r.when, r.then]),
  ];
}

// ---------------------------------------------------------------- 프롬프트 본문

function rowText(row: SpecRow, spec: SpecDoc): string {
  const reqs = row.frs.map((f) => `  - ${f}: ${spec.requirements.find((r) => r.id === f)?.text ?? '(문서에 없음)'}`);
  return [
    `[${row.id}] ${row.title}  (${row.kind === 'TS' ? '테스트 시나리오' : '엣지 케이스'} · 유저 플로우 "${row.flow}")`,
    ...(row.kind === 'TS' ? [`Given: ${row.given || '—'}`, `When: ${row.when}`, `Then: ${row.then}`] : []),
    ...(row.kind === 'EC' ? [`상황: ${row.when}`, `처리: ${row.then}`] : []),
    `관련 요구사항:`,
    ...reqs,
  ].join('\n');
}

const flowText = (f: PrepFlow) =>
  `- ${f.id} · ${f.name} (${f.kind})\n  확인: ${f.check}\n  스텝: ${f.steps.join(' → ') || '—'}`;

function planPrompt(spec: SpecDoc, targets: RowPlan[], flows: PrepFlow[]): string {
  const ids = new Set(targets.map((r) => r.row.id));
  return [
    `# 스펙: ${spec.name} — ${spec.title}`,
    '',
    '## 요구사항',
    ...spec.requirements.map((r) => `- ${r.id}: ${r.text}`),
    '',
    '## 기존 준비 플로우',
    flows.length ? flows.map(flowText).join('\n') : '(없음)',
    '',
    '## 테스트 시나리오·엣지 케이스 (전체)',
    ...spec.rows.map((r) =>
      r.kind === 'TS'
        ? `- ${r.id} [${r.flow}] ${r.title} | Given: ${r.given || '—'} | When: ${r.when} | Then: ${r.then} | ${r.frs.join(', ')}`
        : `- ${r.id} [${r.flow}] ${r.title} | 처리: ${r.then} | ${r.frs.join(', ')}`,
    ),
    '',
    `## 대상 행 (${ids.size}개 — rows에 모두 낸다)`,
    [...ids].join(', '),
  ].join('\n');
}

function casePrompt(
  batch: RowPlan[],
  flows: PrepFlow[],
  startOf: Map<string, { prepFlowIds: string[]; cleanState: boolean }>,
  prev: QADocument | undefined,
  prevBundle: SpecBundle | undefined,
): string {
  const spec = batch[0]!.spec;
  const blocks = batch.map((r) => {
    const start = startOf.get(r.sourceId);
    const used = (start?.prepFlowIds ?? []).map((id) => flows.find((f) => f.id === id)).filter(Boolean) as PrepFlow[];
    const lines = [
      rowText(r.row, spec),
      `시작 상태: ${start?.cleanState ? '앱 데이터 초기화 후 ' : ''}${used.length ? used.map((f) => `${f.id}(${f.name})`).join(' → ') : '앱 실행 직후'}`,
    ];
    if (r.previous) {
      const oldRow = prevBundle?.specs.find((s) => s.name === spec.name)?.rows.find((x) => x.id === r.row.id);
      const oldSpec = prevBundle?.specs.find((s) => s.name === spec.name);
      if (oldRow && oldSpec) lines.push(`이전 버전 행:\n${rowText(oldRow, oldSpec).replace(/^/gm, '  ')}`);
      const { title, preconditions, data, steps, verificationPoints, mode, priority, type } = r.previous;
      lines.push(
        `이전 케이스 (사람이 고쳤을 수 있음):\n${JSON.stringify({ title, preconditions, data, steps, points: verificationPoints.map(({ id: _, ...p }) => p), mode, priority, type })}`,
      );
      const qs = (prev?.questions ?? []).filter((q) => q.caseIds.includes(r.tcId) && q.status !== 'open');
      if (qs.length)
        lines.push(
          `답이 달린 질문:\n${qs.map((q) => `- ${q.text}\n  → ${q.status === 'proceed' ? '현 스펙대로 진행' : q.answer}`).join('\n')}`,
        );
    }
    return lines.join('\n');
  });
  const usedFlows = flows.filter((f) => batch.some((r) => startOf.get(r.sourceId)?.prepFlowIds.includes(f.id)));
  return [
    `# 스펙: ${spec.name} — ${spec.title}`,
    '',
    '## 이 묶음이 쓰는 준비 플로우',
    usedFlows.length ? usedFlows.map(flowText).join('\n') : '(없음)',
    '',
    `## 행 ${batch.length}개`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

// ---------------------------------------------------------------- 호출

/** 구조화 출력 호출. 형식이 틀리거나 행이 빠지면 한 번 다시 묻는다. 플랜 한도·로그인 오류는 그대로 던진다 */
async function ask<S extends typeof SpecPlanOutput | typeof CaseBatchOutput>(
  llm: LlmClient,
  model: string,
  system: string,
  schema: S,
  prompt: string,
  missing: (out: ReturnType<S['parse']>) => string[],
): Promise<ReturnType<S['parse']>> {
  let note = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await llm.create(
        {
          model,
          max_tokens: 32000,
          output_config: { effort: 'medium', format: outputFormat(schema) },
          system: cachedSystem(system),
          messages: [{ role: 'user', content: prompt + note }],
        },
        { role: 'generator' },
      );
      const out = parseOutput(res, schema) as ReturnType<S['parse']>;
      const miss = missing(out);
      if (!miss.length) return out;
      if (attempt) throw new LlmOutputError(`응답에 없는 행: ${miss.join(', ')}`);
      note = `\n\n(이전 응답에 ${miss.join(', ')}가 빠졌다. 모든 행을 낸다.)`;
    } catch (e) {
      if (attempt || !(e instanceof LlmOutputError)) throw e;
      note = `\n\n(이전 응답 형식 오류: ${e.message}. 스키마대로 다시 낸다.)`;
    }
  }
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}
