import { childLabels, contains, findElement, type UiElement } from '@qcard/device';
import type { CaseStep, RiskKind } from '@qcard/shared';
import type { Observation } from './env';

/*
 * 위험 액션 (F-EX-10). Agent가 액션에 붙인 위험 표시와 코드 안전장치(여기)로 이중 판별한다 —
 * LLM이 놓쳐도 앱 밖 탭·민감한 권한·결제·발송·본인인증 화면은 멈춘다. 오탐은 멈추고 묻는 것뿐이라 넓게 잡는다.
 *
 *   등급: identity → 사람 전용(Agent는 입력·탭하지 않고 실행자가 직접), 나머지 → 승인 필요
 *   사전 승인: 승인된 케이스의 위험 표시(approval) 단계에서는 멈추지 않는다. 단 사람·돈·본인인증은 계획돼 있어도 멈춘다
 */

export type RiskLevel = 'approval' | 'human';
export type RiskFinding = { kind: RiskKind; reason: string; source: 'agent' | 'guard' };

export const riskLevel = (kind: RiskKind): RiskLevel => (kind === 'identity' ? 'human' : 'approval');

/** 케이스에 계획돼 있어도 매번 묻는 종류 — 테스트 밖의 사람·돈에 닿는다 */
const ALWAYS_ASK = new Set<RiskKind>(['people', 'money', 'identity']);

/** 사전 승인으로 넘길 수 있는가 */
export const preApproved = (f: RiskFinding, step: CaseStep | undefined) =>
  step?.risk === 'approval' && riskLevel(f.kind) === 'approval' && !ALWAYS_ASK.has(f.kind);

const IDENTITY =
  /본인\s?인증|본인\s?확인|휴대\s?(폰|전화)\s?인증|인증\s?번호|PASS\s?(앱|인증)|통신사\s?(선택|인증)|주민\s?(등록)?\s?번호|공동\s?인증서|간편\s?인증|NICE|KCB|identity verification|verification code/i;
const MONEY = /결제|구매|구독|송금|충전하기|주문하기|^\s*(pay|buy|purchase|subscribe|checkout)\b/i;
const PEOPLE = /보내기|전송|게시하기|^\s*게시\s*$|^\s*(send|post|publish)\b/i;
const IRREVERSIBLE =
  /탈퇴|계정\s?삭제|삭제하기|^\s*삭제\s*$|차단하기|^\s*차단\s*$|^\s*(delete|remove account|block)\b/i;
/** 권한 대화상자 패키지 */
const PERMISSION_UI = /permissioncontroller/;
const ALLOW = /허용|^\s*allow\b|while using/i;
const DENY = /안\s?함|거부|deny|don'?t/i;
const SENSITIVE_PERMISSION =
  /연락처|사진|동영상|미디어|위치|카메라|마이크|전화|통화|문자|SMS|contacts|photos|media|location|camera|microphone|phone|call/i;

/** 케이스가 인증 단계를 갖는가 (인앱 웹뷰 인증은 이때만 멈춘다 — 웹뷰 내용이 트리에 안 보일 수 있다) */
export const caseHasAuth = (steps: CaseStep[]) => steps.some((s) => s.risk === 'human' || IDENTITY.test(s.text));

const texts = (tree: UiElement[]) => tree.flatMap((e) => [e.text, e.desc].filter((t): t is string => !!t));

/** 본인인증·인증번호 화면인가. 웹뷰는 내용이 안 보여도 케이스에 인증 단계가 있으면 그렇게 본다 */
export function identityScreen(o: Observation, withAuth: boolean): boolean {
  if (texts(o.tree).some((t) => IDENTITY.test(t))) return true;
  return withAuth && o.tree.some((e) => /WebView/.test(e.cls));
}

export type RiskAction =
  | { name: 'tap'; input: { element_ref: string } }
  | { name: 'tap_point'; input: { x: number; y: number } }
  | { name: 'input_text'; input: { element_ref: string; text: string } };

/** 액션이 누르는 요소 (tap_point는 그 위치를 덮는 가장 안쪽 요소) */
export function targetOf(a: RiskAction, tree: UiElement[]): UiElement | undefined {
  if (a.name === 'tap_point') {
    const hits = tree.filter((e) => contains(e.bounds, [a.input.x, a.input.y]));
    return hits.sort((x, y) => y.depth - x.depth)[0];
  }
  return findElement(tree, a.input.element_ref);
}

/** 코드 안전장치: Agent 판단과 관계없이 멈출 액션 */
export function guardRisk(
  a: RiskAction,
  o: Observation,
  ctx: { appPackage: string; withAuth: boolean },
): RiskFinding | undefined {
  const guard = (kind: RiskKind, reason: string): RiskFinding => ({ kind, reason, source: 'guard' });
  const el = targetOf(a, o.tree);
  const label = el ? (el.text ?? el.desc ?? childLabels(o.tree).get(el.ref) ?? '') : '';

  if (a.name === 'input_text' && el?.password && !/^\{\{secret\.[^}]+\}\}$/.test(a.input.text.trim()))
    return guard('identity', '비밀번호 칸에 테스트 계정 비밀값이 아닌 값을 입력');
  if (identityScreen(o, ctx.withAuth)) return guard('identity', '본인인증·인증번호 화면');

  const fg = o.foreground;
  if (fg && PERMISSION_UI.test(fg)) {
    return ALLOW.test(label) && !DENY.test(label) && texts(o.tree).some((t) => SENSITIVE_PERMISSION.test(t))
      ? guard('outside_app', `민감한 권한 허용: ${label}`)
      : undefined;
  }
  if (fg && fg !== ctx.appPackage) return guard('outside_app', `대상 앱 밖(${fg})에서 ${label || '탭'}`);

  if (MONEY.test(label)) return guard('money', `"${label}" — 결제·구매로 보임`);
  if (PEOPLE.test(label)) return guard('people', `"${label}" — 외부 발송·게시로 보임`);
  if (IRREVERSIBLE.test(label)) return guard('irreversible', `"${label}" — 되돌릴 수 없는 동작으로 보임`);
  return undefined;
}

/** Agent 표시와 안전장치 중 더 엄한 쪽 (사람 전용 > Agent 판단 > 안전장치) */
export function pickRisk(agent: RiskFinding | undefined, guard: RiskFinding | undefined): RiskFinding | undefined {
  if (guard?.kind === 'identity' && agent?.kind !== 'identity') return guard;
  return agent ?? guard;
}
