import type { LlmClient, LlmRequest } from '@qcard/llm';
import type { ReporterOutput } from './prompts';

/*
 * 테스트용 가짜 Reporter 모델. 정해진 응답(또는 프롬프트를 보고 만든 응답)을 돌려주고 받은 요청을 남긴다.
 * 실제 모델 없이 초안 후처리(선택지 거르기·빈 칸·제목 접두어)와 호스트 작업 처리를 시험한다
 */
export function fakeReporterLlm(answer: ReporterOutput | ((prompt: string) => ReporterOutput)) {
  const calls: LlmRequest[] = [];
  const llm: LlmClient = {
    async create(req: LlmRequest) {
      calls.push(req);
      const prompt = req.messages[0]!.content as string;
      const out = typeof answer === 'function' ? answer(prompt) : answer;
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
