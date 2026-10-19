import type {
  colorTokenNames,
  radiusTokenNames,
  shadowTokenNames,
  spaceTokenNames,
  textStyleNames,
} from './generated/tokens';

export type ColorToken = (typeof colorTokenNames)[number];
export type SpaceToken = (typeof spaceTokenNames)[number];
export type RadiusToken = (typeof radiusTokenNames)[number];
export type ShadowToken = (typeof shadowTokenNames)[number];
export type TextStyle = (typeof textStyleNames)[number];
export type Token = ColorToken | SpaceToken | RadiusToken | ShadowToken;

/** 토큰을 CSS 값으로: `token('foreground-neutral-primary')` → `var(--qc-foreground-neutral-primary)` */
export const token = (name: Token): string => `var(--qc-${name.replace(/\./g, '_')})`;

/** 타이포 스타일 클래스: `textClass('label1', 'medium')` → `qc-text-label1 qc-medium` */
export const textClass = (style: TextStyle, weight: 'regular' | 'medium' | 'bold' = 'regular'): string =>
  weight === 'regular' ? `qc-text-${style}` : `qc-text-${style} qc-${weight}`;
