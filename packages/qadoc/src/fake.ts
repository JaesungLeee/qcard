import type { LlmClient, LlmRequest } from '@qcard/llm';
import type { GenCase, ReviseOutput, SpecPlanOutput } from './prompts';

/*
 * 테스트용 가짜 생성 모델 (QA Doc Generator). 실제 모델 없이 생성 흐름·저장·작업 처리를 시험한다.
 * 프롬프트에서 행 ID를 읽어 행마다 정해진 케이스를 돌려준다.
 *   - 스펙 계획: 준비 플로우 pf-home·원복 플로우 pf-undo(없으면 새로), 모든 행 [pf-home, pf-clean, pf-nope]
 *     (코드가 순서·없는 ID를 바로잡는지). EC-001은 원복 pf-undo, TS-002는 원복이 아닌 pf-home을 원복으로 잘못 지정
 *   - 케이스: TS-003은 iOS 전용(제외), EC-001은 확인 질문 1개·계정 종류 ` 구독자 `, TS-002는 스펙에 있는 버튼 이름 + 지어낸 이름([다음])
 *   - drop: 그 행을 첫 응답에서 뺀다 · failOn: n번째 호출에서 오류를 던진다
 */
/** 요청을 보고 답하는 가짜 모델. 스펙 계획인지 케이스 변환인지는 출력 스키마로 구분한다 */
export function fakeGeneratorLlm(opts: { drop?: string; failOn?: { call: number; error: Error } } = {}) {
  const calls: { kind: 'plan' | 'case'; prompt: string }[] = [];
  let dropped = false;
  const llm: LlmClient = {
    async create(req: LlmRequest) {
      const prompt = req.messages[0]!.content as string;
      const schema = JSON.stringify(req.output_config?.format);
      const kind = schema.includes('prep_flows') ? 'plan' : 'case';
      calls.push({ kind, prompt });
      if (opts.failOn && calls.length === opts.failOn.call) throw opts.failOn.error;
      let out: unknown;
      if (kind === 'plan') {
        const ids = prompt.split('## 대상 행')[1]!.split('\n')[1]!.split(', ');
        const plan: SpecPlanOutput = {
          prep_flows: prompt.includes('pf-home ·')
            ? []
            : [
                { id: 'pf-home', name: '홈 진입', kind: 'data_state', check: '홈', steps: ['[시작하기]'] },
                { id: 'pf-undo', name: '설정 되돌리기', kind: 'restore', check: '기본 설정', steps: ['[시작하기]'] },
              ],
          // 초기화를 뒤에 두거나 없는 플로우를 가리켜도 코드가 바로잡는다
          rows: ids.map((row_id) => ({
            row_id,
            prep_flow_ids: ['pf-home', 'pf-clean', 'pf-nope'],
            restore_flow_id: row_id === 'EC-001' ? 'pf-undo' : row_id === 'TS-002' ? 'pf-home' : null,
          })),
          suggestions: [{ requirement_id: 'FR-002', technique: 'negative', text: '뒤로가기 TS가 없습니다.' }],
        };
        out = plan;
      } else {
        let ids = [...prompt.matchAll(/^\[((?:TS|EC)-\d+)\]/gm)].map((m) => m[1]!);
        if (opts.drop && !dropped && ids.includes(opts.drop)) {
          dropped = true;
          ids = ids.filter((id) => id !== opts.drop);
        }
        const cases: GenCase[] = ids.map((row_id) => ({
          row_id,
          title: `${row_id} 제목`,
          preconditions: ['처음 설치함'],
          data: null,
          account_kind: row_id === 'EC-001' ? ' 구독자 ' : null,
          steps:
            row_id === 'TS-002'
              ? [
                  { text: '[시작하기]를 누른다', manual: false, risk: null },
                  { text: '[다음]을 누른다', manual: false, risk: null },
                ]
              : [{ text: '앱을 연다', manual: false, risk: null }],
          points: [{ target: '버튼 개수', compare: 'count', expected: '2', method: 'tree' }],
          priority: 'medium',
          type: 'functional',
          platform: row_id === 'TS-003' ? 'ios' : 'common',
          mode: 'auto',
          questions: row_id === 'EC-001' ? [{ requirement_id: 'FR-001', text: '재시도 안내는 모달인가요?' }] : [],
        }));
        out = { cases };
      }
      return {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: req.model,
        content: [{ type: 'text', text: JSON.stringify(out), citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never;
    },
  };
  return { llm, calls };
}

/** 테스트용 가짜 수정안 모델 (F-QD-17). 정해진 응답을 차례로 돌려주고 받은 프롬프트를 남긴다 */
export function fakeReviseLlm(...outs: (ReviseOutput | string)[]) {
  const prompts: string[] = [];
  const llm: LlmClient = {
    async create(req: LlmRequest) {
      prompts.push(req.messages[0]!.content as string);
      const out = outs[Math.min(prompts.length, outs.length) - 1]!;
      return {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: req.model,
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out), citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never;
    },
  };
  return { llm, prompts };
}
