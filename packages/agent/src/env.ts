import type { DeviceDriver, KeyboardState, UiElement } from '@qcard/device';
import { formatTree } from '@qcard/device';
import type { LlmClient, SecretVault } from '@qcard/llm';
import type { Screenshot, ThoughtEntry } from '@qcard/shared';

/** 시간. 테스트에서는 기다리지 않는 가짜 시계를 쓴다. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
/** 기다리지 않고 시간만 흐르게 한다 */
export function fakeClock(start = 0): Clock {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

/** 스크린샷 저장 (호스트는 로컬 디스크·Storage에 올리고 URL을 돌려준다) */
export type SaveScreenshot = (png: Uint8Array, ctx: { caseId: string; index: number }) => Promise<Screenshot>;

/** Agent가 쓰는 외부 의존성과 설정 */
export type AgentEnv = {
  device: DeviceDriver;
  llm: LlmClient;
  appPackage: string;
  clock?: Clock;
  vault?: SecretVault;
  saveScreenshot?: SaveScreenshot;
  /** 스크린샷을 LLM에 보낼 수 있는지 (기본 true). 합성 화면처럼 이미지가 의미 없으면 끈다 */
  vision?: boolean;
  /**
   * 매 턴 스크린샷을 함께 보낼지 (기본 false). 기본은 트리만 보내고 Agent가 `view_screen`으로 요청한다
   * (F-EX-02 트리 우선·비전 보조). 이미지가 대화에 쌓여 비용 대부분을 차지하기 때문이다.
   */
  screenshotEveryTurn?: boolean;
  /** 액션 뒤 화면이 안정되기를 기다리는 시간 (기본 500ms) */
  settleMs?: number;
  onThought?: (t: ThoughtEntry) => void;
  /** 수동 스텝: 실행자에게 알리고 "완료"를 기다린다. 없으면 타임아웃으로 본다 (F-EX-11) */
  onManual?: (instruction: string) => Promise<'done' | 'timeout'>;
};

export type Observation = {
  index: number;
  tree: UiElement[];
  treeText: string;
  png: Uint8Array;
  foreground?: string;
  keyboard: KeyboardState;
  screenshot: Screenshot;
};

export const clockOf = (env: AgentEnv) => env.clock ?? realClock;

export async function observe(env: AgentEnv, caseId: string, index: number): Promise<Observation> {
  // 실기기에서 덤프(~2.4s)와 스크린샷(~1s)을 동시에 하면 관찰 1회가 ~3.4s → ~2.3s (SM-S711N 실측)
  const [tree, png, foreground, keyboard] = await Promise.all([
    env.device.dumpTree(),
    env.device.screenshot(),
    env.device.foregroundPackage(),
    env.device.keyboard(),
  ]);
  const screenshot = env.saveScreenshot
    ? await env.saveScreenshot(png, { caseId, index })
    : { kind: 'url' as const, url: `local:${caseId}/${index}.png` };
  // 입력한 비밀값이 화면에 보일 수 있으므로 LLM에 갈 트리 텍스트는 가린다 (F-EX-09)
  const treeText = env.vault ? env.vault.mask(formatTree(tree)) : formatTree(tree);
  return { index, tree, treeText, png, foreground, keyboard, screenshot };
}

export function thought(env: AgentEnv, start: number, kind: ThoughtEntry['kind'], text: string) {
  env.onThought?.({ at: clockOf(env).now() - start, kind, text });
}

const base64 = (png: Uint8Array) => Buffer.from(png).toString('base64');

/** 관찰을 LLM 입력 블록으로 */
/** 스크린샷을 LLM에 보낼 수 없으면 그 이유. 대상 앱 밖(홈·알림창·다른 앱) 화면은 보내지 않는다 — 개인 기기 보호 */
export function screenshotBlocker(env: AgentEnv, o: Observation): string | undefined {
  if (env.vision === false) return '이 실행에서는 스크린샷을 쓰지 않습니다';
  if (o.foreground !== env.appPackage) return '대상 앱 밖 화면이라 스크린샷을 보내지 않습니다';
  return undefined;
}

export const imageBlock = (o: Observation) => ({
  type: 'image' as const,
  source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64(o.png) },
});

/** 관찰을 LLM 입력 블록으로. withImage면 (보낼 수 있을 때) 스크린샷도 붙인다 */
export function observationBlocks(
  env: AgentEnv,
  o: Observation,
  heading: string,
  withImage = env.screenshotEveryTurn ?? false,
) {
  const blocked = withImage ? screenshotBlocker(env, o) : undefined;
  const note = withImage && blocked ? `\n(${blocked})` : '';
  // 키보드 창은 앱 트리에 없다 — 가려진 버튼을 누르면 키보드 키가 눌리므로 알려 준다
  const kb = o.keyboard.shown
    ? `\n키보드: 표시 중${o.keyboard.top !== undefined ? ` — y=${o.keyboard.top} 아래 요소는 가려져 있다(누르려면 press_key back으로 먼저 닫는다)` : ''}`
    : '';
  const text = `${heading}\n포그라운드 앱: ${o.foreground ?? '알 수 없음'}${kb}${note}\n접근성 트리:\n${o.treeText || '(요소 없음)'}`;
  return [{ type: 'text' as const, text }, ...(withImage && !blocked ? [imageBlock(o)] : [])];
}
