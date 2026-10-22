/**
 * 호스트 에이전트 상주 모드: 웹에서 요청한 내 작업(QA 문서 생성)을 받아 이 PC의 Claude Code(본인 플랜)로 처리한다.
 *
 *   pnpm --filter @qcard/host-agent serve --user jaesung-lee
 *
 * - 30초마다 연결 신호(+ Claude Code 상태)를 보내 웹이 "호스트 연결됨"을 표시한다 (F-DB-09)
 * - 내 작업만 받는다(요청자 = 나). 한 번에 하나씩, 처리 중에는 맥이 잠들지 않게 한다(caffeinate)
 * - 작업마다 호출을 ~/.qcard/jobs/<작업>/llm에 녹화한다. 플랜 한도로 멈춘 작업을 웹에서 다시 시도하면
 *   끝난 호출은 재생하고 남은 것만 부른다
 *
 * 지금은 에뮬레이터(`pnpm emu`)에만 연결한다. --user는 시드 사용자(GitHub 사용자명).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { claudeCodeStatus, createCassetteLlm, createLiveLlm } from '@qcard/llm';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { connectEmulator } from './connect';
import { claimJob, heartbeat, pendingJobs, processJob } from './jobs';

const { values } = parseArgs({ options: { user: { type: 'string' } } });
if (!values.user) {
  console.error('사용법: serve --user <GitHub 사용자명>');
  process.exit(1);
}

const { db, storage, api, user } = await connectEmulator(values.user);
const machine = hostname().replace(/\.local$/, '');
const host = { id: machine.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), name: `${user.name}의 ${machine}` };

// ---------------------------------------------------------------- 연결 신호
async function beat() {
  const s = await claudeCodeStatus();
  await heartbeat(db, user.uid, {
    ...host,
    lastSeen: new Date().toISOString(),
    claudeCode: { version: s.version, loggedIn: s.loggedIn, subscriptionType: s.subscriptionType },
  }).catch((e: Error) => console.error(`연결 신호 실패: ${e.message}`));
  return s;
}
const status = await beat();
setInterval(beat, 30_000);
console.log(`호스트 ${host.name} · ${user.name}(@${user.github})`);
console.log(
  status.loggedIn
    ? `Claude Code ${status.version} · ${status.subscriptionType ?? status.authMethod} 플랜`
    : '⚠ Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`로 로그인하세요 (작업은 일시정지됩니다)',
);

// ---------------------------------------------------------------- 작업 처리 (한 번에 하나)
let busy = false;
let again = false;
async function drain() {
  if (busy) return void (again = true);
  busy = true;
  try {
    do {
      again = false;
      for (const job of await pendingJobs(db, user.uid)) {
        const running = await claimJob(db, job, host.name, new Date().toISOString());
        if (!running) continue;
        console.log(`\n■ ${job.projectId} · QA 문서 ${job.input.appVersion} 생성 (${job.id})`);
        const live = createLiveLlm(undefined, { turnTimeoutMs: 600_000 });
        const awake = keepAwake();
        try {
          await processJob(
            {
              db,
              storage,
              api,
              uid: user.uid,
              host: host.name,
              llmFor: (j) =>
                createCassetteLlm({
                  dir: join(homedir(), '.qcard', 'jobs', `${j.projectId}-${j.id}`, 'llm'),
                  mode: 'resume',
                  inner: live,
                }),
              log: (l) => console.log(l),
            },
            running,
          );
        } finally {
          live.close?.();
          awake?.kill();
        }
      }
    } while (again);
  } finally {
    busy = false;
  }
}

/** 처리 중에만 맥의 잠자기를 막는다 (잠들면 타이머·네트워크가 멈춰 생성이 15분씩 멈춘다) */
function keepAwake(): ChildProcess | undefined {
  if (process.platform !== 'darwin') return undefined;
  return spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
}

onSnapshot(
  query(collectionGroup(db, 'jobs'), where('requestedBy', '==', user.uid)),
  (snap) => {
    if (snap.docChanges().some((c) => c.doc.data().status === 'queued')) void drain();
  },
  (e) => console.error(`작업 구독 실패: ${e.message}`),
);
console.log('웹에서 요청한 작업을 기다립니다 (Ctrl+C로 종료)');
