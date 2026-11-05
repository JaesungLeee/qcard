import { cachedSystem, LlmOutputError, MODELS, outputFormat, parseOutput, type LlmClient } from '@qcard/llm';
import {
  issueValueEmpty,
  SEVERITY_LABEL,
  type Defect,
  type IssueField,
  type IssueTemplate,
  type IssueValues,
  type TestCase,
} from '@qcard/shared';
import { REPORTER_SYSTEM, ReporterOutput } from './prompts';

/*
 * 이슈 초안 (docs/product/issues.md#초안): 결함·케이스·환경 텍스트 + 고른 템플릿 → 제목과 칸별 값.
 * 스크린샷·화면 구조는 넘기지 않는다. 받은 정보로 채울 수 없는 칸은 비워 두고 `empty`로 알린다.
 */

/** Claude에 넘기는 것 (이것뿐이다) */
export type IssueFacts = {
  defect: Pick<Defect, 'id' | 'title' | 'severity' | 'repro' | 'expected' | 'actual'>;
  case?: Pick<TestCase, 'tcId' | 'sourceId' | 'requirementIds' | 'title' | 'steps' | 'verificationPoints'>;
  device: { label: string; osBuild?: string };
  app: { version: string; buildNumber?: number };
  cycleName: string;
};

export type IssueDraft = {
  /** 템플릿 접두어를 붙인 제목 */
  title: string;
  values: IssueValues;
  /** 비운 칸 id (사람이 채울 칸) */
  empty: string[];
};

export async function draftIssue(input: {
  facts: IssueFacts;
  template: IssueTemplate;
  llm: LlmClient;
  model?: string;
}): Promise<IssueDraft> {
  const { template } = input;
  const out = await ask(input.llm, input.model ?? MODELS.reporter, draftPrompt(input.facts, template));
  const byId = new Map(out.fields.map((f) => [f.id, f]));
  const values: IssueValues = {};
  for (const f of template.fields) {
    const v = valueFor(f, byId.get(f.id));
    if (v !== undefined) values[f.id] = v;
  }
  const empty = template.fields.filter((f) => issueValueEmpty(f, values[f.id])).map((f) => f.id);
  return { title: titled(template.title, out.title.trim() || input.facts.defect.title), values, empty };
}

/** 모델이 낸 값을 칸 종류에 맞게 거른다: 선택지에 없는 값은 버린다 */
function valueFor(f: IssueField, raw: ReporterOutput['fields'][number] | undefined): string | string[] | undefined {
  if (!raw) return undefined;
  if (f.type === 'dropdown') {
    const picked = raw.picked.filter((p) => f.options.includes(p));
    return picked.length ? (f.multiple ? picked : picked.slice(0, 1)) : undefined;
  }
  if (f.type === 'checkboxes') {
    const labels = f.options.map((o) => o.label);
    const picked = raw.picked.filter((p) => labels.includes(p));
    return picked.length ? picked : undefined;
  }
  const text = raw.value.trim();
  return text || undefined;
}

/** 템플릿 제목 접두어(`[Bug] `)를 한 번만 붙인다 */
function titled(prefix: string, title: string): string {
  if (!prefix.trim() || title.startsWith(prefix.trim())) return title;
  return `${prefix}${title}`;
}

function fieldText(f: IssueField): string {
  switch (f.type) {
    case 'section':
      return [
        `- id: ${f.id} · Markdown 칸 "${f.heading || '(제목 없는 머리말)'}"`,
        f.hint && `  원문:\n${indent(f.hint)}`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'dropdown':
      return `- id: ${f.id} · 드롭다운${f.multiple ? '(여러 개)' : ''} "${f.label}"${desc(f.description)}\n  선택지: ${JSON.stringify(f.options)}`;
    case 'checkboxes':
      return `- id: ${f.id} · 체크박스 "${f.label}"${desc(f.description)}\n  항목: ${JSON.stringify(f.options.map((o) => o.label))}`;
    default:
      return `- id: ${f.id} · ${f.type === 'input' ? '한 줄' : '여러 줄'} "${f.label}"${desc(f.description)}${
        f.placeholder ? `\n  예시: ${f.placeholder}` : ''
      }`;
  }
}

const desc = (d?: string) => (d ? ` — ${d.trim()}` : '');
const indent = (t: string) =>
  t
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');

export function draftPrompt(facts: IssueFacts, template: IssueTemplate): string {
  const d = facts.defect;
  const c = facts.case;
  return [
    `# 결함 ${d.id}: ${d.title}`,
    `- 심각도: ${SEVERITY_LABEL[d.severity]}`,
    '- 재현 절차:',
    ...d.repro.map((s, i) => `  ${i + 1}. ${s}`),
    `- 기대 결과: ${d.expected}`,
    `- 실제 결과: ${d.actual}`,
    '',
    '# 관련 케이스',
    c
      ? [
          `- TC ID: ${c.tcId} · 출처: ${c.sourceId} · 요구사항: ${c.requirementIds.join(', ') || '(없음)'}`,
          `- 제목: ${c.title}`,
          '- 절차:',
          ...c.steps.map((s, i) => `  ${i + 1}. ${s.text}`),
          '- 기대 결과:',
          ...c.verificationPoints.map((p) => `  - ${p.target}: ${p.expected}`),
        ].join('\n')
      : '(케이스 정보 없음)',
    '',
    '# 환경',
    `- 앱 버전: ${facts.app.version}${facts.app.buildNumber !== undefined ? ` (빌드 ${facts.app.buildNumber})` : ''}`,
    `- 디바이스 / OS: ${facts.device.label}${facts.device.osBuild ? ` · ${facts.device.osBuild}` : ''}`,
    `- QA 사이클: ${facts.cycleName}`,
    '',
    `# 이슈 템플릿: ${template.name}${template.about ? ` — ${template.about}` : ''}`,
    ...template.fields.map(fieldText),
  ].join('\n');
}

/** 구조화 출력 호출. 형식이 틀리면 한 번 다시 묻는다. 플랜 한도·로그인 오류는 그대로 던진다 */
async function ask(llm: LlmClient, model: string, prompt: string): Promise<ReporterOutput> {
  let note = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await llm.create(
        {
          model,
          max_tokens: 8000,
          output_config: { effort: 'low', format: outputFormat(ReporterOutput) },
          system: cachedSystem(REPORTER_SYSTEM),
          messages: [{ role: 'user', content: prompt + note }],
        },
        { role: 'reporter' },
      );
      return parseOutput(res, ReporterOutput);
    } catch (e) {
      if (attempt || !(e instanceof LlmOutputError)) throw e;
      note = `\n\n(이전 응답 형식 오류: ${e.message}. 스키마대로 다시 낸다.)`;
    }
  }
}
