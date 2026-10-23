import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { CONSOLE_CONTROLS, type ConsoleClientMessage, type ConsoleServerMessage } from '@qcard/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ConsoleHub } from './hub';
import type { VideoFeed } from './video';

/** 콘솔 서버 뒤의 실행 쪽: 상태를 밀어 주고, 화면의 요청을 받는다 */
export interface ConsoleBackend {
  /** 구독하면 지금 상태를 바로 한 번 보낸다 */
  subscribe(send: (m: ConsoleServerMessage) => void): () => void;
  /** 모양 검사를 거친 요청만 온다 */
  handle(m: ConsoleClientMessage): void;
  /** 스텝 썸네일 (저장 경로 → PNG) */
  shot(path: string): Uint8Array | undefined;
}

/** Run 하나만 보여 주는 콘솔 (run-cycle): 허브를 그대로 쓴다 */
export function hubBackend(hub: ConsoleHub): ConsoleBackend {
  return {
    subscribe: (send) => hub.subscribe((state) => send({ type: 'state', state })),
    handle: (m) => {
      if (m.type === 'control') hub.control(m.action);
    },
    shot: (p) => hub.shot(p),
  };
}

/** 화면에서 온 요청 모양 검사 */
export function parseClientMessage(raw: string): ConsoleClientMessage | undefined {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!m || typeof m !== 'object') return undefined;
  const o = m as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;
  if (o.type === 'control' && CONSOLE_CONTROLS.includes(o.action as never)) return o as ConsoleClientMessage;
  if (o.type === 'refresh') return { type: 'refresh' };
  if (o.type === 'start' && str(o.projectId) && str(o.cycleId)) {
    const tcIds = Array.isArray(o.tcIds) && o.tcIds.every(str) ? o.tcIds : undefined;
    return {
      type: 'start',
      projectId: o.projectId,
      cycleId: o.cycleId,
      ...(tcIds ? { tcIds } : {}),
      ...(str(o.resumeRunId) ? { resumeRunId: o.resumeRunId } : {}),
    };
  }
  return undefined;
}

/*
 * 로컬 콘솔 서버 (PRD §8 로컬 콘솔 보호):
 *   - 127.0.0.1에만 바인딩한다
 *   - 실행할 때 만든 일회용 토큰 URL(/console-api/auth?token=…)을 세션 쿠키(HttpOnly, SameSite=Strict)로 바꾼다
 *   - 모든 HTTP·WebSocket 요청의 Host·Origin을 검사해 다른 웹페이지의 요청과 DNS 리바인딩을 막는다
 * 경로: /console-api/ws (상태·제어), /console-api/screen (디바이스 화면 H.264). 그 밖은 웹 빌드(staticDir)를 준다.
 * 개발 중에는 Vite 개발 서버가 /console-api를 이리로 넘긴다 — 그 출처는 allowedOrigins로 허용한다.
 */

export type ConsoleServerOptions = {
  backend: ConsoleBackend;
  video?: VideoFeed;
  /** 0이면 빈 포트 */
  port?: number;
  /** 웹 빌드 폴더 (apps/web/dist). 없으면 API만 */
  staticDir?: string;
  /** 추가로 허용할 출처 (개발: http://localhost:5173) */
  allowedOrigins?: string[];
  /** 콘솔 주소 열림·로그인 기록 */
  log?: (line: string) => void;
  /** 일회용 주소로 로그인했을 때 (웹에 실어 둔 주소를 새것으로 바꾸게) */
  onLogin?: () => void;
};

export type ConsoleServer = {
  port: number;
  /**
   * 브라우저로 열 일회용 URL. 부를 때마다 새로 만든다 (한 번 쓰면 무효).
   * ttlMs를 주면 그 시간이 지나도 무효 (웹에 실어 보내는 주소, 터미널에 찍는 주소는 만료 없음)
   */
  loginUrl(origin?: string, ttlMs?: number): string;
  /** 화면 스트림을 나중에 붙인다 (scrcpy가 뜬 뒤) */
  attachVideo(video: VideoFeed): void;
  close(): Promise<void>;
};

const COOKIE = 'qcard_console';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

export async function startConsoleServer(opts: ConsoleServerOptions): Promise<ConsoleServer> {
  /** 일회용 토큰 → 만료 시각(없으면 만료 없음). 주소를 줄 때마다 새로 만들고, 쓰거나 만료되면 지운다 */
  const tokens = new Map<string, number | undefined>();
  const sessions = new Set<string>();
  let port = 0;
  let video = opts.video;

  const origins = () =>
    new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(opts.allowedOrigins ?? [])]);
  const hosts = () => new Set([...origins()].map((o) => new URL(o).host));

  /** Host는 항상, Origin은 있으면 허용 목록이어야 한다 */
  const trusted = (req: IncomingMessage) => {
    const host = req.headers.host;
    if (!host || !hosts().has(host)) return false;
    const origin = req.headers.origin;
    return origin === undefined || origins().has(origin);
  };
  const session = (req: IncomingMessage) => {
    const m = /(?:^|;\s*)qcard_console=([^;]+)/.exec(req.headers.cookie ?? '');
    return m !== null && sessions.has(m[1]!);
  };
  const findToken = (got: string) => {
    const a = Buffer.from(got);
    const now = Date.now();
    for (const [t, until] of tokens) if (until !== undefined && until < now) tokens.delete(t);
    for (const t of tokens.keys()) {
      const b = Buffer.from(t);
      if (a.length === b.length && timingSafeEqual(a, b)) return t;
    }
    return undefined;
  };
  const hasToken = (got: string) => findToken(got) !== undefined;
  /** 맞는 토큰을 찾아 지운다 (한 번만 쓴다) */
  const useToken = (got: string) => {
    const t = findToken(got);
    if (t) tokens.delete(t);
    return t !== undefined;
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!trusted(req)) return void res.writeHead(403).end('forbidden');
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/console-api/auth') {
      const ua = String(req.headers['user-agent'] ?? '-').slice(0, 80);
      const purpose = String(req.headers['sec-purpose'] ?? req.headers.purpose ?? '');
      // 이미 콘솔에 들어온 브라우저는 다시 열어도 콘솔로 보낸다
      if (session(req)) {
        return void res.writeHead(303, { location: '/console/live', 'cache-control': 'no-store' }).end();
      }
      if (req.method === 'GET') {
        // 주소를 여는 것만으로는 토큰을 쓰지 않는다. 링크 미리보기·미리 로드·검사기가 먼저 열어도
        // 토큰이 남도록, 사람이 [로컬 콘솔 열기]를 눌러야(POST) 들어간다
        const token = url.searchParams.get('token') ?? '';
        const ok = hasToken(token);
        opts.log?.(`콘솔 주소 열림 (${ok ? '유효' : '만료'}${purpose ? ` · ${purpose}` : ''} · ${ua})`);
        if (!ok) return void expired(res);
        return void res
          .writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            // no-referrer면 Chrome이 폼의 Origin을 null로 보내 출처 검사에 막힌다. 바깥으로만 안 보낸다
            'referrer-policy': 'same-origin',
          })
          .end(openPage(token));
      }
      if (req.method !== 'POST') return void res.writeHead(405).end();
      const body = await readBody(req, 4096).catch(() => '');
      const used = useToken(new URLSearchParams(body).get('token') ?? '');
      opts.log?.(`콘솔 로그인 ${used ? '성공' : '실패 (만료된 주소)'} · ${ua}`);
      if (!used) return void expired(res);
      const id = randomBytes(24).toString('base64url');
      sessions.add(id);
      opts.onLogin?.();
      return void res
        .writeHead(303, {
          'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`,
          location: '/console/live',
          'cache-control': 'no-store',
        })
        .end();
    }

    if (url.pathname.startsWith('/console-api/')) {
      if (!session(req)) return void res.writeHead(401).end();
      const png = url.pathname === '/console-api/shot' ? opts.backend.shot(url.searchParams.get('p') ?? '') : undefined;
      if (png)
        return void res
          .writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' })
          .end(png);
      return void res.writeHead(404).end();
    }
    if (!opts.staticDir) return void res.writeHead(404).end();
    // 웹 빌드: 파일이 없으면 index.html (SPA)
    const root = normalize(opts.staticDir);
    const file = normalize(join(root, decodeURIComponent(url.pathname)));
    const inside = file === root || file.startsWith(root + sep);
    const target = inside && (await stat(file).catch(() => undefined))?.isFile() ? file : join(root, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' }).end(body);
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!trusted(req) || !session(req) || (path !== '/console-api/ws' && path !== '/console-api/screen')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => (path === '/console-api/ws' ? stateSocket(ws) : screenSocket(ws)));
  });

  function stateSocket(ws: WebSocket) {
    const send = (m: ConsoleServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    const off = opts.backend.subscribe(send);
    ws.on('message', (raw) => {
      const m = parseClientMessage(String(raw));
      if (m) opts.backend.handle(m);
      else send({ type: 'error', message: '알 수 없는 요청' });
    });
    ws.on('close', off);
  }

  function screenSocket(ws: WebSocket) {
    if (!video) return ws.close(1011, '화면 스트림 없음');
    const off = video.subscribe({
      config: (c) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(c)),
      packet: (p) => {
        // 느린 화면은 프레임을 버린다 (지연이 쌓이지 않게). 키프레임은 버리지 않는다
        if (ws.readyState !== ws.OPEN || (ws.bufferedAmount > 2_000_000 && !(p[0]! & 1))) return;
        ws.send(p);
      },
    });
    ws.on('close', off);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as { port: number }).port;

  return {
    port,
    loginUrl: (origin = `http://127.0.0.1:${port}`, ttlMs) => {
      const token = randomBytes(24).toString('base64url');
      tokens.set(token, ttlMs === undefined ? undefined : Date.now() + ttlMs);
      return `${origin}/console-api/auth?token=${token}`;
    },
    attachVideo: (v) => (video = v),
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

function expired(res: ServerResponse) {
  res
    .writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    .end('만료된 주소입니다. 호스트 에이전트가 출력한 새 주소로 여세요 (serve 터미널에서 Enter).');
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 토큰을 쓰기 전 확인 페이지: 사람이 버튼을 눌러야 들어간다 (토큰은 base64url이라 그대로 넣어도 안전) */
function openPage(token: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>qcard 로컬 콘솔</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0">
<form method="post" action="/console-api/auth" style="text-align:center">
<h1 style="font-size:20px">qcard 로컬 콘솔</h1>
<p>이 PC의 호스트 에이전트에 연결합니다. 이 주소는 한 번만 쓸 수 있습니다.</p>
<input type="hidden" name="token" value="${token.replace(/[^A-Za-z0-9_-]/g, '')}">
<button type="submit" style="font-size:16px;padding:10px 20px">로컬 콘솔 열기</button>
</form></body></html>`;
}
