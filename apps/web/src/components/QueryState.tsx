import { Loading, SectionMessage } from '@qcard/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** 조회 상태(로딩·에러)를 한 가지 모양으로 보여주고, 데이터가 있으면 children을 그린다. */
export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loading aria-label="불러오는 중" />;
  if (query.isError)
    return (
      <SectionMessage variant="negative" description={String(query.error.message)}>
        불러오지 못했습니다
      </SectionMessage>
    );
  return <>{children(query.data)}</>;
}
