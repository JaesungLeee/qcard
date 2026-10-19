/**
 * tokens/tokens.json(디자인 시스템 "Montage for qcard"에서 가져온 원본) →
 *   src/generated/tokens.css  — `--qc-*` CSS 변수(라이트: :root, 다크: html[data-theme='dark']), 타이포 클래스
 *   src/generated/tokens.ts   — 토큰 이름 타입, 테마별 해석된 색 값
 *
 * 생성 파일은 직접 고치지 않는다. `pnpm tokens`로 다시 만든다. (`--check`: 최신인지 확인만)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Entry = { name: string; value: string | Record<string, string>; usage?: string };
type TypeStyle = { name: string; fontSize: string; lineHeight: string; letterSpacing?: string; fontWeight: string };
type Tokens = {
  color: { themes: { id: string }[]; tokens: Entry[] };
  type: { families: Record<string, string>; groups: { name: string; family: string; styles: TypeStyle[] }[] };
  spacing: { tokens: Entry[] };
  radius: { tokens: Entry[] };
  shadow: { tokens: Entry[] };
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens/tokens.json'), 'utf8')) as Tokens;
const themes = tokens.color.themes.map((t) => t.id);
const firstTheme = themes[0]!;

export const varName = (name: string) => `--qc-${name.replace(/\./g, '_')}`;

const byName = new Map(tokens.color.tokens.map((t) => [t.name, t]));

function rawColor(entry: Entry, theme: string): string {
  if (typeof entry.value === 'string') return entry.value;
  return entry.value[theme] ?? entry.value[firstTheme]!;
}

function resolveColor(name: string, theme: string, seen: string[] = []): string {
  const entry = byName.get(name);
  if (!entry) throw new Error(`알 수 없는 색 토큰: ${name} (${seen.join(' → ')})`);
  if (seen.includes(name)) throw new Error(`순환 별칭: ${[...seen, name].join(' → ')}`);
  const value = rawColor(entry, theme);
  const alias = /^\{(.+)\}$/.exec(value);
  return alias ? resolveColor(alias[1]!, theme, [...seen, name]) : value;
}

const resolved: Record<string, Record<string, string>> = {};
for (const theme of themes) {
  resolved[theme] = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, resolveColor(t.name, theme)]));
}

const plain = (entries: Entry[]) => entries.map((t) => `  ${varName(t.name)}: ${t.value as string};`);
const fontWeights = (w: string) => w.split(' ').map(Number);

const css = [
  '/* 생성 파일 — packages/ui/scripts/build-tokens.ts. 직접 고치지 말 것. */',
  ':root {',
  ...tokens.color.tokens.map((t) => `  ${varName(t.name)}: ${resolved[firstTheme]![t.name]};`),
  ...plain(tokens.spacing.tokens),
  ...plain(tokens.radius.tokens),
  ...plain(tokens.shadow.tokens),
  ...Object.entries(tokens.type.families).map(([k, v]) => `  ${varName(`font-${k}`)}: ${v};`),
  '}',
  ...themes
    .slice(1)
    .flatMap((theme) => [
      `html[data-theme='${theme}'] {`,
      ...tokens.color.tokens
        .filter((t) => resolved[theme]![t.name] !== resolved[firstTheme]![t.name])
        .map((t) => `  ${varName(t.name)}: ${resolved[theme]![t.name]};`),
      '}',
    ]),
  ...tokens.type.groups.flatMap((g) =>
    g.styles.flatMap((s) => {
      const [regular, , bold = 700] = fontWeights(s.fontWeight);
      const base = [
        `  font-family: var(${varName(`font-${g.family}`)});`,
        `  font-size: ${s.fontSize};`,
        `  line-height: ${s.lineHeight};`,
        ...(s.letterSpacing ? [`  letter-spacing: ${s.letterSpacing};`] : []),
      ];
      // Montage: regular 400 · medium 500 · bold(스타일마다 600 또는 700)
      return [
        `.qc-text-${s.name} {`,
        ...base,
        `  font-weight: ${regular ?? 400};`,
        '}',
        `.qc-text-${s.name}.qc-medium { font-weight: 500; }`,
        `.qc-text-${s.name}.qc-bold { font-weight: ${bold}; }`,
      ];
    }),
  ),
  '',
].join('\n');

const names = (entries: Entry[]) => JSON.stringify(entries.map((t) => t.name));
const ts = [
  '// 생성 파일 — packages/ui/scripts/build-tokens.ts. 직접 고치지 말 것.',
  `export const colorTokenNames = ${names(tokens.color.tokens)} as const;`,
  `export const spaceTokenNames = ${names(tokens.spacing.tokens)} as const;`,
  `export const radiusTokenNames = ${names(tokens.radius.tokens)} as const;`,
  `export const shadowTokenNames = ${names(tokens.shadow.tokens)} as const;`,
  `export const textStyleNames = ${JSON.stringify(tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name)))} as const;`,
  `export const themes = ${JSON.stringify(themes)} as const;`,
  '/** 테마별로 별칭을 풀어 낸 색 값 (대비 검사 등 코드에서 값이 필요할 때). */',
  `export const resolvedColors = ${JSON.stringify(resolved, null, 2)} as const;`,
  '',
].join('\n');

const outputs: [string, string][] = [
  [join(root, 'src/generated/tokens.css'), css],
  [join(root, 'src/generated/tokens.ts'), ts],
];

if (process.argv.includes('--check')) {
  const stale = outputs.filter(([path, content]) => {
    try {
      return readFileSync(path, 'utf8') !== content;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(
      `생성 파일이 tokens.json과 다릅니다. \`pnpm tokens\`를 실행하세요:\n${stale.map(([p]) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
} else {
  for (const [path, content] of outputs) writeFileSync(path, content);
  console.log(`토큰 생성: 색 ${tokens.color.tokens.length}, 테마 ${themes.join('/')}`);
}
