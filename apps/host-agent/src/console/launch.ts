import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startConsoleServer, type ConsoleBackend, type ConsoleServer } from './server';
import { startScrcpy, VideoHub } from './video';

/** 개발 서버(pnpm dev). 떠 있으면 콘솔 화면은 여기서 열고, /console-api는 Vite가 콘솔 서버로 넘긴다 */
export const DEV_WEB = 'http://localhost:5173';

/**
 * 로컬 콘솔 서버를 띄우고 한 번만 열 수 있는 주소를 출력한다.
 * 개발 서버가 떠 있으면 그 주소를, 아니면 웹 빌드(apps/web/dist)를 이 서버가 직접 준다 (빌드는 오래됐을 수 있다)
 */
export async function launchConsole(
  backend: ConsoleBackend,
  log: (line: string) => void,
): Promise<{ server: ConsoleServer; printUrl: () => void } | undefined> {
  const devUp = await fetch(DEV_WEB, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );
  const dist = resolve(import.meta.dirname, '../../../web/dist');
  const useDist = !devUp && existsSync(join(dist, 'index.html'));
  const server = await startConsoleServer({
    backend,
    port: Number(process.env.QCARD_CONSOLE_PORT ?? 4801),
    staticDir: useDist ? dist : undefined,
    allowedOrigins: [DEV_WEB],
    log,
  }).catch((e: Error) => {
    log(`로컬 콘솔을 띄우지 못했습니다 (${e.message}) — 콘솔 없이 진행합니다`);
    return undefined;
  });
  if (!server) return undefined;
  /** 새 일회용 주소를 만들어 출력한다 */
  const printUrl = () =>
    log(
      `로컬 콘솔: ${server.loginUrl(useDist ? undefined : DEV_WEB)}\n  (한 번만 열 수 있는 주소${useDist ? ' · 웹 빌드 apps/web/dist' : ' · pnpm dev가 떠 있어야 합니다'})`,
    );
  printUrl();
  return { server, printUrl };
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
