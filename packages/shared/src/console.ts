import type { ExecStep, Run, TestCase, ThoughtEntry } from './domain';
import type { Verdict } from './verdict';

/*
 * 로컬 콘솔 (PRD §5.7): 호스트 에이전트가 127.0.0.1로 띄우는 실행 화면.
 * 호스트가 실행 상태(LiveConsole)를 통째로 밀어 주고, 화면은 제어 명령(ConsoleControl)만 보낸다.
 * 디바이스 화면은 별도 WebSocket으로 H.264 패킷이 온다 (ConsoleVideoConfig + 바이너리).
 */

export type ConsoleDevice = {
  serial: string;
  model: string;
  osBuild: string;
  resolution: string;
  /** 모르면 없음 */
  battery?: number;
  connection: 'USB' | 'Wi-Fi';
  status: 'idle' | 'running';
};

export type ConsoleQueueItem = {
  tcId: string;
  title: string;
  mode: TestCase['mode'];
  status: 'done' | 'running' | 'pending';
  verdict?: Verdict;
};

export type ClaudeCodeState = {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  /** pro · max */
  plan?: string;
  /** 플랜 사용 한도에 닿았으면 풀리는 시각 */
  limitedUntil?: string;
};

/** 지금 케이스의 진행 단계 */
export type ConsolePhase = 'running' | 'paused' | 'takeover' | 'manual' | 'verifying' | 'done' | 'aborted';

/** 실행자 제어 (F-DB-05) */
export const CONSOLE_CONTROLS = [
  'pause',
  'resume',
  'skip',
  'abort',
  'takeOver',
  'returnToAgent',
  'completeManual',
] as const;
export type ConsoleControl = (typeof CONSOLE_CONTROLS)[number];

/** 사고 로그 한 줄. stepIndex = 곧 수행할 스텝 번호 (1부터, 스텝 타임라인과 묶어 보인다) */
export type ConsoleThought = ThoughtEntry & { stepIndex: number };

export type LiveConsole = {
  projectId: string;
  cycleId: string;
  cycleName: string;
  build: { version: string; buildNumber: number };
  runId: string;
  executor: string;
  device: ConsoleDevice;
  /** 디바이스 화면 크기 (px). 액션 오버레이 좌표계 */
  screen: { w: number; h: number };
  queue: ConsoleQueueItem[];
  current?: {
    tcId: string;
    case: TestCase;
    steps: ExecStep[];
    thoughts: ConsoleThought[];
    /** 케이스 시작 시각 (epoch ms) */
    startedAt: number;
    /** 판정을 마친 검증 포인트 수 */
    verified: number;
  };
  phase: ConsolePhase;
  /** 끝난 케이스의 판정·사유 (phase done) */
  verdict?: Verdict;
  reason?: string;
  /** Run 동안 폰의 "충전 중 화면 켜짐 유지"를 켜 두었다 (끝나면 되돌린다) */
  stayAwake?: boolean;
  /** Agent가 모델 응답을 기다리는 중. since = 호출 시작 (epoch ms), limitMs = 넘으면 그 케이스는 Blocked */
  llmWait?: { since: number; limitMs: number };
  /** 수동 스텝 대기 (phase manual). deadline = 타임아웃 시각 (epoch ms) */
  manual?: { instruction: string; deadline: number };
  /** Run 상태. paused·aborted·done이면 message에 이유 */
  run: { status: Run['status']; message?: string };
  usage: { tokens: number; costUsd: number; caseTokens: number; caseTokenLimit: number };
  claudeCode: ClaudeCodeState;
};

/** 콘솔에서 고를 수 있는 사이클: 연결된 디바이스가 대상인 것 */
export type ConsoleCycleOption = {
  projectId: string;
  projectName: string;
  cycleId: string;
  cycleName: string;
  build: { version: string; buildNumber: number };
  docVersion: string;
  /** 이 디바이스의 대상 칸 */
  deviceId: string;
  /** 자동 케이스 (수동 케이스는 웹·콘솔에서 사람이 입력한다) */
  cases: { tcId: string; title: string; done: boolean }[];
  /** 내가 이 디바이스로 돌리다 일시정지된 Run (이어서 실행) */
  pausedRun?: { id: string; reason?: string };
};

/** Run이 없을 때 콘솔: 연결된 디바이스, 고를 수 있는 사이클, 지난 Run 결과 */
export type ConsoleHome = {
  executor: string;
  /** 이 호스트가 쓰는 디바이스 (1인 1대). 없으면 연결 안 됨 */
  device?: ConsoleDevice;
  screen?: { w: number; h: number };
  /** 디바이스 화면이 꺼졌거나 잠겼으면 이유 */
  deviceProblem?: string;
  cycles: ConsoleCycleOption[];
  /** 사이클 목록을 읽는 중 */
  loading: boolean;
  claudeCode: ClaudeCodeState;
  /** 방금 끝난 Run */
  lastRun?: { cycleName: string; status: Run['status']; message?: string; judged: number };
  /** 같은 호스트가 처리 중인 다른 일 (QA 문서 생성 등) */
  busy?: string;
  /** 한 번 알릴 일 (예: 지난 Run에서 못 되돌린 폰 설정을 되돌림) */
  notice?: string;
};

/** 호스트 → 화면. home = Run이 없을 때, state = Run 중 */
export type ConsoleServerMessage =
  | { type: 'state'; state: LiveConsole }
  | { type: 'home'; home: ConsoleHome }
  | { type: 'error'; message: string };
/** 화면 → 호스트 */
export type ConsoleClientMessage =
  | { type: 'control'; action: ConsoleControl }
  /** Run 시작. tcIds가 없으면 남은 자동 케이스 전체, resumeRunId면 그 Run을 이어서 */
  | { type: 'start'; projectId: string; cycleId: string; tcIds?: string[]; resumeRunId?: string }
  | { type: 'refresh' };

/**
 * 화면 스트림: 처음과 해상도가 바뀔 때 이 JSON(텍스트)이 오고, 그 뒤 바이너리 패킷이 온다.
 * 패킷 = [플래그 1바이트: 1=키프레임] + H.264 Annex B. 설정(SPS·PPS)은 다음 키프레임 앞에 붙어 온다
 */
export type ConsoleVideoConfig = { type: 'video'; width: number; height: number };
