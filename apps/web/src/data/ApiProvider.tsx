import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import type { QcardApi } from './api';
import { ApiContext } from './hooks';
import { fetchLocalRuns } from './localRuns';
import { createMemoryApi } from './memory';

export function ApiProvider({ api, children }: PropsWithChildren<{ api?: QcardApi }>) {
  // 개발 서버에서는 호스트 실행 결과(packages/agent/runs)를 "로컬 실행" 사이클로 함께 보여 준다
  const [value] = useState(
    () => api ?? createMemoryApi({ localRuns: import.meta.env.DEV ? () => fetchLocalRuns() : undefined }),
  );
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } }),
  );
  return (
    <ApiContext.Provider value={value}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}
