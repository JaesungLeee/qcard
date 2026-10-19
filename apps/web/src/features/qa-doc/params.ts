import type { PrepFlow } from '@qcard/fixtures';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

export const TABS = ['cases', 'questions', 'suggestions', 'traceability'] as const;
export type DocTab = (typeof TABS)[number];

export const PREP_KIND_LABEL: Record<PrepFlow['kind'], string> = {
  login: '로그인',
  data_state: '데이터 상태',
  env: '환경',
};

type Patch = Partial<Record<'tab' | 'case' | 'edit' | 'question', string | null>>;

/** 검토 화면 쿼리 파라미터. 다른 파라미터(예: `theme`)는 그대로 둔다. */
export function useDocParams() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: DocTab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as DocTab) : 'cases';
  const set = useCallback(
    (patch: Patch, options?: { replace?: boolean }) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: options?.replace },
      ),
    [setParams],
  );
  return {
    tab,
    caseId: params.get('case'),
    edit: params.get('edit') === '1',
    question: params.get('question'),
    set,
  };
}

/** 같은 화면 안 링크용 쿼리 문자열 (theme 등은 유지) */
export function useDocHref() {
  const [params] = useSearchParams();
  return (patch: Patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  };
}
