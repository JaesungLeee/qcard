import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { OnDemandScreen, ScrcpyParser, VideoHub } from '../src/console';

const header = (hi: number, lo: number, size: number) => {
  const b = new Uint8Array(12);
  const v = new DataView(b.buffer);
  v.setUint32(0, hi);
  v.setUint32(4, lo);
  v.setUint32(8, size);
  return b;
};
const bytes = (...parts: (Uint8Array | number[])[]) => new Uint8Array(parts.flatMap((p) => [...p]));

describe('scrcpy 스트림', () => {
  it('세션·설정·키프레임·일반 프레임을 나누고, 조각나 와도 이어 붙인다', () => {
    const got: string[] = [];
    const parser = new ScrcpyParser({
      session: (s) => got.push(`session ${s.width}x${s.height}`),
      packet: (p) => got.push(`${p.config ? 'config' : p.key ? 'key' : 'frame'} ${p.data.length}`),
    });
    const stream = bytes(
      [0],
      [0x68, 0x32, 0x36, 0x34], // h264
      header(0x80000000, 590, 1280),
      header(0x40000000, 0, 3),
      [1, 2, 3],
      header(0x20000007, 1, 4),
      [9, 9, 9, 9],
      header(0x00000007, 2, 2),
      [5, 5],
    );
    // 3바이트씩 잘라 넣는다
    for (let i = 0; i < stream.length; i += 3) parser.push(stream.slice(i, i + 3));
    expect(got).toEqual(['session 590x1280', 'config 3', 'key 4', 'frame 2']);
  });

  it('늦게 구독해도 설정 + 마지막 키프레임부터 받는다, 키프레임 전 프레임은 버린다', () => {
    const hub = new VideoHub();
    hub.setConfig({ type: 'video', width: 590, height: 1280 });
    hub.frame(new Uint8Array([7]), false); // 키프레임 전 — 버림
    hub.setParams(new Uint8Array([1, 2]));
    hub.frame(new Uint8Array([3]), true);
    hub.frame(new Uint8Array([4]), false);
    const got: unknown[] = [];
    hub.subscribe({ config: (c) => got.push(c), packet: (p) => got.push([...p]) });
    expect(got).toEqual([{ type: 'video', width: 590, height: 1280 }, [1, 1, 2, 3], [0, 4]]);
  });
});

describe('OnDemandScreen', () => {
  const noop = { config() {}, packet() {} };
  const setup = (fail = false) => {
    const log: string[] = [];
    const streams: { stopped: boolean; dead: boolean }[] = [];
    let now = 0;
    const screen = new OnDemandScreen({
      start: async () => {
        if (fail) throw new Error('adb 오류');
        const s = { stopped: false, dead: false };
        streams.push(s);
        return { alive: () => !s.dead && !s.stopped, stop: async () => void (s.stopped = true) };
      },
      log: (l) => log.push(l),
      idleMs: 1000,
      retryMs: 5000,
      now: () => now,
    });
    return { screen, streams, log, tick: (ms: number) => (now += ms) };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('보는 사람이 생기면 띄우고, 마지막 화면이 닫히고 idleMs 뒤에 끈다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { screen, streams } = setup();
      expect(streams).toHaveLength(0); // 붙이기만 해서는 띄우지 않는다
      const a = screen.subscribe(noop);
      const b = screen.subscribe(noop);
      await vi.advanceTimersByTimeAsync(0);
      expect(streams).toHaveLength(1);
      a();
      b();
      await vi.advanceTimersByTimeAsync(500);
      const c = screen.subscribe(noop); // 새로고침: 끄지 않는다
      await vi.advanceTimersByTimeAsync(2000);
      expect(streams).toEqual([{ stopped: false, dead: false }]);
      c();
      await vi.advanceTimersByTimeAsync(1000);
      expect(streams[0]!.stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('끊긴 스트림은 wake()로 다시 띄우고, 실패하면 retryMs 동안 다시 시도하지 않는다', async () => {
    const { screen, streams, log } = setup();
    screen.subscribe(noop);
    await flush();
    streams[0]!.dead = true;
    screen.wake();
    await flush();
    expect(streams).toHaveLength(2);
    expect(streams[0]!.stopped).toBe(true); // 끊긴 것은 정리하고 새로

    const f = setup(true);
    f.screen.subscribe(noop);
    await flush();
    f.screen.wake();
    await flush();
    expect(f.log.filter((l) => l.includes('띄우지 못했습니다'))).toHaveLength(1);
    f.tick(5000);
    f.screen.wake();
    await flush();
    expect(f.log.filter((l) => l.includes('띄우지 못했습니다'))).toHaveLength(2);
    expect(log).toEqual(['실시간 화면 켬', '실시간 화면 켬']);
  });

  it('stop() 뒤에는 보는 사람이 있어도 다시 띄우지 않는다', async () => {
    const { screen, streams } = setup();
    screen.subscribe(noop);
    await flush();
    await screen.stop();
    screen.wake();
    screen.subscribe(noop);
    await flush();
    expect(streams).toHaveLength(1);
    expect(streams[0]!.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------- 허브: 제어 (F-DB-05)

import { RunAbortedError } from '@qcard/agent';
import { qaDocV130 } from '@qcard/fixtures';
import type { LiveConsole } from '@qcard/shared';
import { WebSocket } from 'ws';
import { ConsoleHub, hubBackend, startConsoleServer } from '../src/console';

const TC = qaDocV130.cases[0]!;
const newHub = (manualTimeoutMs?: number) => {
  const hub = new ConsoleHub(
    {
      projectId: 'p',
      cycleId: 'c',
      cycleName: '사이클',
      build: { version: '1.0.0', buildNumber: 1 },
      runId: 'run-1',
      executor: '이재성',
      device: {
        serial: 'S',
        model: 'SM-S711N',
        osBuild: '16',
        resolution: '1080×2340',
        connection: 'USB',
        status: 'running',
      },
      screen: { w: 1080, h: 2340 },
      claudeCode: { installed: true, loggedIn: true },
      caseTokenLimit: 600_000,
    },
    { manualTimeoutMs },
  );
  hub.setQueue([TC]);
  hub.caseStarted(TC);
  return hub;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('콘솔 허브', () => {
  it('일시정지 중에는 Agent가 기다리고, 재개하면 이어 간다', async () => {
    const hub = newHub();
    hub.control('pause');
    expect(hub.interrupted()).toBe(true);
    let signal: string | undefined;
    void hub.checkpoint().then((s) => (signal = s));
    await tick();
    expect(signal).toBeUndefined();
    hub.control('resume');
    await tick();
    expect(signal).toBe('continue');
    expect(hub.snapshot().phase).toBe('running');
  });

  it('Take over 후 반환하면 took_over, 건너뛰기는 skip, 중단은 abort', async () => {
    const hub = newHub();
    hub.control('takeOver');
    const p = hub.checkpoint();
    await tick();
    expect(hub.snapshot().phase).toBe('takeover');
    hub.control('returnToAgent');
    expect(await p).toBe('took_over');
    expect(await hub.checkpoint()).toBe('continue');

    hub.control('skip');
    expect(hub.interrupted()).toBe(true);
    expect(await hub.checkpoint()).toBe('skip');

    hub.control('pause');
    const q = hub.checkpoint();
    hub.control('abort');
    expect(await q).toBe('abort');
  });

  it('수동 스텝은 [완료]를 기다리고, 시간이 지나면 timeout, 대기 중 중단하면 던진다', async () => {
    const hub = newHub(30);
    const done = hub.onManual('직접 사진을 고른다');
    expect(hub.snapshot()).toMatchObject({ phase: 'manual', manual: { instruction: '직접 사진을 고른다' } });
    hub.control('completeManual');
    expect(await done).toBe('done');
    expect(hub.snapshot().phase).toBe('running');

    expect(await hub.onManual('다시')).toBe('timeout');

    const aborted = hub.onManual('또');
    hub.control('abort');
    await expect(aborted).rejects.toBeInstanceOf(RunAbortedError);
  });

  it('위험 액션: [승인]이면 approved, [직접 실행 → 반환]이면 took_over, 답이 없으면 timeout (F-EX-10)', async () => {
    const req = {
      kind: 'people',
      level: 'approval',
      reason: '친구에게 초대가 간다',
      source: 'agent',
      action: '탭 · 보내기',
    } as const;
    const hub = newHub(30);
    const approved = hub.onRisk(req);
    expect(hub.snapshot()).toMatchObject({ phase: 'approval', approval: { action: '탭 · 보내기', level: 'approval' } });
    hub.control('approve');
    expect(await approved).toEqual({ decision: 'approved', by: '이재성' });
    expect(hub.snapshot()).toMatchObject({ phase: 'running', approval: undefined });

    // 직접 실행하는 동안은 시간 제한이 없다
    const took = hub.onRisk(req);
    hub.control('takeOver');
    await new Promise((r) => setTimeout(r, 60));
    expect(hub.snapshot()).toMatchObject({ phase: 'takeover', approval: { level: 'approval' } });
    hub.control('returnToAgent');
    expect(await took).toEqual({ decision: 'took_over', by: '이재성' });
    // 반환이 위험 액션을 끝냈을 뿐, 다음 턴에 Take over로 또 보고하지 않는다
    expect(await hub.checkpoint()).toBe('continue');

    expect(await hub.onRisk(req)).toEqual({ decision: 'timeout' });

    // 사람 전용은 [승인]으로 넘어가지 않는다
    const human = hub.onRisk({ ...req, kind: 'identity', level: 'human' });
    hub.control('approve');
    expect(hub.snapshot().phase).toBe('approval');
    hub.control('abort');
    await expect(human).rejects.toBeInstanceOf(RunAbortedError);
  });

  it('모델 응답을 기다리는 동안을 상태에 남긴다 (콘솔이 오래 걸리면 알린다)', () => {
    const hub = newHub();
    hub.llmStarted(180_000);
    expect(hub.snapshot().llmWait).toMatchObject({ limitMs: 180_000 });
    hub.llmEnded();
    expect(hub.snapshot().llmWait).toBeUndefined();
  });

  it('스텝·사고 로그를 케이스에 쌓고, 판정하면 큐에 남긴다', () => {
    const hub = newHub();
    const tap = {
      action: 'tap',
      intent: '저장',
      screenshot: { kind: 'mock', screen: 'profile' },
      videoTs: 0,
      durationMs: 10,
      caseStepIndex: 0,
    } as const;
    hub.step({ ...tap, index: 0 }); // 준비 플로우
    hub.phase('steps');
    hub.thought({ at: 0, kind: 'decide', text: '저장을 누른다' });
    hub.step({ ...tap, index: 0 });
    hub.phase('verify');
    hub.thought({ at: 0, kind: 'verify', text: 'P1 match' });
    const s = hub.snapshot();
    expect(s.current?.steps.map((x) => [x.index, x.caseStepIndex])).toEqual([
      [1, undefined],
      [2, 0],
    ]);
    expect(s.current?.thoughts.map((x) => x.stepIndex)).toEqual([2, 3]);
    expect(s).toMatchObject({ phase: 'verifying', current: { verified: 1 } });
    hub.caseFinished(TC, { verdict: 'pass' } as never);
    expect(hub.snapshot().queue).toEqual([expect.objectContaining({ tcId: TC.tcId, status: 'done', verdict: 'pass' })]);
  });
});

// ---------------------------------------------------------------- 서버: 로컬 콘솔 보호 (PRD §8)

describe('로컬 콘솔 서버', () => {
  it('일회용 토큰을 쿠키로 바꾸고, Host·Origin·쿠키가 맞아야 상태를 받고 제어할 수 있다', async () => {
    const hub = newHub();
    const server = await startConsoleServer({ backend: hubBackend(hub) });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const link = server.loginUrl();
      const token = new URL(link).searchParams.get('token')!;
      const post = (t: string, headers: Record<string, string> = {}) =>
        fetch(`${base}/console-api/auth`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, ...headers },
          body: new URLSearchParams({ token: t }).toString(),
        });
      // 주소를 열기만 해서는(링크 미리보기·다른 브라우저) 토큰을 쓰지 않는다 — 버튼 페이지만 보인다
      for (let i = 0; i < 2; i++) {
        const page = await fetch(link, { redirect: 'manual' });
        expect([page.status, (await page.text()).includes('로컬 콘솔 열기')]).toEqual([200, true]);
      }
      const login = await post(token);
      expect(login.status).toBe(303);
      const cookie = login.headers.get('set-cookie')!;
      expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
      // 같은 토큰은 다시 쓸 수 없다
      expect((await post(token)).status).toBe(403);
      expect((await fetch(link, { redirect: 'manual' })).status).toBe(403);
      // 다른 출처에서 보낸 로그인은 막는다
      expect(
        (await post(new URL(server.loginUrl()).searchParams.get('token')!, { origin: 'https://evil.example' })).status,
      ).toBe(403);
      // 새 주소는 따로 쓸 수 있다 (다른 브라우저에서 열 때)
      expect((await post(new URL(server.loginUrl()).searchParams.get('token')!)).status).toBe(303);
      // 다른 출처·Host는 막는다 (다른 웹페이지·DNS 리바인딩)
      expect((await fetch(`${base}/console-api/x`, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
      const withHost = await new Promise<number>((resolve) =>
        request(
          { host: '127.0.0.1', port: server.port, path: '/console-api/x', headers: { host: 'evil.example' } },
          (r) => resolve(r.statusCode!),
        ).end(),
      );
      expect(withHost).toBe(403);

      const session = cookie.split(';')[0]!;
      // 이미 들어온 브라우저는 쓴 주소를 다시 열어도 콘솔로 간다
      const again = await fetch(link, { redirect: 'manual', headers: { cookie: session } });
      expect([again.status, again.headers.get('location')]).toEqual([303, '/console/live']);
      const states: LiveConsole[] = [];
      const open = (headers: Record<string, string>) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${server.port}/console-api/ws`, { headers });
          ws.on('message', (m) => states.push((JSON.parse(String(m)) as { state: LiveConsole }).state));
          ws.once('open', () => resolve(ws));
          ws.once('error', reject);
          ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
        });
      await expect(open({ origin: base })).rejects.toThrow('403');
      await expect(open({ cookie: session, origin: 'https://evil.example' })).rejects.toThrow('403');

      const ws = await open({ cookie: session, origin: base });
      await new Promise((r) => setTimeout(r, 50));
      expect(states[0]?.current?.tcId).toBe(TC.tcId);
      ws.send(JSON.stringify({ type: 'control', action: 'pause' }));
      await new Promise((r) => setTimeout(r, 50));
      expect(hub.snapshot().phase).toBe('paused');
      expect(states.at(-1)?.phase).toBe('paused');
      ws.close();
    } finally {
      await server.close();
    }
  });

  it('웹에 실어 보내는 주소는 정해진 시간이 지나면 못 쓰고, 로그인하면 알린다 (새 주소를 올리게)', async () => {
    const hub = newHub();
    let logins = 0;
    const server = await startConsoleServer({ backend: hubBackend(hub), onLogin: () => logins++ });
    const base = `http://127.0.0.1:${server.port}`;
    const post = (link: string) =>
      fetch(`${base}/console-api/auth`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
        body: new URLSearchParams({ token: new URL(link).searchParams.get('token')! }).toString(),
      });
    try {
      const expired = server.loginUrl(undefined, -1);
      expect((await fetch(expired, { redirect: 'manual' })).status).toBe(403);
      expect((await post(expired)).status).toBe(403);
      expect(logins).toBe(0);
      expect((await post(server.loginUrl(undefined, 60_000))).status).toBe(303);
      expect(logins).toBe(1);
    } finally {
      await server.close();
    }
  });
});
