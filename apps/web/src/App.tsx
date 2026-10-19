import { useThemeControl } from '@qcard/ui';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';

/** `?theme=dark|light`로 테마를 고정한다 (ui:snap이 사용). */
function useThemeFromQuery() {
  const { setTheme } = useThemeControl();
  useEffect(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') setTheme(theme);
  }, [setTheme]);
}

export function App() {
  useThemeFromQuery();
  return <RouterProvider router={router} />;
}
