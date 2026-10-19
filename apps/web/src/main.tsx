import '@qcard/ui/styles.css';
import { QcardThemeProvider } from '@qcard/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './data/ApiProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QcardThemeProvider>
      <ApiProvider>
        <App />
      </ApiProvider>
    </QcardThemeProvider>
  </StrictMode>,
);
