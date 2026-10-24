/**
 * 이 PC를 qcard 계정에 연결·해제한다 (F-TM-14).
 *
 *   pnpm --filter @qcard/host connect      브라우저로 웹의 연결 화면을 열고 [이 PC 연결]을 누르면 끝
 *                                          (이미 연결돼 있으면 그대로 둔다. --force: 다시 연결하고 예전 연결 해제)
 *   pnpm --filter @qcard/host disconnect   이 PC의 연결을 해제하고 키체인의 자격을 지운다
 *   pnpm --filter @qcard/host status       연결된 계정 확인
 *
 * 붙을 곳은 QCARD_FIREBASE_CONFIG·QCARD_WEB_URL (없으면 개발용 에뮬레이터와 http://localhost:5173 — `pnpm emu` + `pnpm dev:firebase`)
 */
import {
  connectHost,
  credentialStore,
  hostCommand,
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
    const r = await connectHost({
      store,
      force: process.argv.slice(3).includes('--force'),
      pair: () => pairInBrowser({ webUrl: target.webUrl, name, open: openBrowser, log }),
      signIn: (c) => signInHost(target, c),
    });
    const { host, user } = r.session;
    if (r.status === 'already') {
      log(`이미 연결되어 있습니다: ${host.name} → ${user.name}(@${user.github})`);
      log(`다른 계정으로 다시 연결하려면: ${hostCommand('connect --force')}`);
    } else {
      log(`연결했습니다: ${host.name} → ${user.name}(@${user.github})`);
      if (r.replaced && !r.replaced.revoked) {
        log(`예전 연결(${r.replaced.name})을 해제하지 못했습니다. 웹의 [연결된 PC]에서 해제하세요.`);
      }
      log(`이제 호스트 에이전트를 켜세요: ${hostCommand('serve')}`);
    }
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
