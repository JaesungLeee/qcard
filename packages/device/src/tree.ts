import type { Bounds } from '@qcard/shared';
import type { Point, UiElement } from './types';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e] ?? m),
  );

const parseBounds = (s: string | undefined): Bounds => {
  const m = s?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!m) return { x: 0, y: 0, w: 0, h: 0 };
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/**
 * `uiautomator dump` XML → 요소 목록 (문서 순서). 형식이 단순해서 정규식으로 읽는다:
 * `<node 속성…>` / `<node 속성… />` / `</node>`.
 */
export function parseUiTree(xml: string): UiElement[] {
  const out: UiElement[] = [];
  const stack: string[] = [];
  const tag = /<(\/?)node\b([^>]*?)(\/?)>/g;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, closing, attrText = '', selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const a: Record<string, string> = {};
    for (const [, k, v] of attrText.matchAll(/([\w-]+)="([^"]*)"/g)) a[k!] = decode(v!);
    const ref = `e${out.length}`;
    const rid = a['resource-id'];
    out.push({
      ref,
      resourceId: rid ? rid.replace(/^[\w.]+:id\//, '') : undefined,
      text: a.text || undefined,
      desc: a['content-desc'] || undefined,
      cls: a.class ?? '',
      pkg: a.package || undefined,
      bounds: parseBounds(a.bounds),
      clickable: a.clickable === 'true',
      enabled: a.enabled !== 'false',
      focused: a.focused === 'true',
      scrollable: a.scrollable === 'true',
      checked: a.checkable === 'true' ? a.checked === 'true' : undefined,
      password: a.password === 'true',
      depth: stack.length,
      parent: stack.at(-1),
    });
    if (!selfClosing) stack.push(ref);
  }
  return out;
}

/** 요소 번호(`e12`) 또는 resource-id로 찾는다 */
export function findElement(tree: UiElement[], refOrId: string): UiElement | undefined {
  return tree.find((e) => e.ref === refOrId) ?? tree.find((e) => e.resourceId === refOrId);
}

export const center = (b: Bounds): Point => [Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2)];

export const contains = (b: Bounds, [x, y]: Point) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

/** 크기 검증용 px → dp (F-EX-03) */
export const pxToDp = (px: number, density: number) => (px * 160) / density;

const shortCls = (cls: string) => cls.slice(cls.lastIndexOf('.') + 1);

/** LLM에 넘길 가치가 있는 요소: 글자·설명·id가 있거나 조작할 수 있는 것 */
const meaningful = (e: UiElement) => Boolean(e.text || e.desc || e.resourceId || e.clickable || e.scrollable);

/**
 * 글자 없는 클릭 요소의 라벨: 자손의 텍스트·설명을 이어 붙인다.
 * Compose 버튼은 클릭 가능한 View 안에 TextView가 따로 있어서, 이게 없으면 어느 요소가 "저장" 버튼인지 알기 어렵다.
 */
export function childLabels(tree: UiElement[]): Map<string, string> {
  const children = new Map<string, UiElement[]>();
  for (const e of tree) if (e.parent) children.set(e.parent, [...(children.get(e.parent) ?? []), e]);
  const collect = (ref: string): string[] =>
    (children.get(ref) ?? []).flatMap((c) => [...(c.text ? [c.text] : c.desc ? [c.desc] : []), ...collect(c.ref)]);
  const out = new Map<string, string>();
  for (const e of tree) {
    if (!e.clickable || e.text || e.desc) continue;
    const label = collect(e.ref).join(' ').trim();
    if (label) out.set(e.ref, label.length > 60 ? `${label.slice(0, 60)}…` : label);
  }
  return out;
}

/**
 * LLM 입력용 트리 텍스트. 한 줄에 요소 하나, 의미 없는 컨테이너는 뺀다.
 * 예: `e12 Button "저장" id=profile_save [60,2160 960x160] clickable`, `e45 View label="저장" […] clickable`
 */
export function formatTree(tree: UiElement[]): string {
  const labels = childLabels(tree);
  return tree
    .filter(meaningful)
    .map((e) => {
      const parts = [e.ref, shortCls(e.cls) || 'View'];
      if (e.text) parts.push(JSON.stringify(e.password ? '••••' : e.text));
      if (e.desc) parts.push(`desc=${JSON.stringify(e.desc)}`);
      const label = labels.get(e.ref);
      if (label) parts.push(`label=${JSON.stringify(label)}`);
      if (e.resourceId) parts.push(`id=${e.resourceId}`);
      parts.push(`[${e.bounds.x},${e.bounds.y} ${e.bounds.w}x${e.bounds.h}]`);
      if (e.clickable) parts.push('clickable');
      if (e.scrollable) parts.push('scrollable');
      if (!e.enabled) parts.push('disabled');
      if (e.focused) parts.push('focused');
      if (e.checked !== undefined) parts.push(e.checked ? 'checked' : 'unchecked');
      return parts.join(' ');
    })
    .join('\n');
}
