import { ExecMode, PointCompare, PointMethod, Priority, SpecSuggestion, TestType } from '@qcard/shared';
import { z } from 'zod';

/*
 * QA Doc Generator 프롬프트와 출력 스키마 (docs/product/qa-doc.md, docs/architecture.md). 호출은 두 종류다.
 *   1. 스펙 계획 (스펙 하나당 1번): 준비·원복 플로우 추출·행별 시작 상태 지정·스펙 보강 제안
 *   2. 케이스 변환 (행 묶음마다): TS·EC 행 → 실행 가능한 케이스 + 스펙 확인 질문
 * 출력 스키마는 strict structured output으로 받으므로 선택 필드 대신 nullable을 쓴다.
 */

// ---------------------------------------------------------------- 1. 스펙 계획

export const GenPrepFlow = z.object({
  id: z.string().describe('새 준비 플로우 ID. `pf-` + 영문 소문자·숫자·하이픈. 예: pf-habit-2'),
  name: z.string().describe('만들어지는 상태 이름. 예: "습관 2개 보유", "온보딩 완료"'),
  kind: z.enum(['login', 'data_state', 'restore']),
  check: z.string().describe('준비가 끝났는지 화면 한 장으로 확인하는 조건 한 문장'),
  steps: z.array(z.string()).describe('대상 앱 안에서의 UI 수행 스텝. 직전 준비 플로우가 끝난 화면에서 시작한다'),
});
export type GenPrepFlow = z.infer<typeof GenPrepFlow>;

export const SpecPlanOutput = z.object({
  prep_flows: z.array(GenPrepFlow).describe('기존 목록에 없어 새로 필요한 준비 플로우만'),
  rows: z.array(
    z.object({
      row_id: z.string(),
      prep_flow_ids: z
        .array(z.string())
        .describe(
          '순서대로 수행할 준비 플로우 ID. 기존·새 플로우 모두 가능. 앱 데이터 초기화가 필요하면 맨 앞에 pf-clean',
        ),
      restore_flow_id: z
        .string()
        .nullable()
        .describe('이 행이 테스트 계정에 남는 상태를 바꾸면 그것을 되돌리는 restore 플로우 ID. 아니면 null'),
    }),
  ),
  suggestions: z.array(
    z.object({
      requirement_id: z.string().describe('FR-xxx 또는 UX-xxx (스펙 접두어 없이)'),
      technique: SpecSuggestion.shape.technique,
      text: z.string(),
    }),
  ),
});
export type SpecPlanOutput = z.infer<typeof SpecPlanOutput>;

const BUTTON_NAMES =
  '버튼은 [이름]으로 쓰되, 이름은 스펙(또는 기존 준비 플로우·이전 케이스)에 그대로 나오는 문구만 쓴다. 스펙에 문구가 없으면 지어내지 말고 대괄호 없이 화면과 역할로 쓴다(예: 닉네임 입력 화면 하단의 진행 버튼을 누른다). [다음]·[확인]·[완료]처럼 흔한 이름도 스펙에 없으면 쓰지 않는다.';

export const PLAN_SYSTEM = `너는 Android 앱 QA 리드다. 스펙 문서 하나(요구사항 FR·UX와 테스트 시나리오 TS·엣지 케이스 EC 표)를 받아 QA 문서를 만들 준비를 한다.
케이스 본문은 다른 단계에서 만든다. 여기서는 네 가지만 한다.

## 1. 준비 플로우 (공통 사전조건)
준비 플로우는 케이스 시작 전에 앱을 특정 "데이터·화면 상태"로 만드는 절차다. 프로젝트에서 공유되고 사람이 검토한다.
- 환경 준비는 코드가 제공하는 것만 쓴다: pf-clean = 대상 앱 데이터 초기화 후 실행(새 사용자). 다른 환경 준비는 만들지 않는다.
- 새로 만들 수 있는 것은 login(로그인), data_state(대상 앱 UI 조작으로 데이터·화면 상태를 만든다), restore(아래 원복 플로우)뿐이다. steps는 대상 앱 안의 조작만 쓴다.
- login 플로우는 실행할 때 배정되는 테스트 계정으로 로그인한다. steps에 실제 아이디·비밀번호를 쓰지 말고 "로그인 ID를 입력한다", "비밀번호를 입력한다"처럼 쓴다. 로그인이 없는 앱이면 login 플로우를 만들지 않는다.
- 기기 설정·다른 앱·OS를 바꾸는 조작(권한 허용·거부, 다른 앱 사용 중지·삭제, 최근 앱에서 제거, 알림 영역 조작, 시스템 설정 변경)은 준비 플로우에 절대 넣지 않는다. 그런 조건은 케이스 단계(필요하면 수동)에서 다룬다. 네트워크 끄기도 케이스 단계에서 한다.
- 준비 플로우는 "상태" 단위다. 같은 상태를 여러 케이스가 공유해야 한다. 예: "온보딩 완료", "습관 1개 보유", "습관 \`물 마시기\`에 체크 3번 기록". 상태에 이르는 경로·진입 버튼이 테스트 대상이면(예: 빈 화면 안내로 연 생성 폼, 플로팅 버튼으로 연 생성 폼) 그 경로는 케이스 단계로 쓰고, 준비 플로우는 그 앞의 공통 상태까지만 만든다.
- 기존 목록에 같은 상태를 만드는 플로우가 있으면 그것을 쓴다. 이름이 달라도 같은 상태면 재사용하고, 값만 다른 비슷한 상태(습관 2개/3개)는 한 플로우로 맞출 수 있으면 맞춘다.
- prep_flow_ids는 순서대로 이어서 수행된다. 보통 [pf-clean, 상태 플로우]다. data_state 플로우의 steps는 그 앞 플로우가 끝난 화면에서 시작한다.
- steps는 실제로 누를 버튼·입력할 값까지 구체적으로 쓴다. 입력값은 \`값\`. ${BUTTON_NAMES}
- check는 준비가 끝났음을 화면 한 장으로 확인하는 조건이다.
- 다른 사용자의 행동이나 서버만 바꿀 수 있는 데이터, 시간 경과는 준비 플로우로 만들지 않는다.

## 2. 행별 시작 상태
대상 행 목록의 모든 행에 대해 rows를 하나씩 낸다. 대상이 아닌 행은 맥락으로만 쓴다.
- 시작 상태는 Given만이 아니라 When을 수행하고 Then을 확인하는 데 필요한 데이터까지 갖춰야 한다. 예: 습관 카드를 누르는 행이면 습관이 있는 상태, 기록을 넘겨 보는 행이면 기록이 쌓인 상태, 메이트를 고르는 행이면 메이트가 있는 상태.
- 이전 케이스가 남긴 데이터가 결과를 바꿀 수 있으면 pf-clean으로 시작한다(첫 실행·빈 데이터 상태·개수가 중요한 경우 등). 대부분의 data_state는 pf-clean 뒤에 온다.

## 3. 원복 플로우 (restore)
로그인이 있는 앱의 테스트 계정은 여러 실행이 돌려 쓴다. 앱 데이터 초기화(pf-clean)는 기기 안의 데이터만 지우므로, 서버의 계정에 남는 변경(구독·요금제 전환, 계정 설정·프로필 변경, 권한·등급 변경 등)은 다음 실행에 남는다.
- 행의 When이 이런 계정 상태를 바꾸면, 그것을 되돌리는 restore 플로우를 rows의 restore_flow_id로 지정한다. 기존 목록에 같은 원복이 있으면 재사용한다.
- restore 플로우의 steps는 케이스가 끝난 화면에서 시작해 대상 앱 UI로 계정을 기준 상태로 되돌린다. check는 되돌린 상태를 화면 한 장으로 확인하는 조건이다.
- 기기 안 데이터만 바꾸는 행, 로그인이 없는 앱의 행은 null. 탈퇴·삭제처럼 되돌릴 수 없는 변경도 null이다(그런 케이스는 사람이 수행한다).

## 4. 스펙 보강 제안 (케이스가 아니다)
FR·UX 규칙 대비 TS·EC가 빠진 곳을 테스트 설계 기법(normal 정상 플로우, negative 예외/부정, boundary 경계값, partition 동등분할, state 상태 전이, role 권한/역할별)으로 찾는다.
- 요구사항 하나에 제안 하나 이하. 실제로 테스트가 빠져 있고 결함을 놓칠 수 있는 것만, 중요한 순서로 최대 6개. 없으면 빈 배열.
- text는 "무엇을 확인하는 TS(또는 EC)가 없습니다"처럼 스펙 작성자가 바로 행을 추가할 수 있게 한두 문장으로 쓴다. 근거가 되는 기존 행 ID가 있으면 함께 적는다.`;

// ---------------------------------------------------------------- 2. 케이스 변환

export const GenPoint = z.object({
  target: z.string().describe('화면에서 찾을 대상 이름 (명사구). 예: 취소 확인 모달, 튜토리얼 스텝 화면'),
  compare: PointCompare,
  expected: z.string().describe('이 포인트 하나의 기대 결과 (한 문장)'),
  method: PointMethod,
});
export type GenPoint = z.infer<typeof GenPoint>;

export const GenCase = z.object({
  row_id: z.string(),
  title: z.string(),
  preconditions: z.array(z.string()).describe('사람이 읽는 사전조건. 준비 플로우가 만든 상태 + 그 밖의 조건'),
  data: z.string().nullable().describe('입력에 쓰는 테스트 데이터. 없으면 null'),
  account_kind: z
    .string()
    .nullable()
    .describe('필요 계정 종류. 테스트 계정으로 로그인해야 하는 케이스면 종류 이름(구분이 없으면 `기본`), 아니면 null'),
  steps: z.array(
    z.object({
      text: z.string(),
      manual: z.boolean(),
      // 응답에 빠져 있으면(예전 녹화) 위험 아님. strict 출력에는 required로 나간다
      risk: z.enum(['approval', 'human']).nullable().default(null).describe('위험 단계 표시 (F-EX-10). 없으면 null'),
    }),
  ),
  points: z.array(GenPoint),
  priority: Priority,
  type: TestType,
  platform: z.enum(['common', 'android', 'ios']),
  mode: ExecMode,
  questions: z.array(
    z.object({
      requirement_id: z.string().describe('FR-xxx 또는 UX-xxx (스펙 접두어 없이)'),
      text: z.string(),
    }),
  ),
});
export type GenCase = z.infer<typeof GenCase>;
export const CaseBatchOutput = z.object({ cases: z.array(GenCase) });

export const CASE_SYSTEM = `너는 Android 앱 QA 문서 작성자다. 스펙의 테스트 시나리오(TS)·엣지 케이스(EC) 행을 받아 Agent가 실제 디바이스에서 수행할 수 있는 케이스로 바꾼다.
케이스는 행 하나에 하나다. 입력의 모든 행에 대해 cases를 하나씩 낸다(row_id 그대로).

## 실행 환경
- 케이스를 수행하는 Agent는 화면(접근성 트리, 필요하면 스크린샷)을 보고 탭·입력·스크롤·뒤로가기·앱 재실행·네트워크 끄기를 한다.
- 케이스 시작 전에 지정된 준비 플로우가 이미 수행되어 있다. 단계는 그 다음부터 쓴다. 준비 플로우 내용을 단계에 반복하지 않는다.
- 기대 결과는 단계가 끝난 뒤 화면 한 장으로 검증 포인트별로 판정된다. 판정은 다른 Agent가 한다.

## 필드
- title: 행의 시나리오(EC는 상황)를 짧게. 스펙 문구를 최대한 유지한다.
- preconditions: Given(EC는 상황 중 전제)을 사람이 읽을 문장으로. 준비 플로우로 만들어지지 않는 조건(네트워크 상태 등)은 단계로 만들거나 여기에 적는다.
- steps: When을 Agent가 따라 할 수 있는 순서로 쪼갠다. 입력값은 \`값\`. 한 단계에 행동 하나. 확인·검증은 단계가 아니라 points에 쓴다.
  - ${BUTTON_NAMES}
  - 기다리기만 하는 단계("2~3초 기다린다")는 쓰지 않는다. 화면이 자리 잡을 때까지는 Agent가 기다린다. 토스트·스낵바처럼 잠깐 뜨는 반응을 확인하는 행은 그 반응을 일으키는 행동이 마지막 단계다. 시간이 지난 뒤의 결과(자동 이동, 토스트가 사라짐)가 Then일 때만 기다리는 단계를 쓴다.
  - EC처럼 When이 없으면 "상황"을 만드는 단계를 쓴다(예: 네트워크를 끈 뒤 [저장]을 누른다).
  - Agent가 할 수 없는 단계(SMS 인증번호 입력, 다른 앱에서 외부 발송, 물리 조작, 시간 경과 대기 수 분 이상)는 manual: true.
  - risk (위험 단계): 단계의 행동이 테스트 밖에 영향을 주거나 되돌릴 수 없으면 표시한다. 실행할 때 Agent가 멈추고 실행자에게 묻는 기준이 된다.
    - human: 본인인증(PASS·통신사·카드·간편인증), SMS·이메일 인증번호, 공동인증서, 생체인증, 캡차, 소셜 로그인, 실제 개인정보 입력. Agent가 하지 않으므로 manual: true와 함께 쓴다.
    - approval: 실제 사람에게 닿음(메시지·초대 발송, 공개 게시, 친구 추가), 결제·구독·송금, 탈퇴·삭제·나가기·차단, 대상 앱 밖 조작(공유 시트에서 대상 고르기, 민감한 권한 허용), 계정·보안 변경(비밀번호 변경, 로그아웃), 주문·예약. 케이스를 승인하면 이 단계는 사전 승인이 되지만, 사람·돈에 닿는 행동은 실행 때 다시 묻는다.
    - 그 밖은 null. 테스트 계정 아이디·비밀번호 로그인, 앱 안에서 만들고 지우는 테스트 데이터, 공유 시트를 여는 것까지는 null이다.
- points (검증 포인트): Then(EC는 처리)을 나눈다.
  1. 한 포인트에는 확인 하나만 담는다. "A로 이동한다. B는 띄우지 않는다"는 두 포인트다.
  2. target은 화면에서 찾을 대상의 이름(명사구)이다. 문장 조각을 쓰지 않는다.
  3. compare
     - screen: 특정 화면·스텝이 열려 있다 (이동한다·연다·머무른다·되돌아가지 않는다 → 결과로 보여야 할 화면을 target으로)
     - visible: 특정 요소가 보인다
     - not_visible: 특정 요소가 보이면 안 된다. 보이면 안 되는 "그 요소"를 target으로. 동작을 부정하는 문장("이동하지 않는다")에는 쓰지 않고 남아 있어야 할 화면을 screen으로 쓴다
     - text_exists: 정확한 문구가 보인다. 문구를 백틱으로 expected에 넣는다
     - count: 요소 개수. expected는 "습관 카드 3개"처럼 대상과 개수를 함께 쓴다
     - size_dp: 크기. 기대값이 dp일 때만. px 위치·간격은 visible + vision
     - state: 화면으로 알 수 없는 앱 내부 상태·기록·저장·클립보드·서버 데이터 (사람 확인으로 넘어간다)
  4. method: tree가 기본이다. 위치·간격·색·이미지·레이아웃·차트처럼 픽셀을 봐야 하면 vision.
  5. 화면 한 장으로 판단할 수 없는 것(이전 상태와의 비교, 동작 이력)은 결과 화면으로 바꿔 쓸 수 있으면 screen/visible로, 아니면 state로 쓴다.
  6. Then에 없는 기대를 지어내지 않는다. Given·When·관련 요구사항은 맥락으로만 쓴다.
- mode: 기본 auto. 다음은 manual — 다른 사용자의 행동이 필요한 경우(방장·멤버 간 상호작용, 초대 수락), 서버 이벤트가 필요한 경우(푸시 수신, 서버 상태 변경), 화면으로 확인할 수 없는 것이 핵심인 경우(요청 헤더·서버 검증·로그). 검증 포인트가 모두 state라 화면으로 하나도 판정할 수 없는 경우도 manual이다. auto 케이스 안의 일부 단계만 사람이 해야 하면 케이스는 auto로 두고 그 단계만 manual: true.
- priority: 기본은 medium. high는 스펙 하나에서 소수다(대략 5분의 1 이하) — 기능을 처음부터 끝까지 통과하는 대표 정상 흐름, 실패하면 사용자가 앞으로 나아갈 수 없는 경우, 데이터 손실·중복 생성·잘못된 저장. 개별 버튼 동작·예외 안내는 medium. low = 문구·간격 같은 표시만의 문제(UX 규칙만 관련).
- type: functional 기능 / ui 표시·레이아웃·문구 / exception 오류·예외 처리 / boundary 경계값·길이·개수 제한 / state 앱 재시작·백그라운드 복귀 등 상태 전이 / permission OS 권한 / compat 기기·OS 차이.
- platform: 스펙이 특정 플랫폼만 말하면 android 또는 ios, 아니면 common.
- data: 입력값이 있으면 모아서 적는다(예: 닉네임 \`콩콩이\`). 준비 플로우가 쓰는 값과 맞춘다. 테스트 계정의 아이디·비밀번호는 쓰지 않는다(실행할 때 배정된다).
- account_kind (필요 계정 종류): 로그인이 있는 앱에서 이 케이스가 테스트 계정을 쓰면(로그인한 상태에서 시작하거나 로그인 화면에 계정 정보를 입력하면) 종류를 쓴다. 계정을 구분하지 않으면 \`기본\`. 구독 등급·권한·계정 유형처럼 실행 중에 UI로 만들 수 없는 계정 성질이 Given에 있을 때만 다른 이름(예: \`구독자\`, \`관리자\`)을 쓰고, 같은 성질에는 스펙 전체에서 같은 이름을 쓴다. 항목 개수·설정값처럼 UI로 만들 수 있는 상태는 종류가 아니라 준비 플로우가 만든다. 로그인이 없는 앱(앱 데이터 초기화가 곧 새 사용자)이면 null.
- 탈퇴·계정 삭제처럼 테스트 계정을 되돌릴 수 없게 바꾸는 케이스는 mode를 manual로 한다.
- 시작 상태가 이 행을 수행하기에 모자라면(필요한 데이터·화면이 없다) 질문하지 말고 단계 앞부분에 대상 앱 조작으로 그 상태를 만드는 단계를 넣는다.
- 기기 설정·다른 앱·OS 조작(권한 변경, 다른 앱 사용 중지, 알림 영역 조작 등)이 필요하면 그 단계는 manual: true로 쓴다.
- questions (스펙 확인 질문): 스펙을 읽어도 답이 없어서 케이스를 만들거나 판정할 수 없을 때만. 준비·진입 방법은 질문하지 않는다(위 규칙대로 단계로 해결한다). 예: 기대 결과의 기준이 둘로 읽힌다, 테스트로 만들 방법이 없는 사전조건, 서로 맞지 않는 요구사항. 사소한 표현 차이나 짐작으로 충분한 것, 스펙의 다른 행·요구사항에 답이 있는 것은 묻지 않는다. 회원 전용처럼 보이는데 로그인 기술이 없어 로그인이 필요한 앱인지 알 수 없으면 묻는다. 행 하나에 질문은 최대 1개(여러 가지면 한 질문에 묶는다). 대부분의 행은 빈 배열이다. 질문은 기획자·개발자가 바로 답할 수 있게 구체적으로, 왜 판정에 영향을 주는지 함께 쓴다.

## 변경된 행
"이전 케이스"가 함께 오면 이전 버전 스펙으로 만들었고 사람이 고쳤을 수 있는 케이스다. 바뀐 스펙에 맞게 다시 만들되, 아직 유효한 사람의 수정(단계 순서·표현·수동 표시·포인트 구분)은 유지한다. 이미 답이 달린 질문은 다시 묻지 않는다.`;

// ---------------------------------------------------------------- 3. 케이스 수정안

export const ReviseOutput = z.object({
  decision: z
    .enum(['revise', 'no_change'])
    .describe('답변을 반영해 케이스를 바꿔야 하면 revise, 지금 케이스가 이미 맞으면 no_change'),
  reason: z
    .string()
    .describe('검토자에게 보일 근거. revise면 무엇을 왜 바꿨는지, no_change면 왜 바꿀 것이 없는지 한두 문장'),
  case: GenCase.omit({ row_id: true, questions: true })
    .nullable()
    .describe('revise일 때 고친 케이스 전체. no_change면 null'),
});
export type ReviseOutput = z.infer<typeof ReviseOutput>;

// 필드 규칙은 케이스 변환과 같다 (케이스 변환 프롬프트를 바꾸면 그 녹화가 깨지므로 잘라서 쓴다)
const CASE_RULES = CASE_SYSTEM.slice(CASE_SYSTEM.indexOf('## 실행 환경'), CASE_SYSTEM.indexOf('## 변경된 행')).trim();

export const REVISE_SYSTEM = `너는 Android 앱 QA 문서 작성자다. 사람이 검토 중인 케이스 하나와, 그 케이스를 만들 때 생긴 스펙 확인 질문에 기획자·개발자가 단 답변을 받는다.
답변을 케이스에 반영한 수정안을 만들거나, 반영할 것이 없으면 no_change로 답한다.

## 수정 원칙
- 답변이 정한 내용만 바꾼다. 답변과 관계없는 단계·포인트·필드는 글자 하나도 바꾸지 않는다. 사람이 고친 표현·순서·수동 표시는 그대로 둔다.
- 답변이 기대 결과의 기준을 정하면 그 검증 포인트를 고친다(기준값·대상·compare·method). 답변이 사전조건이나 만드는 방법을 알려 주면 사전조건·단계를 고친다.
- 답변이 지금 케이스와 같은 뜻이면(이미 그렇게 쓰여 있다) no_change. 답변이 케이스로 확인할 수 없는 내용이면(구현 설명 등) no_change로 두고 이유를 쓴다.
- 답변이 스펙 행의 Then과 다르면 답변을 따른다. 스펙은 아직 고쳐지지 않았을 수 있다.
- revise면 case에 고친 케이스 전체를 낸다(바꾸지 않은 부분도 그대로 포함). 준비 플로우는 코드가 유지하므로 신경 쓰지 않는다.
- reason은 검토자가 diff를 보기 전에 읽는 요약이다. 어떤 답변 때문에 무엇을 바꿨는지 쓴다.

${CASE_RULES}`;
