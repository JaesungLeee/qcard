/**
 * 이 PC를 qcard 계정에 연결·해제한다 (F-TM-14).
 *
 *   pnpm --filter @qcard/host-agent connect      브라우저로 웹의 연결 화면을 열고 [이 PC 연결]을 누르면 끝
 *   pnpm --filter @qcard/host-agent disconnect   이 PC의 연결을 해제하고 키체인의 자격을 지운다
 *   pnpm --filter @qcard/host-agent status       연결된 계정 확인
 *
 * 붙을 곳은 QCARD_FIREBASE_CONFIG·QCARD_WEB_URL (없으면 개발용 에뮬레이터와 http://localhost:5173 — `pnpm emu` + `pnpm dev:firebase`)
 */
import {
  credentialStore,
  HostDisconnectedError,
  machineName,
  openBrowser,
  openHostSession,
  pairInBrowser,
  signInHost,
  targetFromEnv,
} from './connect';

const command = process.argv[2];
const target = targetFromEnv();
const store = credentialStore(target);
const log = (l: string) => console.log(l);

try {
  if (command === 'connect') {
    const name = await machineName();
    const cred = await pairInBrowser({ webUrl: target.webUrl, name, open: openBrowser, log });
    await store.save(cred);
    const session = await signInHost(target, cred);
    log(`연결했습니다: ${session.host.name} → ${session.user.name}(@${session.user.github})`);
    log('이제 serve로 호스트 에이전트를 켜세요: pnpm --filter @qcard/host-agent serve');
  } else if (command === 'disconnect') {
    const session = await openHostSession({ target, store }).catch((e: unknown) => {
      if (e instanceof HostDisconnectedError) return undefined;
      throw e;
    });
    await session?.disconnect();
    await store.clear();
    log(session ? `연결을 해제했습니다: ${session.host.name}` : '연결된 계정이 없습니다. 보관한 자격만 지웠습니다.');
  } else if (command === 'status') {
    const session = await openHostSession({ target, store });
    log(`연결됨: ${session.host.name} → ${session.user.name}(@${session.user.github}) · ${target.config.projectId}`);
  } else {
    console.error('사용법: pair.ts connect | disconnect | status');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
process.exit();
