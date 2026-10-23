import { HOST_ONLINE_MS, type Host, type HostConnection } from '@qcard/shared';

/** 처음 쓰는 PC를 계정에 연결하는 명령 (그 PC의 터미널에서) */
export const CONNECT_COMMAND = 'pnpm --filter @qcard/host-agent connect';
/**
 * 화면에 보여 주는 호스트 명령(CONNECT_COMMAND·SERVE_COMMAND)은 저장소 안에서만 동작하는 개발용이다.
 * 패키징(설치형 CLI·앱) 뒤에는 명령과 함께 이 안내를 바꾼다
 */
export const DEV_COMMAND_NOTE = '개발용 명령 — qcard 저장소 루트에서 실행합니다';

/** 호스트가 연 연결 화면 주소 `/connect?port&nonce&name`. 형식이 맞지 않으면 undefined */
export type ConnectRequest = { port: number; nonce: string; name: string };

export function parseConnectRequest(params: URLSearchParams): ConnectRequest | undefined {
  const port = Number(params.get('port'));
  const nonce = params.get('nonce') ?? '';
  const name = (params.get('name') ?? '').trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  if (!/^[\w-]{16,128}$/.test(nonce)) return undefined;
  if (!name || name.length > 60) return undefined;
  return { port, nonce, name };
}

/** 자격을 넘길 곳: 그 PC의 호스트 에이전트가 127.0.0.1에 잠깐 연 서버 (같은 PC의 브라우저만 닿는다) */
export const pairEndpoint = (port: number) => `http://127.0.0.1:${port}/pair`;

/** 연결된 PC + 지금 켜져 있는지 (호스트 연결 신호) */
export type ConnectedPc = HostConnection & { online: boolean; lastSeen?: string };

export function connectedPcs(connections: HostConnection[], hosts: Host[], now = Date.now()): ConnectedPc[] {
  const seen = new Map(hosts.map((h) => [h.id, h.lastSeen]));
  return connections.map((c) => {
    const lastSeen = seen.get(c.id);
    return {
      ...c,
      online: !!lastSeen && now - Date.parse(lastSeen) < HOST_ONLINE_MS,
      ...(lastSeen ? { lastSeen } : {}),
    };
  });
}
