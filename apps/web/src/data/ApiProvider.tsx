import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import type { QcardApi } from './api';
import { ApiContext } from './hooks';
import { createMemoryApi } from './memory';

export function ApiProvider({ api, children }: PropsWithChildren<{ api?: QcardApi }>) {
  const [value] = useState(() => api ?? createMemoryApi());
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } }),
  );
  return (
    <ApiContext.Provider value={value}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}
