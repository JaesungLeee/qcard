import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import type { QcardApi } from './api';
import { ApiContext } from './hooks';
import { fetchLocalRuns } from './localRuns';
import { createMemoryApi } from './memory';
import { createFirebaseClient } from './firebaseClient';
import { AuthGate } from '../shell/AuthGate';

/** `VITE_DATA=firebase`면 Firestore 구현(로그인 필요), 아니면 fixture 메모리 구현 */
const useFirebase = import.meta.env.VITE_DATA === 'firebase';

export function ApiProvider({ api, children }: PropsWithChildren<{ api?: QcardApi }>) {
  const [firebase] = useState(() => (!api && useFirebase ? createFirebaseClient() : undefined));
  // 개발 서버에서는 호스트 실행 결과(packages/agent/runs)를 "로컬 실행" 사이클로 함께 보여 준다
  const [value] = useState(
    () =>
      api ?? firebase?.api ?? createMemoryApi({ localRuns: import.meta.env.DEV ? () => fetchLocalRuns() : undefined }),
  );
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } }),
  );
  return (
    <ApiContext.Provider value={value}>
      <QueryClientProvider client={client}>
        {firebase ? <AuthGate client={firebase}>{children}</AuthGate> : children}
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
