import type { Build, CaseResult, Defect, DefectRetest, Member, TestCycle } from './domain';
import { traceUrlOf } from './issues';
import { MembershipError, requireEditor, type Actor } from './membership';

/*
 * 결함 재테스트 규칙 (docs/product/results.md#재테스트). 이전 사이클의 fixed 결함을 더 새 빌드 사이클의 같은 칸
 * (TC ID × 같은 모델·OS 메이저)에서 다시 확인한다. 화면·메모리 구현·Functions가 같은 함수를 쓴다.
 */

const rule = (m: string) => new MembershipError('rule', m);

/** 재테스트할 결함과 그 결함이 난 사이클·빌드 */
export type RetestSource = { cycle: TestCycle; build: Build; defect: Defect };

/** 더 새 빌드: 패키지명이 같고 빌드 번호(versionCode)가 더 크다. 수정이 실제로 들어갔는지는 알지 못한다 */
export const isNewerBuild = (
  older: Pick<Build, 'packageName' | 'buildNumber'>,
  newer: Pick<Build, 'packageName' | 'buildNumber'>,
) => older.packageName === newer.packageName && newer.buildNumber > older.buildNumber;

/** 재테스트를 받는 사이클이 될 수 있는가 (로컬 실행 묶음·삭제 중인 사이클은 아니다) */
export const retestsIn = (c: Pick<TestCycle, 'origin' | 'deletingAt'>) => c.origin !== 'local_run' && !c.deletingAt;

/**
 * 사이클 `b`의 재테스트 목록에 넣는가: 다른 사이클의 fixed 결함이고 `b`의 빌드가 더 새 빌드다.
 * 이미 `b`에서 확정한 결함은 상태가 바뀌어도 목록에 남는다 (확정 결과를 보인다)
 */
export function isRetestTarget(src: RetestSource, b: { cycle: TestCycle; build: Build }): boolean {
  if (src.cycle.id === b.cycle.id || !retestsIn(b.cycle) || src.cycle.deletingAt) return false;
  if (src.defect.retests?.some((x) => x.cycleId === b.cycle.id)) return true;
  return src.defect.status === 'fixed' && isNewerBuild(src.build, b.build);
}

export type RetestCell =
  | { kind: 'found'; tcId: string; deviceId: string; deviceLabel: string; caseChanged: boolean }
  | { kind: 'no_case' }
  | { kind: 'no_device' };

/** 재테스트 칸: `b`의 스냅샷에서 같은 TC ID, 결함 디바이스와 모델·OS 메이저가 같은 `b`의 대상 디바이스 */
export function retestCell(
  src: Pick<RetestSource, 'cycle' | 'defect'>,
  b: Pick<TestCycle, 'snapshot' | 'targets'>,
): RetestCell {
  const { defect } = src;
  const snap = b.snapshot.find((s) => s.tcId === defect.tcId);
  if (!snap) return { kind: 'no_case' };
  const from = src.cycle.targets.find((t) => t.id === defect.deviceId);
  const to = from && b.targets.find((t) => t.model === from.model && t.osMajor === from.osMajor);
  if (!to) return { kind: 'no_device' };
  const before = src.cycle.snapshot.find((s) => s.tcId === defect.tcId);
  return {
    kind: 'found',
    tcId: defect.tcId,
    deviceId: to.id,
    deviceLabel: to.label,
    caseChanged: !!before && before.contentHash !== snap.contentHash,
  };
}

export const RETEST_CELL_LABEL = { no_case: '케이스 없음', no_device: '대상 디바이스 없음' } as const;

/**
 * 재테스트 칸의 최종 판정 읽기. Pass는 자동 확정이든 사람 확정이든 Pass, Fail은 사람이 확정해야 Fail이다
 * (Agent Fail은 사람 확정 전이다). 그 밖의 판정·결과 없음은 남은 것
 */
export type RetestReading = 'pass' | 'fail' | 'fail_unconfirmed' | 'pending';
export function retestReading(r: Pick<CaseResult, 'verdict' | 'decidedBy'> | undefined): RetestReading {
  if (r?.verdict === 'pass') return 'pass';
  if (r?.verdict === 'fail') return r.decidedBy?.kind === 'human' ? 'fail' : 'fail_unconfirmed';
  return 'pending';
}

/** 이 결함을 사이클 `b`에서 확정한 마지막 기록 */
export const retestRecordIn = (defect: Pick<Defect, 'retests'>, cycleId: string) =>
  defect.retests?.findLast((x) => x.cycleId === cycleId);

/** `b`의 재테스트 칸 결과가 이 결함을 가리키는가 (다시 열 때 칸에 연결한다) */
export const pointsTo = (
  r: Pick<CaseResult, 'defectId' | 'defectCycleId'>,
  src: { cycleId: string; defectId: string },
) => r.defectId === src.defectId && r.defectCycleId === src.cycleId;

export type RetestTo = DefectRetest['to'];

/**
 * 재테스트 확정 (Functions confirmRetest·메모리 구현 공용). Admin·QA만. 결함이 아직 fixed이고, 칸 결과가
 * closed면 Pass·open이면 사람 확정 Fail이어야 한다. 다시 열 때 칸에 다른 결함이 연결돼 있으면 막는다 — 증상이 달라
 * 새 결함을 만든 칸이다. 이 사이클에서 이미 확정한 결함은 다시 fixed가 돼도 막는다 — 칸 결과가 고치기 전 빌드의
 * 것이라 다음 새 빌드 사이클에서 재테스트한다. 돌려주는 값: 결함에 남길 기록, 칸에 결함을 연결할지
 */
export function retestConfirmation(input: {
  members: Member[];
  actor: Actor;
  projectId: string;
  src: RetestSource;
  b: { cycle: TestCycle; build: Build };
  result: CaseResult | undefined;
  to: RetestTo;
  at: string;
}): { record: DefectRetest; linkCell: boolean } {
  const { src, b, result, to } = input;
  requireEditor(input.members, input.actor.uid);
  const label = `${src.cycle.name} ${src.defect.id}`;
  if (src.cycle.id === b.cycle.id) throw rule('같은 사이클의 결함은 재테스트로 확정하지 않습니다.');
  if (!retestsIn(b.cycle)) throw rule(`${b.cycle.name}은(는) 재테스트를 받지 않는 사이클입니다.`);
  if (src.cycle.deletingAt) throw rule(`${src.cycle.name}은(는) 삭제 중인 사이클입니다.`);
  if (retestRecordIn(src.defect, b.cycle.id))
    throw rule(`${label}은(는) 이미 ${b.cycle.name}에서 재테스트로 확정했습니다. 다음 새 빌드 사이클에서 재테스트하세요.`);
  if (src.defect.status !== 'fixed')
    throw rule(`${label}은(는) 지금 fixed가 아닙니다. 목록을 새로 본 뒤 다시 확정하세요.`);
  if (!isNewerBuild(src.build, b.build))
    throw rule(`${b.cycle.name}의 빌드가 ${label}이(가) 난 빌드보다 새 빌드가 아닙니다.`);
  const cell = retestCell(src, b.cycle);
  if (cell.kind !== 'found')
    throw rule(`${RETEST_CELL_LABEL[cell.kind]}: 재테스트로 확정할 수 없습니다. 결함 상태를 직접 바꾸세요.`);
  const reading = retestReading(result);
  if (to === 'closed' && reading !== 'pass') throw rule('재테스트 칸이 Pass일 때만 closed로 확정합니다.');
  if (to === 'open') {
    if (reading === 'fail_unconfirmed') throw rule('재테스트 칸의 Fail을 먼저 사람이 확정하세요.');
    if (reading !== 'fail') throw rule('재테스트 칸이 Fail일 때만 다시 엽니다.');
  }
  const ref = { cycleId: src.cycle.id, defectId: src.defect.id };
  if (to === 'open' && result?.defectId && !pointsTo(result, ref))
    throw rule(
      `이 칸에는 이미 결함 ${result.defectId}이(가) 연결돼 있습니다. 같은 증상이면 ${label}의 상태를 결함 사이클에서 직접 바꾸세요.`,
    );
  const record: DefectRetest = {
    cycleId: b.cycle.id,
    cycleName: b.cycle.name,
    build: { version: b.build.version, buildNumber: b.build.buildNumber },
    tcId: cell.tcId,
    deviceId: cell.deviceId,
    deviceLabel: cell.deviceLabel,
    verdict: to === 'closed' ? 'pass' : 'fail',
    to,
    traceUrl: traceUrlOf({ projectId: input.projectId, cycleId: b.cycle.id, tcId: cell.tcId, deviceId: cell.deviceId }),
    by: input.actor.name,
    at: input.at,
  };
  return { record, linkCell: to === 'open' && !result?.defectId };
}
