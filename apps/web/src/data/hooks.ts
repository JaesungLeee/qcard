import type { AccountInput, AccountPatch, CaseBody } from '@qcard/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';
import type {
  ConfirmVerdictInput,
  CycleRef,
  DefectPatch,
  DocRef,
  NewDefectInput,
  NewCycleInput,
  NewProjectInput,
  QcardApi,
  QuestionResolution,
  RequestQaDocInput,
  RequestRunInput,
} from './api';
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
  qaDoc: (projectId: string, docId: string) => ['qaDoc', projectId, docId] as const,
  prepFlows: (projectId: string) => ['prepFlows', projectId] as const,
  cycles: (projectId: string) => ['cycles', projectId] as const,
  cycle: (projectId: string, cycleId: string) => ['cycle', projectId, cycleId] as const,
  console: ['console'] as const,
  jobs: (projectId: string) => ['jobs', projectId] as const,
  jobSpecs: (projectId: string, jobId: string) => ['jobSpecs', projectId, jobId] as const,
  jobEvents: (projectId: string, jobId: string) => ['jobEvents', projectId, jobId] as const,
  jobDrafts: (projectId: string, jobId: string, spec: string) => ['jobDrafts', projectId, jobId, spec] as const,
  caseRevisions: (projectId: string, docId: string) => ['caseRevisions', projectId, docId] as const,
  hosts: ['hosts'] as const,
  hostConnections: ['hostConnections'] as const,
  builds: (projectId: string) => ['builds', projectId] as const,
  accounts: (projectId: string) => ['accounts', projectId] as const,
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
  useProjectMutation((api, v: { uid: string; role: Role }) => api.setMemberRole(projectId, v.uid, v.role));
export const useRemoveMember = (projectId: string) =>
  useProjectMutation((api, uid: string) => api.removeMember(projectId, uid));
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

export function useQaDoc(projectId: string, docId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.qaDoc(projectId, docId),
    queryFn: () => api.getQaDoc({ projectId, docId }),
    enabled: enabled && !!docId,
  });
}

export function usePrepFlows(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.prepFlows(projectId), queryFn: () => api.listPrepFlows(projectId) });
}

/** 사이클 목록: 진행률만 보면 돼서 사이클마다 구독하지 않고 15초마다 다시 읽는다 */
export function useCycles(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.cycles(projectId),
    queryFn: () => api.listCycles(projectId),
    refetchInterval: 15_000,
  });
}

/** 사이클 상세: 화면에 떠 있는 동안 구독해 다른 실행자의 진행·판정을 바로 반영한다 (F-CY-05·F-DB-07) */
export function useCycle(projectId: string, cycleId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const key = keys.cycle(projectId, cycleId);
  const q = useQuery({ queryKey: key, queryFn: () => api.getCycle({ projectId, cycleId }) });
  useEffect(
    () =>
      api.watchCycle(
        { projectId, cycleId },
        (d) => qc.setQueryData(keys.cycle(projectId, cycleId), d),
        // 구독이 끊기면 처음 읽은 값을 그대로 두고 다시 읽기에 맡긴다
        () => void qc.invalidateQueries({ queryKey: keys.cycle(projectId, cycleId) }),
      ),
    [api, qc, projectId, cycleId],
  );
  return q;
}

export function useConsoleSession() {
  const api = useApi();
  return useQuery({ queryKey: keys.console, queryFn: () => api.getConsoleSession() });
}

/** QA 문서를 바꾸는 mutation은 문서·문서 목록을 모두 다시 읽는다. */
type DocLike = { id: string; projectId: string };

function useDocMutation<T>(doc: DocLike, fn: (api: QcardApi, ref: DocRef, input: T) => Promise<unknown>) {
  const api = useApi();
  const qc = useQueryClient();
  const ref = { projectId: doc.projectId, docId: doc.id };
  return useMutation({
    mutationFn: (input: T) => fn(api, ref, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.qaDoc(ref.projectId, ref.docId) });
      void qc.invalidateQueries({ queryKey: ['qaDocs'] });
    },
  });
}

export function useUpdateCase(doc: DocLike) {
  return useDocMutation(doc, (api, ref, v: { tcId: string; body: CaseBody; expectedRev: number }) =>
    api.updateCase(ref, v.tcId, v.body, v.expectedRev),
  );
}

export function useSetApproval(doc: DocLike) {
  return useDocMutation(doc, (api, ref, v: { tcIds: string[]; status: 'approved' | 'rejected' | 'pending' }) =>
    api.setApproval(ref, v.tcIds, v.status),
  );
}

export function useResolveQuestion(doc: DocLike) {
  return useDocMutation(doc, (api, ref, v: { questionId: string; resolution: QuestionResolution }) =>
    api.resolveQuestion(ref, v.questionId, v.resolution),
  );
}

export function useCommentQuestion(doc: DocLike) {
  return useDocMutation(doc, (api, ref, v: { questionId: string; text: string }) =>
    api.commentQuestion(ref, v.questionId, v.text),
  );
}

/** 이 QA 문서의 케이스 수정안 (F-QD-17). 대기·생성 중인 것이 있으면 3초마다 다시 읽는다 */
export function useCaseRevisions(doc: DocLike) {
  const api = useApi();
  return useQuery({
    queryKey: keys.caseRevisions(doc.projectId, doc.id),
    queryFn: () => api.listCaseRevisions({ projectId: doc.projectId, docId: doc.id }),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false),
  });
}

/**
 * 케이스 수정안 동작: 요청·다시 시도·버리기·적용. 적용은 일반 편집(낙관적 잠금)으로 케이스를 고친 뒤 처리했다고 기록한다
 */
export function useCaseRevisionAction(doc: DocLike) {
  const api = useApi();
  const qc = useQueryClient();
  const ref = { projectId: doc.projectId, docId: doc.id };
  return useMutation({
    mutationFn: async (
      v:
        | { kind: 'request'; tcId: string }
        | { kind: 'retry'; jobId: string }
        | { kind: 'dismiss'; jobId: string }
        | { kind: 'apply'; jobId: string; tcId: string; body: CaseBody; expectedRev: number },
    ) => {
      if (v.kind === 'request') return void (await api.requestCaseRevision(ref, v.tcId));
      if (v.kind === 'retry') return api.retryJob(ref.projectId, v.jobId);
      if (v.kind === 'apply') await api.updateCase(ref, v.tcId, v.body, v.expectedRev);
      await api.closeCaseRevision(ref.projectId, v.jobId, v.kind === 'apply' ? 'applied' : 'dismissed');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.caseRevisions(ref.projectId, ref.docId) });
      void qc.invalidateQueries({ queryKey: keys.qaDoc(ref.projectId, ref.docId) });
      void qc.invalidateQueries({ queryKey: keys.jobs(ref.projectId) });
    },
  });
}

export function useConfirmVerdict() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmVerdictInput) => api.confirmVerdict(input),
    onSettled: (_r, _e, input) => {
      void qc.invalidateQueries({ queryKey: keys.cycle(input.projectId, input.cycleId) });
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}

/** 결함 등록·심각도·상태 변경 (F-RP-19) */
export function useCreateDefect() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDefectInput) => api.createDefect(input),
    onSettled: (_r, _e, input) => {
      void qc.invalidateQueries({ queryKey: keys.cycle(input.projectId, input.cycleId) });
      void qc.invalidateQueries({ queryKey: keys.cycles(input.projectId) });
    },
  });
}

export function useUpdateDefect(ref: CycleRef) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { defectId: string; patch: DefectPatch }) => api.updateDefect(ref, v.defectId, v.patch),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.cycle(ref.projectId, ref.cycleId) }),
  });
}

// ---------------------------------------------------------------- QA 문서 생성 작업 (PRD §5.2)

/** 대기·생성 중인 작업이 있으면 3초마다 다시 읽는다 (호스트가 진행률을 갱신한다) */
export function useJobs(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.jobs(projectId),
    queryFn: () => api.listJobs(projectId),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false),
  });
  // 작업이 끝나 새 문서·준비 플로우가 생기면 목록을 다시 읽는다
  const done = (q.data ?? [])
    .filter((j) => j.status === 'done')
    .map((j) => j.id)
    .join(',');
  const seen = useRef(done);
  useEffect(() => {
    if (seen.current === done) return;
    seen.current = done;
    void qc.invalidateQueries({ queryKey: keys.qaDocs(projectId) });
    void qc.invalidateQueries({ queryKey: keys.prepFlows(projectId) });
  }, [done, projectId, qc]);
  return q;
}

/*
 * 작업 상세 화면 (생성 진행). 작업이 대기·생성 중이면 3초마다 다시 읽는다.
 * 생성 계획은 호스트가 시작할 때 한 번 쓰므로, 생기기 전까지만 다시 읽는다
 */
const jobPoll = (active: boolean) => (active ? 3000 : false);

export function useJobSpecs(projectId: string, jobId: string, active: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.jobSpecs(projectId, jobId),
    queryFn: () => api.listJobSpecs(projectId, jobId),
    refetchInterval: (q) => jobPoll(active && !q.state.data?.length),
  });
}

export function useJobEvents(projectId: string, jobId: string, active: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.jobEvents(projectId, jobId),
    queryFn: () => api.listJobEvents(projectId, jobId),
    refetchInterval: jobPoll(active),
  });
}

export function useJobDrafts(projectId: string, jobId: string, spec: string | undefined, active: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.jobDrafts(projectId, jobId, spec ?? ''),
    queryFn: () => api.listJobDrafts(projectId, jobId, spec!),
    enabled: !!spec,
    refetchInterval: jobPoll(active),
  });
}

/** 내 호스트 에이전트 연결 상태 (15초마다) */
export function useMyHosts() {
  const api = useApi();
  return useQuery({ queryKey: keys.hosts, queryFn: () => api.myHosts(), refetchInterval: 15_000 });
}

/** 내 계정에 연결된 PC (F-TM-14) */
export function useHostConnections() {
  const api = useApi();
  return useQuery({ queryKey: keys.hostConnections, queryFn: () => api.myHostConnections() });
}

function useHostMutation<T, R>(fn: (api: QcardApi, input: T) => Promise<R>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => fn(api, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.hostConnections });
      void qc.invalidateQueries({ queryKey: keys.hosts });
    },
  });
}
export const useConnectHost = () => useHostMutation((api, name: string) => api.connectHost(name));
export const useDisconnectHost = () => useHostMutation((api, hostId: string) => api.disconnectHost(hostId));

export function useRequestQaDoc(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestQaDocInput) => api.requestQaDoc(projectId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.jobs(projectId) }),
  });
}

export function useRetryJob(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.retryJob(projectId, jobId),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.jobs(projectId) }),
  });
}

/** 웹에서 내 호스트로 Run 시작 요청 (작업 kind `run_cycle`) */
export function useRequestRun(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestRunInput) => api.requestRun(projectId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.jobs(projectId) }),
  });
}

// ---------------------------------------------------------------- 빌드·사이클 만들기 (F-DV-05, F-CY-01)

export function useBuilds(projectId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.builds(projectId), queryFn: () => api.listBuilds(projectId) });
}

export function useUploadBuild(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: { name: string; bytes: Uint8Array }) => api.uploadBuild(projectId, file),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.builds(projectId) }),
  });
}

export function useCreateCycle(projectId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewCycleInput) => api.createCycle(projectId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.cycles(projectId) }),
  });
}

/** 테스트 계정 (F-PF-04·08). 배정 상태가 실행 중에 바뀌므로 30초마다 다시 읽는다 */
export function useAccounts(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.accounts(projectId),
    queryFn: () => api.listAccounts(projectId),
    refetchInterval: 30_000,
  });
}

function useAccountMutation<T, R = unknown>(projectId: string, fn: (api: QcardApi, input: T) => Promise<R>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => fn(api, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.accounts(projectId) }),
  });
}

export const useCreateAccount = (projectId: string) =>
  useAccountMutation(projectId, (api, v: AccountInput) => api.createAccount(projectId, v));
export const useUpdateAccount = (projectId: string) =>
  useAccountMutation(projectId, (api, v: { id: string; patch: AccountPatch }) =>
    api.updateAccount(projectId, v.id, v.patch),
  );
export const useDeleteAccount = (projectId: string) =>
  useAccountMutation(projectId, (api, id: string) => api.deleteAccount(projectId, id));
export const useClearAccountFlag = (projectId: string) =>
  useAccountMutation(projectId, (api, v: { id: string; flag: 'loginFailed' | 'quarantine' }) =>
    api.clearAccountFlag(projectId, v.id, v.flag),
  );
