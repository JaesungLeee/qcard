import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions } from '@qcard/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assertClaudeCodeReady,
  claudeCodeStatus,
  cliError,
  learnMinVersion,
  modelLabel,
  requiredClaudeCodeVersion,
  resetsAt,
} from './claude-cli';
import { ClaudeCodeSetupError, PlanLimitError } from './messages';
import { MODELS_FOR } from './types';

/** 실제 claude 대신 쓰는 스크립트. 버전·로그인 상태는 환경변수로 바꾼다 (QCARD_CLAUDE_BIN) */
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'qcard-fake-claude-'));
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      '[ -n "$FAKE_MISSING" ] && exit 127',
      'if [ "$1" = "--version" ]; then echo "$FAKE_VERSION (Claude Code)"; exit 0; fi',
      'echo "{\\"loggedIn\\":$FAKE_LOGGED_IN,\\"authMethod\\":\\"claude.ai\\",\\"subscriptionType\\":\\"pro\\",\\"email\\":\\"x@y\\"}"',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  process.env.QCARD_CLAUDE_BIN = bin;
});
const fake = (version: string, loggedIn = true, missing = false) => {
  process.env.FAKE_VERSION = version;
  process.env.FAKE_LOGGED_IN = String(loggedIn);
  if (missing) process.env.FAKE_MISSING = '1';
  else delete process.env.FAKE_MISSING;
};
afterEach(() => fake('2.1.308'));

describe('Claude Code 사전 점검', () => {
  it('버전은 숫자로 비교한다', () => {
    expect(compareVersions('2.1.99', '2.1.280')).toBeLessThan(0);
    expect(compareVersions('2.1.280', '2.1.280')).toBe(0);
    expect(compareVersions('2.2.0', '2.1.999')).toBeGreaterThan(0);
  });

  it('작업이 부르는 모델 중 가장 높은 최소 버전을 쓴다', () => {
    expect(requiredClaudeCodeVersion(MODELS_FOR.run)).toBe('2.1.284');
    expect(requiredClaudeCodeVersion(MODELS_FOR.qadoc)).toBe('2.1.280');
    expect(requiredClaudeCodeVersion(['claude-sonnet-5-5', 'claude-haiku-5-5'])).toBe('2.1.293');
    expect(requiredClaudeCodeVersion(['unknown-model'])).toBeUndefined();
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
  });

  it('실행 중 알게 된 최소 버전이 표보다 높으면 그것을 쓴다', () => {
    learnMinVersion('claude-test-model', '2.1.400');
    learnMinVersion('claude-test-model', '2.1.300');
    expect(requiredClaudeCodeVersion(['claude-test-model'])).toBe('2.1.400');
  });

  it('상태: 버전·로그인·플랜. 계정 식별 정보는 돌려주지 않는다', async () => {
    fake('2.1.290');
    const s = await claudeCodeStatus(MODELS_FOR.run);
    expect(s).toEqual({
      installed: true,
      version: '2.1.290',
      loggedIn: true,
      authMethod: 'claude.ai',
      subscriptionType: 'pro',
    });
    expect(JSON.stringify(s)).not.toContain('x@y');
  });

  it('버전이 낮으면 필요한 버전을 알리고 시작하지 않는다', async () => {
    fake('2.1.250');
    expect((await claudeCodeStatus(MODELS_FOR.run)).requiredVersion).toBe('2.1.284');
    const e = await assertClaudeCodeReady(MODELS_FOR.run).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ClaudeCodeSetupError);
    expect(e).toMatchObject({ reason: 'outdated', requiredVersion: '2.1.284' });
    expect((e as Error).message).toContain('claude update');
  });

  it('설치·로그인 안 됨을 구분한다', async () => {
    fake('2.1.308', false);
    await expect(assertClaudeCodeReady(MODELS_FOR.run)).rejects.toMatchObject({ reason: 'not_logged_in' });
    fake('', true, true);
    await expect(assertClaudeCodeReady(MODELS_FOR.run)).rejects.toMatchObject({ reason: 'not_installed' });
    fake('2.1.308');
    await expect(assertClaudeCodeReady(MODELS_FOR.run)).resolves.toMatchObject({ loggedIn: true });
  });

  it('실행 중 오류 문구에서 필요한 버전과 한도가 풀리는 시각을 읽는다', () => {
    const outdated = cliError({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result:
        "API Error: 400 Claude Code 2.1.185 does not support this model; version 2.1.280 or newer is required. Run 'claude update'",
    });
    expect(outdated).toMatchObject({ reason: 'outdated', requiredVersion: '2.1.280' });
    const limit = cliError({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Claude AI usage limit reached|1793260800',
    });
    expect(limit).toBeInstanceOf(PlanLimitError);
    expect((limit as PlanLimitError).resetsAt).toBe(new Date(1793260800 * 1000).toISOString());
    const noTime = cliError({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit" });
    expect((noTime as PlanLimitError).resetsAt).toBeUndefined();
  });

  it('시각 표기로 쓴 풀리는 시각을 읽는다 — 시간대가 없으면 이 PC, 날짜가 없으면 다음 그 시각', () => {
    // 2026-10-29 14:00 서울 (05:00Z)
    const now = new Date('2026-10-29T05:00:00Z');
    expect(resetsAt("You've hit your 5-hour limit · resets 3pm (Asia/Seoul)", now)).toBe('2026-10-29T06:00:00.000Z');
    expect(resetsAt('5-hour limit reached · Resets at 3:10 PM (Asia/Seoul)', now)).toBe('2026-10-29T06:10:00.000Z');
    // 이미 지난 시각이면 다음 날
    expect(resetsAt('limit reached ∙ resets 9am (Asia/Seoul)', now)).toBe('2026-10-30T00:00:00.000Z');
    expect(resetsAt('resets 12am (Asia/Seoul)', now)).toBe('2026-10-29T15:00:00.000Z');
    // 주간 한도: 날짜가 있다
    expect(resetsAt('Weekly limit reached · resets Nov 3, 9am (America/New_York)', now)).toBe(
      '2026-11-03T14:00:00.000Z',
    );
    expect(resetsAt('resets 3pm (Mars/Base)', now)).toBeUndefined();
    expect(resetsAt('Claude AI usage limit reached|1793260800', now)).toBe(new Date(1793260800 * 1000).toISOString());
    expect(resetsAt('usage limit reached', now)).toBeUndefined();
  });
});
