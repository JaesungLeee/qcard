import { hash } from '@qcard/fixtures';
import {
  CaseBody,
  type Build,
  type CaseResult,
  type CaseReviseJob,
  type Defect,
  type Job,
  type QaDocJob,
  type QaDocJobDraft,
  type QaDocJobEvent,
  type QaDocJobSpec,
  type RunCycleJob,
  type TargetDevice,
  type SpecBundle,
  type QADocument,
  type Run,
  type TestCase,
  type TestCycle,
  type Verdict,
  type VerdictChange,
} from '@qcard/shared';
import type { ApkInfo } from '@qcard/apk';
import { readBundle } from '@qcard/spec';
import {
  NotFoundError,
  PermissionError,
  RuleError,
  type ConfirmVerdictInput,
  type DefectDraft,
  type DefectPatch,
  type NewDefectInput,
  type CycleSummary,
  type NewCycleInput,
  type QaDocSummary,
  type QuestionResolution,
  type RequestQaDocInput,
  type RequestRunInput,
  type VerdictCounts,
} from './api';

/*
 * QcardApi 구현(메모리·Firestore)이 함께 쓰는 순수 계산. 저장은 각 구현이 한다.
 */

const VERDICTS: Verdict[] = ['pass', 'fail', 'blocked', 'check', 'nt', 'na'];

export function countVerdicts(results: CaseResult[]): VerdictCounts {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
  for (const r of results) counts[r.verdict]++;
  return counts;
}

/** 통과율 = Pass / (수행 완료 칸 − N/A). N/T는 분모에서 뺀다. */
export function passRate(counts: VerdictCounts): number {
  const done = counts.pass + counts.fail + counts.blocked + counts.check;
  return done === 0 ? 0 : counts.pass / done;
}

export function qaDocSummary(d: QADocument, all: QADocument[]): QaDocSummary {
  const changeCounts = { new: 0, changed: 0, removed: 0, same: 0 };
  const approvalCounts = { pending: 0, approved: 0, rejected: 0, held: 0 };
  for (const c of d.cases) {
    changeCounts[c.change]++;
    approvalCounts[c.approval.status]++;
  }
  return {
    id: d.id,
    appVersion: d.appVersion,
    createdAt: d.createdAt,
    prevAppVersion: all.find((x) => x.id === d.prevDocId)?.appVersion,
    caseCount: d.cases.length,
    changeCounts,
    approvalCounts,
    openQuestions: d.questions.filter((q) => q.status === 'open').length,
  };
}

/** 케이스 저장 (F-QD-09): 본문만 남겨 해시하고, 내용이 바뀌면 승인된 케이스는 자동 미승인 (F-QD-10) */
export function nextCase(current: TestCase, input: CaseBody, user: string, now: string): TestCase {
  // 케이스 전체 객체를 넘겨도 본문 필드만 남긴다 (해시·저장 대상)
  const body = CaseBody.parse(input);
  const contentHash = hash(body);
  const changed = contentHash !== current.contentHash;
  return {
    ...current,
    ...body,
    contentHash,
    rev: current.rev + 1,
    updatedBy: user,
    updatedAt: now,
    approval: changed && current.approval.status === 'approved' ? { status: 'pending' } : current.approval,
  };
}

/** 승인은 현재 내용 해시로 기록한다 */
export function approvalFor(
  c: TestCase,
  status: 'approved' | 'rejected' | 'pending',
  user: string,
  now: string,
): TestCase['approval'] {
  return status === 'approved'
    ? { status, by: user, at: now, contentHash: c.contentHash }
    : status === 'rejected'
      ? { status, by: user, at: now }
      : { status };
}

/** 스펙 확인 질문 처리 (F-QD-03). 바뀐 질문 목록과, 열린 질문이 더 없어 미승인으로 돌아갈 보류 케이스 */
export function resolveQuestionIn(
  d: Pick<QADocument, 'questions' | 'cases'>,
  questionId: string,
  resolution: QuestionResolution,
  user: string,
  now: string,
): { questions: QADocument['questions']; released: string[] } | undefined {
  const q = d.questions.find((x) => x.id === questionId);
  if (!q) return undefined;
  const next = {
    ...q,
    status: resolution.kind === 'answer' ? ('answered' as const) : ('proceed' as const),
    ...(resolution.kind === 'answer' ? { answer: resolution.text } : {}),
    comments: [
      ...q.comments,
      { by: user, at: now, text: resolution.kind === 'answer' ? resolution.text : '현 스펙대로 진행합니다.' },
    ],
  };
  const questions = d.questions.map((x) => (x.id === questionId ? next : x));
  const released = d.cases
    .filter((c) => c.approval.status === 'held')
    .filter((c) => !questions.some((x) => x.status === 'open' && x.caseIds.includes(c.tcId)))
    .map((c) => c.tcId);
  return { questions, released };
}

/** 사람 확정·오버라이드 (F-RP-04)가 남기는 판정 기록 한 건. 판정이 같아도 사람이 확정했다는 기록으로 남긴다 */
export function verdictChange(r: CaseResult, input: ConfirmVerdictInput, user: string, now: string): VerdictChange {
  return { at: now, by: user, from: r.verdict, to: input.verdict, ...(input.note ? { note: input.note } : {}) };
}

/** 사람 확정·오버라이드 (F-RP-04): 판정 변경 이력을 남긴다 */
export function confirmedResult(r: CaseResult, input: ConfirmVerdictInput, user: string, now: string): CaseResult {
  const next: CaseResult = structuredClone(r);
  next.history.push(verdictChange(r, input, user, now));
  next.verdict = input.verdict;
  next.decidedBy = { kind: 'human', name: user };
  next.autoConfirmed = false;
  if (input.actualSummary !== undefined) next.actualSummary = input.actualSummary;
  if (input.note !== undefined) next.note = input.note;
  if (!next.executedAt) {
    next.executedAt = now;
    next.executor = user;
  }
  return next;
}

export function cycleSummary(
  cycle: TestCycle,
  build: Build,
  docVersion: string,
  results: CaseResult[],
  runs: Run[],
): CycleSummary {
  const counts = countVerdicts(results);
  return {
    cycle,
    build,
    docVersion,
    counts,
    total: results.length,
    done: results.length - counts.nt,
    passRate: passRate(counts),
    activeRuns: runs.filter((r) => r.status === 'running' || r.status === 'paused'),
    unlinkedFails: unlinkedFails(results).length,
  };
}

/** 결함이 연결되지 않은 Fail 칸 (F-RP-19) */
export const unlinkedFails = (results: CaseResult[]) => results.filter((r) => r.verdict === 'fail' && !r.defectId);

/** 결함 등록 폼에 미리 채울 값 (F-RP-19): 케이스의 제목·사전 조건과 스텝·기대 결과, 칸의 실제 결과 */
export function defectDraft(tc: TestCase, r: CaseResult): DefectDraft {
  return {
    title: tc.title,
    severity: 'major',
    repro: [...tc.preconditions, ...tc.steps.map((s) => s.text)],
    expected: tc.verificationPoints.map((v) => v.expected).join(' / '),
    actual: r.actualSummary ?? '',
  };
}

/**
 * 결함 등록 (F-RP-19): 사이클의 다음 번호로 결함을 만들고 칸에 연결한다. 저장은 세 문서 — 결함, 번호를 올린 사이클,
 * `defectId`를 채운 결과 칸 — 를 함께 쓴다
 */
export function newDefect(
  cycle: TestCycle,
  r: CaseResult,
  input: NewDefectInput,
  user: { name: string },
  now: string,
): { defect: Defect; cycle: TestCycle; result: CaseResult } {
  if (r.verdict !== 'fail') throw new RuleError('Fail 칸에서만 결함을 등록할 수 있습니다.');
  if (r.defectId) throw new RuleError(`이미 결함 ${r.defectId}이(가) 연결된 칸입니다.`);
  const title = input.title.trim();
  if (!title) throw new RuleError('결함 제목을 입력하세요.');
  const repro = input.repro.map((s) => s.trim()).filter(Boolean);
  if (!repro.length) throw new RuleError('재현 절차를 한 단계 이상 입력하세요.');
  const seq = (cycle.defectSeq ?? 0) + 1;
  const defect: Defect = {
    id: `D-${seq}`,
    title,
    severity: input.severity,
    tcId: r.tcId,
    deviceId: r.deviceId,
    ...(r.osBuild ? { osBuild: r.osBuild } : {}),
    repro,
    expected: input.expected.trim(),
    actual: input.actual.trim(),
    status: 'open',
    createdBy: user.name,
    createdAt: now,
  };
  return { defect, cycle: { ...cycle, defectSeq: seq }, result: { ...r, defectId: defect.id } };
}

/** 결함 심각도·상태 바꾸기 (F-RP-19). 그 밖의 필드는 바꾸지 않는다 */
export function changedDefect(d: Defect, patch: DefectPatch): Defect {
  return {
    ...d,
    ...(patch.severity ? { severity: patch.severity } : {}),
    ...(patch.status ? { status: patch.status } : {}),
  };
}

/** 진행 중 사이클: 끝나지 않았고 로컬 실행 묶음이 아닌 것 */
export const isActiveCycle = (c: TestCycle) => !c.period.end && c.origin !== 'local_run';

/** 완료하기 전에 알릴 것 (F-CY-09): 남은 확인필요·N/T 칸, 아직 끝나지 않은 Run */
export function completionWarnings(results: CaseResult[], runs: Run[]) {
  const counts = countVerdicts(results);
  return {
    check: counts.check,
    nt: counts.nt,
    /** 실행 중인 Run은 끝까지 결과를 올린다 */
    running: runs.filter((r) => r.status === 'running').length,
    /** 일시정지된 Run은 완료 후 이어서 실행할 수 없다 */
    paused: runs.filter((r) => r.status === 'paused').length,
  };
}

/** 사이클 완료 (F-CY-09) */
export function completedCycle(c: TestCycle, user: { name: string }, now: string): TestCycle {
  if (c.origin === 'local_run') throw new RuleError('로컬 실행 묶음은 완료할 수 없습니다.');
  if (c.period.end) throw new RuleError('이미 완료된 사이클입니다.');
  return { ...c, period: { ...c.period, end: now }, completedBy: user.name };
}

/** 완료 취소 (F-CY-09) */
export function reopenedCycle(c: TestCycle): TestCycle {
  if (c.origin === 'local_run' || !c.period.end) throw new RuleError('완료된 사이클이 아닙니다.');
  const { completedBy: _, ...rest } = c;
  return { ...rest, period: { start: c.period.start } };
}

/** 완료(F-CY-09)·삭제 중(F-CY-10)인 사이클은 새 Run을 받지 않는다 — 웹 요청·호스트가 함께 쓴다 */
export function requireOpenCycle(c: TestCycle): void {
  if (c.deletingAt) throw new RuleError(`삭제 중인 사이클입니다 (${c.name}).`);
  if (c.period.end) throw new RuleError(`완료된 사이클입니다 (${c.name}). 다시 열어야 실행할 수 있습니다.`);
}

/**
 * QA 문서 생성 요청 (PRD §5.2) → 올릴 파일·스펙 묶음·Job. 메모리·Firestore 구현이 같이 쓴다.
 * `<스펙>/spec.md`만 올리고(F-IN-08), 스펙이 하나도 없거나 버전이 비면 `RuleError`.
 */
export function qaDocRequest(
  projectId: string,
  input: RequestQaDocInput,
  user: { uid: string; name: string },
  now: string,
  ids: { bundleId: string; jobId: string },
): { bundle: SpecBundle; uploads: { path: string; content: string }[]; job: QaDocJob } {
  const appVersion = input.appVersion.trim();
  if (!appVersion) throw new RuleError('앱 버전을 입력하세요.');
  const parsed = readBundle(input.files);
  if (!parsed.specs.length) {
    throw new RuleError('`<스펙 이름>/spec.md` 파일이 없습니다. docs/specs 폴더나 그 폴더를 묶은 ZIP을 올리세요.');
  }
  // 같은 폴더의 plan.md 등은 빼고 spec.md만 스펙 이름으로 찾는다
  const byName = new Map(
    input.files.flatMap((f) => {
      const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
      return parts.at(-1) === 'spec.md' ? [[parts.at(-2) ?? '', f] as const] : [];
    }),
  );
  const uploads = parsed.specs.map((s) => ({
    path: `projects/${projectId}/specBundles/${ids.bundleId}/${s.name}/spec.md`,
    content: byName.get(s.name)!.content,
  }));
  const bundle: SpecBundle = {
    id: ids.bundleId,
    projectId,
    appVersion,
    uploadedBy: user.name,
    uploadedAt: now,
    specs: parsed.specs.map((s, i) => ({
      name: s.name,
      title: s.title,
      ...(s.version ? { version: s.version } : {}),
      path: uploads[i]!.path,
      contentHash: hash(uploads[i]!.content),
    })),
    ignored: parsed.ignored,
  };
  const job: QaDocJob = {
    id: ids.jobId,
    projectId,
    kind: 'qa_doc_generate',
    requestedBy: user.uid,
    requestedByName: user.name,
    createdAt: now,
    status: 'queued',
    input: { bundleId: ids.bundleId, appVersion, ...(input.prevDocId ? { prevDocId: input.prevDocId } : {}) },
  };
  return { bundle, uploads, job };
}

/** 다시 시도: 실패·일시정지한 작업만, 요청자 본인만 */
export function retriedJob(job: Job, uid: string): Job {
  if (job.requestedBy !== uid) throw new PermissionError('요청한 사람만 다시 시도할 수 있습니다.');
  if (job.status !== 'failed' && job.status !== 'paused')
    throw new RuleError('실패하거나 일시정지한 작업만 다시 시도합니다.');
  if (job.kind === 'run_cycle' || job.kind === 'case_revise') {
    const { error: _e, host: _h, result: _r, ...rest } = job;
    return { ...rest, status: 'queued' } as Job;
  }
  const { error: _e, progress: _p, host: _h, ...rest } = job;
  return { ...rest, status: 'queued' };
}

/**
 * 케이스 수정안 요청 (F-QD-17, 작업 kind `case_revise`). 답변된 질문 중 이 케이스에 연결된 것만 반영한다.
 * 같은 케이스에 대기·생성 중인 수정안이 있으면 또 만들지 않는다
 */
export function caseReviseRequest(
  d: Pick<QADocument, 'id' | 'projectId' | 'cases' | 'questions'>,
  tcId: string,
  existing: Job[],
  user: { uid: string; name: string },
  now: string,
  jobId: string,
): CaseReviseJob {
  const c = d.cases.find((x) => x.tcId === tcId);
  if (!c) throw new NotFoundError(`케이스 없음: ${tcId}`);
  const questionIds = d.questions.filter((q) => q.status === 'answered' && q.caseIds.includes(tcId)).map((q) => q.id);
  if (!questionIds.length) throw new RuleError('이 케이스에 답변된 스펙 확인 질문이 없습니다.');
  const busy = existing.some(
    (j) =>
      j.kind === 'case_revise' &&
      j.input.docId === d.id &&
      j.input.tcId === tcId &&
      (j.status === 'queued' || j.status === 'running'),
  );
  if (busy) throw new RuleError('이 케이스의 수정안을 이미 만들고 있습니다.');
  return {
    id: jobId,
    projectId: d.projectId,
    kind: 'case_revise',
    requestedBy: user.uid,
    requestedByName: user.name,
    createdAt: now,
    status: 'queued',
    input: { docId: d.id, tcId, questionIds, baseRev: c.rev },
  };
}

/** 수정안을 적용했거나 버렸다고 기록한다. 요청한 사람만, 완료된 수정안만 */
export function closedRevision(
  job: Job,
  outcome: 'applied' | 'dismissed',
  user: { uid: string; name: string },
  now: string,
): CaseReviseJob {
  if (job.kind !== 'case_revise') throw new RuleError('케이스 수정안 작업이 아닙니다.');
  if (job.requestedBy !== user.uid) throw new PermissionError('요청한 사람만 수정안을 처리할 수 있습니다.');
  if (job.status !== 'done') throw new RuleError('완료된 수정안만 처리합니다.');
  return { ...job, outcome: { kind: outcome, by: user.name, at: now } };
}

/** 생성 진행 목록의 순서 (두 구현 공통): 스펙은 묶음 순서, 기록은 오래된 것 먼저, 초안은 TC ID 순 */
export const jobPartOrder = {
  specs: (a: QaDocJobSpec, b: QaDocJobSpec) => a.order - b.order,
  events: (a: QaDocJobEvent, b: QaDocJobEvent) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1),
  drafts: (a: QaDocJobDraft, b: QaDocJobDraft) => (a.tcId < b.tcId ? -1 : a.tcId > b.tcId ? 1 : 0),
};

/**
 * 웹에서 내 호스트로 Run 시작 요청 (작업 kind `run_cycle`). 호스트가 받아 로컬 콘솔과 같은 경로로 시작한다.
 * 고른 케이스가 비어 있으면 남은 자동 케이스 전체다
 */
export function runRequest(
  projectId: string,
  input: RequestRunInput,
  user: { uid: string; name: string },
  now: string,
  jobId: string,
): RunCycleJob {
  return {
    id: jobId,
    projectId,
    kind: 'run_cycle',
    requestedBy: user.uid,
    requestedByName: user.name,
    createdAt: now,
    status: 'queued',
    input: {
      cycleId: input.cycleId,
      deviceId: input.deviceId,
      ...(input.tcIds?.length ? { tcIds: input.tcIds } : {}),
      ...(input.resumeRunId ? { resumeRunId: input.resumeRunId } : {}),
    },
  };
}

/**
 * 빌드 문서 (F-DV-05). `inspectApk` 결과로 만든다. 같은 파일(SHA-256)을 이미 올렸으면 `RuleError`.
 */
export function newBuild(
  projectId: string,
  info: ApkInfo,
  fileName: string,
  existing: Build[],
  user: { name: string },
  now: string,
  id: string,
): Build {
  const dup = existing.find((b) => b.fileSha256 === info.fileSha256);
  if (dup) throw new RuleError(`이미 올린 빌드입니다: ${dup.version} (${dup.buildNumber})`);
  const safeName = fileName.replace(/[^\w.-]+/g, '_') || 'app.apk';
  return {
    id,
    version: info.versionName ?? String(info.versionCode),
    buildNumber: info.versionCode,
    packageName: info.packageName,
    signingSha1: info.signing.sha1,
    signingSha256: info.signing.sha256,
    signingSchemes: info.signing.schemes,
    ...(info.minSdk !== undefined ? { minSdk: info.minSdk } : {}),
    fileName,
    fileSha256: info.fileSha256,
    size: info.size,
    storagePath: `projects/${projectId}/builds/${id}/${safeName}`,
    uploadedBy: user.name,
    uploadedAt: now,
  };
}

/** 대상 디바이스 id: `galaxy-s24-15` */
export const targetId = (model: string, osMajor: number) =>
  `${model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${osMajor}`;

/**
 * 사이클 만들기 (F-CY-01·02): 승인된 케이스만 스냅샷(TC ID + 내용 해시)으로 고정하고 칸마다 N/T 결과를 만든다.
 * 케이스 내용은 복사해 둔다(cases) — 사이클을 만든 뒤 QA 문서를 고쳐도 이 사이클은 만들 때 내용으로 실행한다.
 * 삭제 판정 케이스는 넣지 않는다.
 */
export function newCycle(
  projectId: string,
  input: NewCycleInput,
  doc: QADocument,
  build: Build,
  user: { name: string },
  now: string,
  id: string,
): { cycle: TestCycle; cases: TestCase[]; results: CaseResult[] } {
  const name = input.name.trim();
  if (!name) throw new RuleError('사이클 이름을 입력하세요.');
  const targets: TargetDevice[] = [];
  for (const t of input.targets) {
    const model = t.model.trim();
    if (!model || !Number.isInteger(t.osMajor) || t.osMajor < 1)
      throw new RuleError('대상 디바이스는 모델과 OS 메이저 버전이 필요합니다.');
    const tid = targetId(model, t.osMajor);
    if (targets.some((x) => x.id === tid)) continue;
    targets.push({
      id: tid,
      model,
      osMajor: t.osMajor,
      resolution: t.resolution ?? '—',
      label: `${model} (Android ${t.osMajor})`,
    });
  }
  if (!targets.length) throw new RuleError('대상 디바이스를 하나 이상 고르세요.');
  const approved = doc.cases.filter((c) => c.change !== 'removed' && c.approval.status === 'approved');
  if (!approved.length)
    throw new RuleError('승인된 케이스가 없습니다. QA 문서에서 케이스를 승인한 뒤 사이클을 만드세요.');
  const cycle: TestCycle = {
    id,
    projectId,
    name,
    docId: doc.id,
    buildId: build.id,
    targets,
    period: { start: now },
    serverEnv: input.serverEnv,
    snapshot: approved.map((c) => ({ tcId: c.tcId, contentHash: c.contentHash })),
    createdBy: user.name,
  };
  const results: CaseResult[] = targets.flatMap((t) =>
    approved.map((c) => ({
      tcId: c.tcId,
      deviceId: t.id,
      verdict: 'nt' as const,
      autoConfirmed: false,
      unmetConditions: [],
      attempts: 0,
      steps: [],
      points: [],
      history: [],
    })),
  );
  return { cycle, cases: structuredClone(approved), results };
}
