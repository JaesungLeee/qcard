import type { CaseBody } from '@qcard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ConfirmVerdictInput, NewProjectInput, QcardApi, QuestionResolution } from './api';
import type { Role } from '@qcard/shared';

export const ApiContext = createContext<QcardApi | null>(null);

export function useApi(): QcardApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext가 없습니다. <ApiProvider>로 감싸세요.');
  return api;
}

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  myRole: (id: string) => ['myRole', id] as const,
  members: (id: string) => ['members', id] as const,
  invitations: (id: string) => ['invitations', id] as const,
  invitation: (token: string) => ['invitation', token] as const,
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

export function useMyProjects() {
  const api = useApi();
  return useQuery({ queryKey: keys.projects, queryFn: () => api.listMyProjects() });
}

export function useMyRole(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.myRole(projectId), queryFn: async () => (await api.myRole(projectId)) ?? null });
}

export function useMembers(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.members(projectId), queryFn: () => api.listMembers(projectId) });
}

export function useInvitations(projectId: string, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: keys.invitations(projectId), queryFn: () => api.listInvitations(projectId), enabled });
}

export function useInvitation(token: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.invitation(token), queryFn: () => api.getInvitation(token) });
}

/** 프로젝트·멤버·초대를 바꾸는 mutation은 관련 조회를 모두 다시 읽는다 */
function useProjectMutation<T, R = unknown>(fn: (api: QcardApi, input: T) => Promise<R>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => fn(api, input),
    onSettled: () => {
      for (const k of ['projects', 'project', 'myRole', 'members', 'invitations', 'invitation']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });
}

export const useCreateProject = () => useProjectMutation((api, v: NewProjectInput) => api.createProject(v));
export const useSetMemberRole = (projectId: string) =>
  useProjectMutation((api, v: { user: string; role: Role }) => api.setMemberRole(projectId, v.user, v.role));
export const useRemoveMember = (projectId: string) =>
  useProjectMutation((api, user: string) => api.removeMember(projectId, user));
export const useCreateInvitation = (projectId: string) =>
  useProjectMutation((api, v: { role: Role; github?: string }) => api.createInvitation(projectId, v));
export const useRevokeInvitation = (projectId: string) =>
  useProjectMutation((api, id: string) => api.revokeInvitation(projectId, id));
export const useAcceptInvitation = (token: string) =>
  useProjectMutation((api, v: { dataNoticeAck: boolean }) => api.acceptInvitation(token, v));
export const useLeaveProject = (projectId: string) => useProjectMutation((api) => api.leaveProject(projectId));
export const useDeleteProject = (projectId: string) =>
  useProjectMutation((api, confirmName: string) => api.deleteProject(projectId, confirmName));
export const useRestoreProject = (projectId: string) => useProjectMutation((api) => api.restoreProject(projectId));

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
