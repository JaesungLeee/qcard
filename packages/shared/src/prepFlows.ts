import type { Member, PrepFlow, PrepFlowKind, TestCase, TestCycle } from './domain';
import { MembershipError, requireEditor, type Actor } from './membership';

/*
 * 준비 플로우 편집 규칙. 메모리 구현·Firestore 구현·Cloud Functions(삭제)가 같은 함수를 쓰고,
 * 화면은 삭제를 막는 이유를 미리 보인다. 플로우는 QA 문서 버전마다 사본을 두어 편집은 그 버전에만 적용되고,
 * 사이클 스냅샷에는 들어가지 않아 그 버전으로 만든 사이클에는 다음 Run부터 적용된다.
 */

const rule = (m: string) => new MembershipError('rule', m);

/** 웹에서 사람이 고치는 값 */
export type PrepFlowInput = Pick<PrepFlow, 'name' | 'kind' | 'check' | 'steps'>;

/** 앞뒤 공백을 떼고 빈 스텝을 뺀다. `env` 스텝은 코드가 수행하는 일의 설명이라 없어도 된다 */
export function cleanPrepFlowInput(input: PrepFlowInput): PrepFlowInput {
  return {
    name: input.name.trim(),
    kind: input.kind,
    check: input.check.trim(),
    steps: input.steps.map((s) => s.trim()).filter(Boolean),
  };
}

/** 저장할 수 없는 이유. 없으면 저장할 수 있다 */
export function prepFlowProblem(input: PrepFlowInput): string | undefined {
  const c = cleanPrepFlowInput(input);
  if (!c.name) return '이름을 입력하세요.';
  if (!c.check) return '확인 조건을 입력하세요.';
  if (c.kind !== 'env' && c.steps.length === 0) return '수행 스텝을 1개 이상 입력하세요.';
  return undefined;
}

const KIND_SLUG: Record<PrepFlowKind, string> = { login: 'login', data_state: 'data', env: 'env', restore: 'restore' };

/** 새 플로우 id: `pf-<종류>`, 겹치면 `-2`, `-3`… (QA 문서 생성이 만드는 id와 같은 형식) */
export function prepFlowIdFor(kind: PrepFlowKind, taken: (id: string) => boolean): string {
  const base = `pf-${KIND_SLUG[kind]}`;
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

function valid(input: PrepFlowInput): PrepFlowInput {
  const problem = prepFlowProblem(input);
  if (problem) throw rule(problem);
  return cleanPrepFlowInput(input);
}

/** 플로우 추가: Admin·QA만 */
export function newPrepFlow(
  members: Member[],
  actor: Pick<Actor, 'uid' | 'name'>,
  input: PrepFlowInput,
  existing: PrepFlow[],
  now: string,
): PrepFlow {
  requireEditor(members, actor.uid);
  const body = valid(input);
  const id = prepFlowIdFor(body.kind, (x) => existing.some((f) => f.id === x));
  return { id, ...body, rev: 1, updatedBy: actor.name, updatedAt: now };
}

/** 플로우 편집: Admin·QA만. rev 확인(충돌)은 구현이 먼저 한다 */
export function prepFlowChange(
  members: Member[],
  actor: Pick<Actor, 'uid' | 'name'>,
  current: PrepFlow,
  input: PrepFlowInput,
  now: string,
): PrepFlow {
  requireEditor(members, actor.uid);
  return { ...current, ...valid(input), rev: (current.rev ?? 0) + 1, updatedBy: actor.name, updatedAt: now };
}

/** 플로우를 참조하는 케이스 하나: QA 문서의 케이스이거나, 완료되지 않은 사이클의 케이스 사본 */
export type PrepFlowUse = { tcId: string } & (
  { in: 'doc'; docId: string; appVersion: string } | { in: 'cycle'; cycleId: string; cycleName: string }
);

const refs = (c: TestCase) => [...c.prepFlowIds, ...(c.restoreFlowId ? [c.restoreFlowId] : [])];
const active = (cases: TestCase[]) => cases.filter((c) => c.change !== 'removed');

/**
 * 새 QA 문서가 이전 버전에서 이어받을 플로우: 활성 케이스가 참조하는 것만, 목록 순서 그대로.
 * 쓰이지 않게 된 플로우는 이전 버전에만 남는다
 */
export function flowsUsedBy(flows: PrepFlow[], cases: TestCase[]): PrepFlow[] {
  const used = new Set(active(cases).flatMap(refs));
  return flows.filter((f) => used.has(f.id));
}

/**
 * 이전의 프로젝트 공용 목록을 QA 문서 버전별 사본으로 나눈다: 그 버전의 케이스가 참조하는 플로우를 버전마다,
 * 어느 케이스도 참조하지 않는 플로우(사람이 만들고 아직 연결하지 않은 것)는 최신 버전에. 문서가 없으면 빈 결과
 */
export function splitPrepFlowsByDoc(
  flows: PrepFlow[],
  docs: { id: string; createdAt: string; cases: TestCase[] }[],
): Record<string, PrepFlow[]> {
  const latest = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return {};
  const out: Record<string, PrepFlow[]> = Object.fromEntries(docs.map((d) => [d.id, flowsUsedBy(flows, d.cases)]));
  const used = new Set(Object.values(out).flatMap((fs) => fs.map((f) => f.id)));
  const own = out[latest.id]!;
  out[latest.id] = flows.filter((f) => own.includes(f) || !used.has(f.id));
  return out;
}

/**
 * QA 문서 한 버전의 플로우별 사용처: 그 버전의 활성 케이스 + 그 버전으로 만든 완료되지 않은 사이클의 케이스 사본.
 * 진행 중 사이클의 다음 Run이 플로우를 찾지 못하는 일이 없게 사이클 사본도 본다
 */
export function prepFlowUses(
  doc: { id: string; appVersion: string; cases: TestCase[] },
  cycles: { cycle: TestCycle; cases: TestCase[] }[],
): Record<string, PrepFlowUse[]> {
  const out: Record<string, PrepFlowUse[]> = {};
  const add = (id: string, use: PrepFlowUse) => (out[id] ??= []).push(use);
  for (const c of active(doc.cases)) {
    for (const id of new Set(refs(c))) add(id, { tcId: c.tcId, in: 'doc', docId: doc.id, appVersion: doc.appVersion });
  }
  // 새 사이클 먼저 (읽는 순서와 상관없이 같은 결과)
  const newest = [...cycles].sort((a, b) => b.cycle.period.start.localeCompare(a.cycle.period.start));
  for (const { cycle, cases } of newest) {
    if (cycle.docId !== doc.id || !cycleUsesFlows(cycle)) continue;
    for (const c of cases) {
      for (const id of new Set(refs(c))) {
        add(id, { tcId: c.tcId, in: 'cycle', cycleId: cycle.id, cycleName: cycle.name });
      }
    }
  }
  return out;
}

/** 아직 Run을 받을 수 있는 사이클 (완료·삭제 중·로컬 실행 묶음 제외) */
export const cycleUsesFlows = (c: TestCycle) => !c.period.end && !c.deletingAt && c.origin !== 'local_run';

/** 삭제를 막는 이유. 없으면 삭제할 수 있다 */
export function prepFlowDeleteBlocker(uses: PrepFlowUse[]): string | undefined {
  if (uses.length === 0) return undefined;
  const where = [...new Set(uses.map((u) => (u.in === 'doc' ? `QA 문서 ${u.appVersion}` : `사이클 “${u.cycleName}”`)))];
  return `${uses.length}개 케이스가 사용 중이라 삭제할 수 없습니다(${where.join(', ')}). 케이스에서 이 플로우를 뺀 뒤 삭제하세요.`;
}

/** 플로우 삭제: Admin·QA만, 참조하는 케이스가 없어야 한다 */
export function prepFlowDeletion(members: Member[], actor: Pick<Actor, 'uid'>, uses: PrepFlowUse[]): void {
  requireEditor(members, actor.uid);
  const blocker = prepFlowDeleteBlocker(uses);
  if (blocker) throw rule(blocker);
}
