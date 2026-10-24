import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startConsoleServer, type ConsoleBackend, type ConsoleServer } from './server';
import { startScrcpy, VideoHub } from './video';

/** 개발 서버(pnpm dev). 떠 있으면 콘솔 화면은 여기서 열고, /console-api는 Vite가 콘솔 서버로 넘긴다 */
export const DEV_WEB = 'http://localhost:5173';
/** 웹 대시보드에 실어 보내는 콘솔 주소의 수명 (연결 신호마다 새로 만든다) */
export const WEB_CONSOLE_URL_TTL_MS = 120_000;

/**
 * 로컬 콘솔 서버를 띄우고 한 번만 열 수 있는 주소를 출력한다.
 * 개발 서버가 떠 있으면 그 주소를, 아니면 웹 빌드를 이 서버가 직접 준다: 배포한 패키지는 번들 옆 `web/`,
 * 저장소에서는 apps/web/dist (빌드는 오래됐을 수 있다)
 */
export async function launchConsole(
  backend: ConsoleBackend,
  log: (line: string) => void,
  opts: { onLogin?: () => void } = {},
): Promise<{ server: ConsoleServer; printUrl: () => void; webUrl: () => string } | undefined> {
  // 배포한 `qcard` 명령은 개발 서버를 찾지 않는다 (사용자 PC의 5173 포트에 다른 앱이 떠 있을 수 있다)
  const devUp =
    !process.env.QCARD_CLI &&
    (await fetch(DEV_WEB, { signal: AbortSignal.timeout(1000) }).then(
      (r) => r.ok,
      () => false,
    ));
  const dist = [join(import.meta.dirname, 'web'), resolve(import.meta.dirname, '../../../web/dist')].find((d) =>
    existsSync(join(d, 'index.html')),
  );
  const useDist = !devUp && !!dist;
  const server = await startConsoleServer({
    backend,
    port: Number(process.env.QCARD_CONSOLE_PORT ?? 4801),
    staticDir: useDist ? dist : undefined,
    allowedOrigins: [DEV_WEB],
    log,
    onLogin: opts.onLogin,
  }).catch((e: Error) => {
    log(`로컬 콘솔을 띄우지 못했습니다 (${e.message}) — 콘솔 없이 진행합니다`);
    return undefined;
  });
  if (!server) return undefined;
  /** 새 일회용 주소를 만들어 출력한다 */
  const printUrl = () =>
    log(
      `로컬 콘솔: ${server.loginUrl(useDist ? undefined : DEV_WEB)}\n  (한 번만 열 수 있는 주소${useDist ? '' : ' · pnpm dev가 떠 있어야 합니다'})`,
    );
  printUrl();
  /** 웹 사이드바의 [로컬 콘솔]이 열 주소 (내 호스트 문서에 실어 보낸다, 본인만 읽는다) */
  const webUrl = () => server.loginUrl(useDist ? undefined : DEV_WEB, WEB_CONSOLE_URL_TTL_MS);
  return { server, printUrl, webUrl };
}

/** 디바이스 화면 스트림을 띄워 콘솔에 붙인다. 실패하면 화면 없이 진행한다 */
export async function attachScreen(server: ConsoleServer, serial: string, log: (line: string) => void) {
  const hub = new VideoHub();
  const video = await startScrcpy({ serial, hub, log: (l) => log(`  ${l}`) }).catch((e: Error) => {
    log(`실시간 화면 없이 진행합니다: ${e.message}`);
    return undefined;
  });
  if (video) server.attachVideo(hub);
  return video;
}
