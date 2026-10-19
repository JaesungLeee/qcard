import { ThemeProvider } from '@montage-ui/core';
import type { PropsWithChildren } from 'react';

/** Montage ThemeProvider + qcard 기본값. 다크 모드는 `<html data-theme="dark">`(Montage가 관리)를 따른다. */
export function QcardThemeProvider({ children }: PropsWithChildren) {
  return (
    <ThemeProvider enableDarkMode disableTransitionOnChange cookie={{ key: 'qcard-theme', domain: 'none' }}>
      {children}
    </ThemeProvider>
  );
}
