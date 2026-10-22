import { z } from 'zod';

/*
 * Agent(Executor·Verifier)가 LLM과 주고받는 형식. LLM 도구 정의(`@qcard/llm`의 `toTool`)와
 * 응답 검증에 같은 스키마를 쓴다. strict 도구·structured output은 선택 필드를 피해야 하므로
 * 모든 필드를 필수로 두고, 값이 없을 수 있으면 null을 허용한다.
 */

/** 접근성 트리 요소 참조: 트리 텍스트의 `e12` 같은 번호 또는 resource-id */
const elementRef = z.string().describe('접근성 트리의 요소 번호(예: e12) 또는 resource-id');
const intent = z.string().describe('이 액션을 하는 이유 (스텝 타임라인의 "의도"로 기록된다)');

export const TapInput = z.object({ element_ref: elementRef, intent });
export const TapPointInput = z.object({
  x: z.number().int().describe('디바이스 px'),
  y: z.number().int().describe('디바이스 px'),
  intent,
});
export const InputTextInput = z.object({
  element_ref: elementRef,
  text: z.string().describe('입력할 값. 비밀값은 {{secret.이름}} 플레이스홀더로 쓴다'),
  intent,
});
export const SwipeInput = z.object({ direction: z.enum(['up', 'down', 'left', 'right']), intent });
export const PressKeyInput = z.object({ key: z.enum(['back', 'home', 'enter']), intent });
export const RestartAppInput = z.object({ intent });
export const ReopenAppInput = z.object({ intent });
/** 환경 조작 (F-EX-16). 케이스가 끝나면 자동으로 원래대로 켠다 */
export const SetNetworkInput = z.object({
  wifi: z.boolean().describe('Wi-Fi를 켤지'),
  data: z.boolean().describe('모바일 데이터를 켤지'),
  intent,
});
export const WaitInput = z.object({ seconds: z.number().int().min(1).max(10), intent });
export const StepDoneInput = z.object({
  case_step_index: z.number().int().describe('끝낸 케이스 단계 번호 (0부터)'),
  summary: z.string(),
});
/** 스크린샷 요청 (F-EX-02: 트리 우선, 비전 보조) */
export const ViewScreenInput = z.object({ reason: z.string().describe('트리만으로 알 수 없는 것') });
/** Agent가 진행할 수 없을 때. 종류는 F-EX-05의 Blocked 조건과 앱 크래시(Fail) */
export const GiveUpInput = z.object({
  kind: z.enum(['crash', 'prep_failed', 'env_unavailable', 'stuck', 'environment_error']),
  reason: z.string(),
});

/** Executor 도구 이름 → 입력 스키마 */
export const EXECUTOR_TOOL_INPUTS = {
  tap: TapInput,
  tap_point: TapPointInput,
  input_text: InputTextInput,
  swipe: SwipeInput,
  press_key: PressKeyInput,
  restart_app: RestartAppInput,
  reopen_app: ReopenAppInput,
  set_network: SetNetworkInput,
  wait: WaitInput,
  view_screen: ViewScreenInput,
  step_done: StepDoneInput,
  give_up: GiveUpInput,
} as const;
export type ExecutorToolName = keyof typeof EXECUTOR_TOOL_INPUTS;
export type ExecutorToolInput<N extends ExecutorToolName> = z.infer<(typeof EXECUTOR_TOOL_INPUTS)[N]>;

export const EXECUTOR_TOOL_DESCRIPTIONS: Record<ExecutorToolName, string> = {
  tap: '접근성 트리의 요소를 탭한다. 요소가 트리에 있으면 tap_point보다 이것을 쓴다.',
  tap_point: '트리에 없는 요소를 스크린샷 좌표로 탭한다.',
  input_text: '요소를 탭해 포커스한 뒤 텍스트를 입력한다.',
  swipe: '화면 가운데에서 지정 방향으로 쓸어넘긴다. left는 다음 페이지, up은 아래 내용 보기.',
  press_key: '시스템 키를 누른다.',
  restart_app: '테스트 대상 앱을 강제 종료했다가 다시 실행한다 (데이터는 유지).',
  reopen_app: '백그라운드로 간 테스트 대상 앱을 종료하지 않고 다시 앞으로 가져온다 (최근 앱에서 다시 여는 것과 같다).',
  set_network:
    '디바이스 네트워크를 켜거나 끈다. 네트워크 실패 상황을 만들 때만 쓴다. 케이스가 끝나면 자동으로 다시 켜진다. 허용되지 않은 실행이면 에러가 난다.',
  wait: '로딩·애니메이션이 끝나기를 기다린다.',
  view_screen:
    '지금 화면의 스크린샷을 본다. 트리로 알 수 없을 때만 쓴다: 글자 없는 아이콘 버튼, 이미지·색·배치, 트리가 비었거나 화면과 안 맞아 보일 때.',
  step_done: '케이스 단계 하나를 끝냈다고 알린다. 다음 단계로 넘어가기 전에 부른다.',
  give_up: '더 진행할 수 없을 때 이유와 함께 멈춘다.',
};

/** 비전 검증 포인트 판정 (F-EX-03). 트리 포인트는 요소만 찾고 값 비교는 코드가 한다. */
export const VerifierOutput = z.object({
  result: z.enum(['match', 'mismatch', 'unknown']),
  observed: z.string().describe('화면에서 실제로 본 것'),
  reason: z.string(),
  target_element: z.string().nullable().describe('판정 근거가 된 요소 참조. 없으면 null'),
});
export type VerifierOutput = z.infer<typeof VerifierOutput>;

/** 트리 검증 포인트의 대상 요소 찾기 결과 */
export const LocateOutput = z.object({
  /** found: 찾음 · absent: 화면에 없음 · unclear: 화면만으로 알 수 없음(판단불가) */
  status: z.enum(['found', 'absent', 'unclear']),
  element_ref: z.string().nullable().describe('찾은 요소 참조(관찰 번호가 붙은 o7.e6 형태 그대로). found가 아니면 null'),
  reason: z.string(),
});
export type LocateOutput = z.infer<typeof LocateOutput>;

/** 트리 포인트 여러 개를 한 번에 찾는다 (케이스당 호출 1번) */
export const LocateBatchOutput = z.object({
  points: z.array(LocateOutput.extend({ point_id: z.string() })),
});
export type LocateBatchOutput = z.infer<typeof LocateBatchOutput>;

/** 비전 포인트 여러 개를 한 번에 판정한다 */
export const VerifyBatchOutput = z.object({
  points: z.array(VerifierOutput.extend({ point_id: z.string() })),
});
export type VerifyBatchOutput = z.infer<typeof VerifyBatchOutput>;
