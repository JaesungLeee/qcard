import { CaseBody, DEFAULT_ACCOUNT_KIND, type PrepFlow } from '@qcard/shared';
import type { SpecDoc, SpecRow } from '@qcard/spec';
import type { GenCase } from './prompts';

// 생성(generate)과 수정안(revise)이 같이 쓰는 조립·프롬프트 도우미. 패키지 밖으로 내보내지 않는다

/** 행의 시작 상태 (스펙 계획 결과). `login`: 로그인 준비 플로우를 쓴다 — 테스트 계정이 있어야 한다 */
export type Start = { prepFlowIds: string[]; cleanState: boolean; restoreFlowId?: string; login?: boolean };

/** 필요 계정 종류. 로그인 준비 플로우를 쓰는데 종류가 없으면 기본 종류로 채운다 (F-QD-04) */
const accountKindOf = (g: GenCase, start: Start) =>
  g.account_kind?.trim() || (start.login ? DEFAULT_ACCOUNT_KIND : undefined);

export function bodyOf(g: GenCase, tcId: string, start: Start): CaseBody {
  return CaseBody.parse({
    title: g.title,
    preconditions: g.preconditions,
    prepFlowIds: start.prepFlowIds,
    cleanState: start.cleanState,
    ...(accountKindOf(g, start) ? { accountKind: accountKindOf(g, start) } : {}),
    ...(start.restoreFlowId ? { restoreFlowId: start.restoreFlowId } : {}),
    ...(g.data ? { data: g.data } : {}),
    // 사람 전용 단계는 실행자가 직접 하는 수동 스텝이다
    steps: g.steps.map((s) => ({
      text: s.text,
      manual: s.manual || s.risk === 'human',
      ...(s.risk ? { risk: s.risk } : {}),
    })),
    verificationPoints: g.points.map((p, i) => ({
      id: `${tcId}-P${i + 1}`,
      target: p.target,
      compare: p.compare,
      // 개수 포인트가 숫자만 오면 문장으로 바꾼다
      expected: /^\d+$/.test(p.expected.trim()) ? `${p.target} ${p.expected.trim()}개` : p.expected,
      method: p.method,
    })),
    priority: g.priority,
    type: g.type,
    platform: g.platform,
    mode: g.mode,
  });
}

/** 스펙에 쓰인 글 (버튼 이름의 근거) */
export function specSources(spec: SpecDoc): string[] {
  return [...spec.requirements.map((r) => r.text), ...spec.rows.flatMap((r) => [r.title, r.given, r.when, r.then])];
}

// 프롬프트 본문

export function rowText(row: SpecRow, spec: SpecDoc): string {
  const reqs = row.frs.map((f) => `  - ${f}: ${spec.requirements.find((r) => r.id === f)?.text ?? '(문서에 없음)'}`);
  return [
    `[${row.id}] ${row.title}  (${row.kind === 'TS' ? '테스트 시나리오' : '엣지 케이스'} · 유저 플로우 "${row.flow}")`,
    ...(row.kind === 'TS' ? [`Given: ${row.given || '—'}`, `When: ${row.when}`, `Then: ${row.then}`] : []),
    ...(row.kind === 'EC' ? [`상황: ${row.when}`, `처리: ${row.then}`] : []),
    `관련 요구사항:`,
    ...reqs,
  ].join('\n');
}

export const flowText = (f: PrepFlow) =>
  `- ${f.id} · ${f.name} (${f.kind})\n  확인: ${f.check}\n  스텝: ${f.steps.join(' → ') || '—'}`;
