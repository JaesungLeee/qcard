#!/usr/bin/env node
/**
 * 배포하는 `qcard` 명령의 진입점 (`npm i -g @qcard/host`). 기본으로 운영 서비스에 붙는다(QCARD_TARGET=prod).
 *
 *   qcard connect      이 PC를 qcard 계정에 연결 (브라우저에서 [이 PC 연결]). 이미 연결돼 있으면 그대로, --force면 다시 연결
 *   qcard status       연결된 계정 확인
 *   qcard disconnect   이 PC의 연결 해제
 *   qcard serve        호스트 에이전트 켜기 (로컬 콘솔·웹에서 요청한 작업)
 *   qcard doctor       필요한 도구(adb·Claude Code·scrcpy) 점검
 *
 * 하위 명령은 저장소의 개발용 스크립트(pair.ts·serve.ts)와 같은 코드를 그대로 불러 실행한다.
 */
import { execFile } from 'node:child_process';
import { resolveAdb } from '@qcard/device/node';
import { claudeCodeProblem, claudeCodeStatus, MODELS_FOR } from '@qcard/llm';
import { findScrcpy } from './console/video';
import { hostVersion } from './version';

process.env.QCARD_TARGET ??= 'prod';
process.env.QCARD_CLI = '1';

const HELP = `qcard — 스펙 기반 QA 자동화 호스트 에이전트

사용법: qcard <명령> [옵션]

  connect      이 PC를 qcard 계정에 연결합니다 (브라우저가 열리면 [이 PC 연결])
                 --force             이미 연결돼 있어도 다시 연결 (예전 연결은 해제)
  status       연결된 계정을 확인합니다
  disconnect   이 PC의 연결을 해제합니다
  serve        호스트 에이전트를 켭니다 (로컬 콘솔, 웹에서 요청한 Run·QA 문서 생성)
                 --serial <시리얼>   디바이스가 여러 대일 때
                 --allow-network     Agent가 폰 네트워크를 끄는 동작 허용
                 --headless          로컬 콘솔 없이
  doctor       필요한 도구(adb, Claude Code, scrcpy)를 점검합니다

  -v, --version   버전
  -h, --help      도움말

웹: https://qcard.dev`;


const runs = (bin: string, args: string[]) =>
  new Promise<string | undefined>((resolve) =>
    execFile(bin, args, { timeout: 10_000 }, (e, out) => resolve(e ? undefined : out.trim())),
  );

/** 필요한 도구 점검. adb가 없으면 실패(false), Claude Code·scrcpy는 안내만 */
async function doctor(log: (l: string) => void, verbose: boolean): Promise<boolean> {
  const adb = await runs(resolveAdb(), ['version']);
  const claude = await claudeCodeStatus();
  const problem = claudeCodeProblem(claude, [...MODELS_FOR.run, ...MODELS_FOR.qadoc]);
  const scrcpy = await findScrcpy();
  const lines: [ok: boolean, text: string][] = [
    [
      !!adb,
      adb ? `adb ${/version ([\d.]+)/.exec(adb)?.[1] ?? ''}`.trim() : 'adb 없음 — brew install android-platform-tools',
    ],
    [
      !problem,
      problem
        ? problem.message
        : `Claude Code ${claude.version ?? ''}${claude.subscriptionType ? ` (${claude.subscriptionType})` : ''}`,
    ],
    [
      !!scrcpy,
      scrcpy ? `scrcpy ${scrcpy.version}` : 'scrcpy 없음 (선택: 로컬 콘솔의 실시간 화면) — brew install scrcpy',
    ],
  ];
  for (const [ok, text] of lines) if (verbose || !ok) log(`${ok ? '✓' : '!'} ${text}`);
  return !!adb;
}

const [command, ...rest] = process.argv.slice(2);
const log = (l: string) => console.log(l);

if (!command || command === '-h' || command === '--help' || command === 'help') {
  log(HELP);
} else if (command === '-v' || command === '--version') {
  log(hostVersion());
} else if (command === 'doctor') {
  process.exitCode = (await doctor(log, true)) ? 0 : 1;
} else if (command === 'connect' || command === 'status' || command === 'disconnect') {
  process.argv = [process.argv[0]!, process.argv[1]!, command, ...rest];
  await import('./pair');
} else if (command === 'serve') {
  if (!(await doctor(log, false))) {
    console.error('adb가 있어야 디바이스를 다룰 수 있습니다. 설치한 뒤 다시 실행하세요.');
    process.exit(1);
  }
  process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  await import('./serve');
} else {
  console.error(`알 수 없는 명령: ${command}\n\n${HELP}`);
  process.exitCode = 1;
}
