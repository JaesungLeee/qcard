import { HOST_ONLINE_MS, hostOutdated, type Host, type HostConnection } from '@qcard/shared';

/** 호스트 에이전트 설치 (npm 패키지 `@qcard/host`, 명령 `qcard`) */
export const INSTALL_COMMAND = 'npm i -g @qcard/host';
/** 처음 쓰는 PC를 계정에 연결하는 명령 (그 PC의 터미널에서) */
export const CONNECT_COMMAND = 'qcard connect';
/** 명령 아래에 붙이는 설치 안내 */
export const INSTALL_NOTE = `처음 쓰는 PC라면 먼저 설치하세요: ${INSTALL_COMMAND} (Node.js 22 이상, macOS)`;

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

/**
 * 연결된 PC + 지금 켜져 있는지 (호스트 연결 신호). outdated: 켜져 있는데 Run을 맡길 수 없는 이전 버전이다
 */
export type ConnectedPc = HostConnection & { online: boolean; lastSeen?: string; version?: string; outdated: boolean };

export function connectedPcs(connections: HostConnection[], hosts: Host[], now = Date.now()): ConnectedPc[] {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  return connections.map((c) => {
    const host = byId.get(c.id);
    const online = !!host && now - Date.parse(host.lastSeen) < HOST_ONLINE_MS;
    return {
      ...c,
      online,
      ...(host ? { lastSeen: host.lastSeen } : {}),
      ...(host?.version ? { version: host.version } : {}),
      outdated: online && hostOutdated(host),
    };
  });
}
