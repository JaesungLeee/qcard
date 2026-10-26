import { CaseBody, type PrepFlow } from '@qcard/shared';
import type { SpecDoc, SpecRow } from '@qcard/spec';
import type { GenCase } from './prompts';

// 생성(generate)과 수정안(revise)이 같이 쓰는 조립·프롬프트 도우미. 패키지 밖으로 내보내지 않는다

/** 행의 시작 상태 (스펙 계획 결과) */
export type Start = { prepFlowIds: string[]; cleanState: boolean; restoreFlowId?: string };

export function bodyOf(g: GenCase, tcId: string, start: Start): CaseBody {
  return CaseBody.parse({
    title: g.title,
    preconditions: g.preconditions,
    prepFlowIds: start.prepFlowIds,
    cleanState: start.cleanState,
    ...(g.account_kind?.trim() ? { accountKind: g.account_kind.trim() } : {}),
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
