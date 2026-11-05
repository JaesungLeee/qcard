import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/*
 * GitHub 이슈 템플릿 해석·본문 조립 (docs/product/issues.md#템플릿-해석).
 * GitHub는 API로 만드는 이슈에 템플릿을 적용하지 않으므로, qcard가 템플릿을 필드로 풀고 GitHub 웹과 같은 본문을 만든다.
 *   - Markdown(.md): frontmatter + 본문. 본문은 제목 줄(#)마다 한 칸(section)으로 나눈다 — 초안을 칸 단위로 채우고 비운 칸을 알리려고
 *   - 이슈 폼(.yml·.yaml): body의 입력 요소가 칸이다. markdown 요소는 본문에 넣지 않는다
 * Functions가 저장소에서 읽어 해석하고, 웹·호스트는 해석한 템플릿(`IssueTemplate`)만 받는다.
 */

const FieldBase = {
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean(),
};

export const IssueField = z.discriminatedUnion('type', [
  /** Markdown 템플릿의 한 칸: 제목 줄(없으면 첫 제목 앞 머리말) + 그 아래 원문(hint). 비우면 원문을 그대로 둔다 */
  z.object({ type: z.literal('section'), id: z.string(), heading: z.string(), hint: z.string() }),
  z.object({
    type: z.literal('input'),
    ...FieldBase,
    placeholder: z.string().optional(),
    value: z.string().optional(),
  }),
  z.object({
    type: z.literal('textarea'),
    ...FieldBase,
    placeholder: z.string().optional(),
    value: z.string().optional(),
    /** 값을 이 언어의 코드 블록으로 감싼다 */
    render: z.string().optional(),
  }),
  z.object({
    type: z.literal('dropdown'),
    ...FieldBase,
    options: z.array(z.string()),
    multiple: z.boolean(),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal('checkboxes'),
    ...FieldBase,
    options: z.array(z.object({ label: z.string(), required: z.boolean() })),
  }),
]);
export type IssueField = z.infer<typeof IssueField>;

export const IssueTemplate = z.object({
  /** 저장소 안 경로. qcard 기본 템플릿은 빈 문자열 */
  file: z.string(),
  kind: z.enum(['markdown', 'form']),
  name: z.string(),
  /** md의 `about`, 이슈 폼의 `description` */
  about: z.string(),
  /** 제목 접두어 */
  title: z.string(),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  fields: z.array(IssueField),
});
export type IssueTemplate = z.infer<typeof IssueTemplate>;

/** 저장소 템플릿 목록의 한 줄. 해석할 수 없으면 `error`가 있고 고를 수 없다 */
export type IssueTemplateEntry = { file: string; template: IssueTemplate } | { file: string; error: string };

/** 필드 값: 텍스트는 문자열, 드롭다운·체크박스는 고른 항목 */
export type IssueValues = Record<string, string | string[]>;

export const ISSUE_TEMPLATE_DIR = '.github/ISSUE_TEMPLATE/';

/** 템플릿으로 읽을 파일인가: 폴더 바로 아래 `*.md`·`*.yml`·`*.yaml`, `config.yml` 제외 */
export function isIssueTemplateFile(path: string): boolean {
  if (!path.startsWith(ISSUE_TEMPLATE_DIR)) return false;
  const name = path.slice(ISSUE_TEMPLATE_DIR.length);
  if (name.includes('/') || /^config\.ya?ml$/i.test(name)) return false;
  return /\.(md|ya?ml)$/i.test(name);
}

class TemplateError extends Error {}
const fail = (m: string): never => {
  throw new TemplateError(m);
};

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
/** `labels: bug, ui` 와 `labels: [bug, ui]` 둘 다 쓴다 */
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(str) : str(v).split(',')).map((s) => s.trim()).filter(Boolean);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function yaml(text: string): unknown {
  try {
    return parseYaml(text);
  } catch (e) {
    return fail(`YAML 오류: ${(e as Error).message.split('\n')[0]}`);
  }
}

/** 템플릿 파일 하나를 해석한다. 해석할 수 없으면 이유를 담아 돌려준다 */
export function parseIssueTemplate(file: string, content: string): IssueTemplateEntry {
  try {
    const template = /\.md$/i.test(file) ? parseMarkdown(file, content) : parseForm(file, content);
    return { file, template };
  } catch (e) {
    if (e instanceof TemplateError) return { file, error: e.message };
    throw e;
  }
}

function parseMarkdown(file: string, content: string): IssueTemplate {
  const text = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) fail('frontmatter(name·about)가 없습니다.');
  const meta = record(yaml(m![1]!));
  const name = str(meta.name).trim();
  if (!name) fail('frontmatter에 name이 없습니다.');
  return {
    file,
    kind: 'markdown',
    name,
    about: str(meta.about).trim(),
    title: str(meta.title),
    labels: list(meta.labels),
    assignees: list(meta.assignees),
    fields: markdownSections(text.slice(m![0].length)),
  };
}

/** 본문을 제목 줄마다 나눈다. 코드 블록 안의 `#`은 제목이 아니다 */
function markdownSections(body: string): IssueField[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#{1,6}\s/.test(line)) sections.push({ heading: line.trimEnd(), lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  return sections
    .map((s) => ({ heading: s.heading, hint: s.lines.join('\n').trim() }))
    .filter((s) => s.heading || s.hint)
    .map((s, i) => ({ type: 'section' as const, id: `s${i}`, ...s }));
}

function parseForm(file: string, content: string): IssueTemplate {
  const doc = record(yaml(content));
  const name = str(doc.name).trim();
  if (!name) fail('name이 없습니다.');
  if (!Array.isArray(doc.body) || doc.body.length === 0) fail('body가 없습니다.');
  const fields: IssueField[] = [];
  (doc.body as unknown[]).forEach((raw, i) => {
    const el = record(raw);
    const type = str(el.type);
    if (type === 'markdown') return;
    const attrs = record(el.attributes);
    const label = str(attrs.label).trim();
    if (!label) fail(`body ${i + 1}번째 요소에 label이 없습니다.`);
    const base = {
      id: str(el.id) || `f${i}`,
      label,
      ...(str(attrs.description) ? { description: str(attrs.description) } : {}),
      required: record(el.validations).required === true,
    };
    const opt = (k: string) => (str(attrs[k]) ? { [k]: str(attrs[k]) } : {});
    switch (type) {
      case 'input':
        fields.push({ type, ...base, ...opt('placeholder'), ...opt('value') });
        break;
      case 'textarea':
        fields.push({ type, ...base, ...opt('placeholder'), ...opt('value'), ...opt('render') });
        break;
      case 'dropdown': {
        const options = list(attrs.options);
        if (options.length === 0) fail(`${label}: 선택지가 없습니다.`);
        const def = typeof attrs.default === 'number' && options[attrs.default] ? { default: attrs.default } : {};
        fields.push({ type, ...base, options, multiple: attrs.multiple === true, ...def });
        break;
      }
      case 'checkboxes': {
        const options = (Array.isArray(attrs.options) ? attrs.options : []).map((o) => ({
          label: str(record(o).label).trim(),
          required: record(o).required === true,
        }));
        if (options.length === 0 || options.some((o) => !o.label)) fail(`${label}: 체크박스 항목이 없습니다.`);
        fields.push({ type, ...base, options });
        break;
      }
      default:
        fail(`알 수 없는 요소 type: ${type || '(없음)'}`);
    }
  });
  if (new Set(fields.map((f) => f.id)).size !== fields.length) fail('같은 id를 가진 요소가 있습니다.');
  return {
    file,
    kind: 'form',
    name,
    about: str(doc.description).trim(),
    title: str(doc.title),
    labels: list(doc.labels),
    assignees: list(doc.assignees),
    fields,
  };
}

/** 초안 없이 작성할 때의 값: 템플릿에 적힌 기본값 */
export function initialIssueValues(t: IssueTemplate): IssueValues {
  const values: IssueValues = {};
  for (const f of t.fields) {
    if ((f.type === 'input' || f.type === 'textarea') && f.value) values[f.id] = f.value;
    if (f.type === 'dropdown' && f.default !== undefined) values[f.id] = [f.options[f.default]!];
  }
  return values;
}

const textOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? '')).trim();
const pickedOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/** 값이 비었는가 (드롭다운·체크박스는 고른 것이 없음) */
export function issueValueEmpty(f: IssueField, v: string | string[] | undefined): boolean {
  if (f.type === 'checkboxes' || f.type === 'dropdown') return pickedOf(v).length === 0;
  return textOf(v) === '';
}

/**
 * 템플릿 + 값 → 이슈 본문.
 * Markdown은 칸마다 제목 줄 + 값(비면 템플릿 원문), 이슈 폼은 GitHub 웹과 같은 모양(`### 라벨`, 빈 값 `_No response_`)
 */
export function renderIssueBody(t: IssueTemplate, values: IssueValues): string {
  const parts = t.fields.map((f) => {
    const v = values[f.id];
    switch (f.type) {
      case 'section': {
        const text = textOf(v) || f.hint;
        return [f.heading, text].filter(Boolean).join('\n\n');
      }
      case 'checkboxes': {
        const picked = new Set(pickedOf(v));
        return `### ${f.label}\n\n${f.options.map((o) => `- [${picked.has(o.label) ? 'x' : ' '}] ${o.label}`).join('\n')}`;
      }
      case 'dropdown': {
        const picked = pickedOf(v).filter((o) => f.options.includes(o));
        return `### ${f.label}\n\n${picked.join(', ') || '_No response_'}`;
      }
      default: {
        const text = textOf(v);
        const shown = !text ? '_No response_' : f.type === 'textarea' && f.render ? fenced(f.render, text) : text;
        return `### ${f.label}\n\n${shown}`;
      }
    }
  });
  return parts.filter(Boolean).join('\n\n') + '\n';
}

const fenced = (lang: string, text: string) => {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}${lang}\n${text}\n${ticks}`;
};

/** 비어 있는 필수 필드의 라벨. GitHub API는 필수를 검사하지 않으므로 표시만 하고 발행은 막지 않는다 */
export function missingRequired(t: IssueTemplate, values: IssueValues): string[] {
  return t.fields.flatMap((f) => {
    if (f.type === 'section') return [];
    if (f.type === 'checkboxes') {
      const picked = new Set(pickedOf(values[f.id]));
      return f.options.some((o) => o.required && !picked.has(o.label)) ? [f.label] : [];
    }
    return f.required && issueValueEmpty(f, values[f.id]) ? [f.label] : [];
  });
}

/** 필드 표시 이름 (Markdown 칸은 제목 줄에서 `#`을 뗀 것, 머리말은 "머리말") */
export const issueFieldLabel = (f: IssueField) =>
  f.type === 'section' ? f.heading.replace(/^#+\s*/, '') || '머리말' : f.label;

/** qcard 기본 템플릿: 결함 필드로 채울 수 있는 항목만 둔다. 저장소에 `bug` 라벨이 있으면 붙는다 */
export const DEFAULT_ISSUE_TEMPLATE: IssueTemplate = (() => {
  const entry = parseIssueTemplate(
    'qcard-default.md',
    `---
name: qcard 기본 템플릿
about: qcard 결함 필드로 채우는 기본 버그 리포트
labels: bug
---
## 요약

## 환경

- 앱 버전:
- 디바이스 / OS:
- QA 사이클:

## 재현 절차

1.

## 기대 결과

## 실제 결과

## 관련 케이스

- TC ID / 출처 / 요구사항:

## 심각도
`,
  );
  if ('error' in entry) throw new Error(entry.error);
  return { ...entry.template, file: '' };
})();
