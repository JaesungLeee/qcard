import { FakeDevice, type FakeScenario } from '@qcard/device';
import { APP_PACKAGE, onboardingScenario, PREP_FLOWS, qaDocV130, syntheticScreen } from '@qcard/fixtures';
import { createLlm, UsageMeter, type LlmMode } from '@qcard/llm';
import type { CaseResult } from '@qcard/shared';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClock, runCase } from '../src';

/*
 * 합성 온보딩 앱에서 실제 모델로 케이스를 돌린다. 녹화(record)는 scripts/record.ts, 재생은 onboarding.test.ts.
 */

export const CASSETTE_DIR = fileURLToPath(new URL('../cassettes', import.meta.url));

/** 녹화할 케이스와 기대 판정. buggy: 온보딩 중 바텀 네비가 보이는 버그를 넣은 앱 */
export const E2E_CASES = [
  { tcId: 'TC-ONBOARDING-001', expect: 'pass' },
  { tcId: 'TC-ONBOARDING-001', buggy: true, expect: 'fail' },
  { tcId: 'TC-ONBOARDING-003', expect: 'check' },
  { tcId: 'TC-ONBOARDING-004', expect: 'pass' },
  { tcId: 'TC-ONBOARDING-005', expect: 'check' },
] as const;

/**
 * 녹화 폴더는 시나리오마다 따로 둔다. 시작 화면이 같으면 첫 요청이 같아서, 한 폴더에 두면
 * 나중 녹화가 앞 녹화를 덮어쓴다 (정상 앱·버그 앱 TC-001).
 */
export const slug = (c: (typeof E2E_CASES)[number]) => `${c.tcId}${'buggy' in c ? '-buggy' : ''}`;

function buggyScenario(): FakeScenario {
  const s = onboardingScenario();
  const nav = syntheticScreen('today').tree.find((e) => e.resourceId === 'bottom_nav')!;
  return { ...s, screens: { ...s.screens, nickname: { tree: [...s.screens.nickname!.tree, nav] } } };
}

export async function runE2E(c: (typeof E2E_CASES)[number], mode: LlmMode) {
  const testCase = qaDocV130.cases.find((x) => x.tcId === c.tcId)!;
  const device = new FakeDevice('buggy' in c ? buggyScenario() : onboardingScenario());
  const meter = new UsageMeter({ maxCallsPerCase: 40 });
  const thoughts: string[] = [];
  const result: CaseResult = await runCase(
    {
      device,
      llm: createLlm({ mode, cassetteDir: join(CASSETTE_DIR, slug(c)), meter }),
      appPackage: APP_PACKAGE,
      clock: fakeClock(Date.UTC(2026, 9, 20)),
      vision: false,
      saveScreenshot: async () => ({ kind: 'mock', screen: device.current }),
      onThought: (t) => thoughts.push(`[${t.kind}] ${t.text}`),
    },
    { testCase, prepFlows: PREP_FLOWS, deviceId: 'galaxy-s24-15', meter },
  );
  return { result, thoughts, device, usage: meter.run };
}
