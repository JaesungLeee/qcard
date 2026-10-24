import type {
  ConsoleClientMessage,
  ConsoleControl,
  ConsoleHome,
  ConsoleServerMessage,
  LiveConsole,
} from '@qcard/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 호스트 에이전트 연결 상태. unauthorized = 세션 쿠키 없음 (호스트가 출력한 주소로 열어야 한다) */
export type HostLink = 'connecting' | 'open' | 'closed' | 'unauthorized';

/** 호스트가 보여 주는 것: Run 중이면 실행 상태, 아니면 홈 (사이클 고르기) */
export type ConsoleView = { kind: 'run'; state: LiveConsole } | { kind: 'home'; home: ConsoleHome };

export type StartRun = Omit<Extract<ConsoleClientMessage, { type: 'start' }>, 'type'>;

/** 로컬 콘솔 구독: 호스트가 상태를 통째로 밀어 주고, 제어·Run 시작은 같은 소켓으로 보낸다. 끊기면 다시 붙는다 */
export function useLiveConsole() {
  const [view, setView] = useState<ConsoleView>();
  const [link, setLink] = useState<HostLink>('connecting');
  /** 호스트가 거절한 요청 (Run 시작 실패 등) */
  const [error, setError] = useState<string>();
  /** 웹 대시보드 주소 (호스트가 알려 준다). 없으면 같은 출처 — 개발 서버 */
  const [dashboardUrl, setDashboardUrl] = useState<string>();
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/console-api/ws`);
      ws.current = sock;
      sock.onopen = () => {
        opened = true;
        setLink('open');
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ConsoleServerMessage;
        if (m.type === 'state') setView({ kind: 'run', state: m.state });
        else if (m.type === 'home') setView({ kind: 'home', home: m.home });
        else if (m.type === 'info') setDashboardUrl(m.dashboardUrl);
        else setError(m.message);
      };
      sock.onclose = () => {
        if (stopped) return;
        // 한 번도 열리지 않았으면 쿠키가 없는 것 (서버가 업그레이드를 거절)
        setLink(opened ? 'closed' : 'unauthorized');
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);

  const send = useCallback((m: ConsoleClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  const control = useCallback((action: ConsoleControl) => send({ type: 'control', action }), [send]);
  const start = useCallback(
    (r: StartRun) => {
      setError(undefined);
      send({ type: 'start', ...r });
    },
    [send],
  );
  const refresh = useCallback(() => send({ type: 'refresh' }), [send]);

  return { view, link, error, dashboardUrl, dismissError: () => setError(undefined), control, start, refresh };
}
