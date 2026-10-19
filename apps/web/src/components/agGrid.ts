import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * 케이스 그리드·QA 시트용 AG Grid 테마. 색·글자·간격은 `--qc-*` 토큰을 그대로 쓰므로
 * 라이트·다크 전환을 따로 처리하지 않아도 된다. `<AgGridReact theme={qcardGridTheme} />`
 */
export const qcardGridTheme = themeQuartz.withParams({
  fontFamily: 'var(--qc-font-sans)',
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 500,
  spacing: 6,
  rowHeight: 44,
  headerHeight: 40,
  wrapperBorderRadius: 12,
  borderRadius: 8,
  backgroundColor: 'var(--qc-surface-neutral-primary)',
  foregroundColor: 'var(--qc-foreground-neutral-primary)',
  textColor: 'var(--qc-foreground-neutral-primary)',
  subtleTextColor: 'var(--qc-foreground-neutral-tertiary)',
  accentColor: 'var(--qc-foreground-brand-primary)',
  borderColor: 'var(--qc-line-neutral-tertiary-opaque)',
  wrapperBorder: { color: 'var(--qc-line-neutral-secondary-opaque)' },
  headerBackgroundColor: 'var(--qc-surface-neutral-tertiary)',
  headerTextColor: 'var(--qc-foreground-neutral-secondary)',
  chromeBackgroundColor: 'var(--qc-surface-neutral-primary)',
  rowHoverColor: 'var(--qc-surface-neutral-secondary)',
  selectedRowBackgroundColor: 'var(--qc-surface-brand-subtle)',
  oddRowBackgroundColor: 'var(--qc-surface-neutral-primary)',
  menuBackgroundColor: 'var(--qc-surface-elevated-primary)',
  inputFocusBorder: { color: 'var(--qc-line-brand-strong)' },
  browserColorScheme: 'inherit',
});
