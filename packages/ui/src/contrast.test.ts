import { describe, expect, it } from 'vitest';
import { resolvedColors, themes } from './generated/tokens';

type Rgba = [number, number, number, number];

function parse(hex: string): Rgba {
  const h = hex.replace('#', '');
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

/** 반투명 색을 아래 배경 위에 합성한다. */
const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export function contrast(fg: string, bg: string, page: string): number {
  const ground = over(parse(bg), parse(page));
  const [l1, l2] = [luminance(over(parse(fg), ground)), luminance(ground)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const verdicts = ['pass', 'fail', 'blocked', 'check', 'nt'] as const;
const pages = ['background-neutral-primary', 'surface-neutral-primary'] as const;

// DESIGN.md: 판정 배지·셀은 작은 글자라 모든 테마에서 4.5:1 이상이어야 한다.
describe.each(themes)('판정 색 대비 (%s)', (theme) => {
  const c = resolvedColors[theme] as Record<string, string>;
  it.each(verdicts.flatMap((v) => pages.map((p) => [v, p] as const)))('%s on %s ≥ 4.5', (v, p) => {
    expect(contrast(c[`qcard-verdict-${v}-fg`]!, c[`qcard-verdict-${v}-bg`]!, c[p]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['foreground-neutral-primary', 'foreground-neutral-secondary'])('%s 본문 ≥ 4.5', (fg) => {
    expect(contrast(c[fg]!, c['background-neutral-primary']!, c['background-neutral-primary']!)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
