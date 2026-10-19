import type { CaseBody } from '@qcard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ConfirmVerdictInput, QcardApi, QuestionResolution } from './api';

export const ApiContext = createContext<QcardApi | null>(null);

export function useApi(): QcardApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext가 없습니다. <ApiProvider>로 감싸세요.');
  return api;
}

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  qaDocs: (projectId: string) => ['qaDocs', projectId] as const,
  qaDoc: (docId: string) => ['qaDoc', docId] as const,
  prepFlows: (projectId: string) => ['prepFlows', projectId] as const,
  cycles: (projectId: string) => ['cycles', projectId] as const,
  cycle: (cycleId: string) => ['cycle', cycleId] as const,
  console: ['console'] as const,
};

export function useProject(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.project(projectId), queryFn: () => api.getProject(projectId) });
}

export function useQaDocs(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.qaDocs(projectId), queryFn: () => api.listQaDocs(projectId) });
}

export function useQaDoc(docId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.qaDoc(docId), queryFn: () => api.getQaDoc(docId) });
}

export function usePrepFlows(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.prepFlows(projectId), queryFn: () => api.listPrepFlows(projectId) });
}

export function useCycles(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.cycles(projectId), queryFn: () => api.listCycles(projectId) });
}

export function useCycle(cycleId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.cycle(cycleId), queryFn: () => api.getCycle(cycleId) });
}

export function useConsoleSession() {
  const api = useApi();
  return useQuery({ queryKey: keys.console, queryFn: () => api.getConsoleSession() });
}

/** QA 문서를 바꾸는 mutation은 문서·문서 목록을 모두 다시 읽는다. */
function useDocMutation<T>(docId: string, fn: (api: QcardApi, input: T) => Promise<unknown>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => fn(api, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.qaDoc(docId) });
      void qc.invalidateQueries({ queryKey: ['qaDocs'] });
    },
  });
}

export function useUpdateCase(docId: string) {
  return useDocMutation(docId, (api, v: { tcId: string; body: CaseBody; expectedRev: number }) =>
    api.updateCase(docId, v.tcId, v.body, v.expectedRev),
  );
}

export function useSetApproval(docId: string) {
  return useDocMutation(docId, (api, v: { tcIds: string[]; status: 'approved' | 'rejected' | 'pending' }) =>
    api.setApproval(docId, v.tcIds, v.status),
  );
}

export function useResolveQuestion(docId: string) {
  return useDocMutation(docId, (api, v: { questionId: string; resolution: QuestionResolution }) =>
    api.resolveQuestion(docId, v.questionId, v.resolution),
  );
}

export function useCommentQuestion(docId: string) {
  return useDocMutation(docId, (api, v: { questionId: string; text: string }) =>
    api.commentQuestion(docId, v.questionId, v.text),
  );
}

export function useConfirmVerdict() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmVerdictInput) => api.confirmVerdict(input),
    onSettled: (_r, _e, input) => {
      void qc.invalidateQueries({ queryKey: keys.cycle(input.cycleId) });
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}
