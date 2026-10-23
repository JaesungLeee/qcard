import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { execAdb, resolveAdb } from '@qcard/device/node';
import type { ConsoleVideoConfig } from '@qcard/shared';

/*
 * 디바이스 화면 스트림 (F-DB-01): scrcpy 서버를 디바이스에서 띄워 H.264를 받아 로컬 콘솔로 중계한다.
 * 서버 디바이스 → 이 PC(adb forward) → 브라우저(WebSocket, WebCodecs로 디코딩). 화면은 서버를 거치지 않는다.
 *   - scrcpy 서버는 /data/local/tmp에 올려 app_process로 실행하고, 끝나면 지운다(cleanup). 앱 설치·데이터와 무관하다
 *   - 입력 제어는 끈다(control=false) — 조작은 Agent(adb)와 실행자의 손으로만 한다
 */

export type VideoListener = { config(c: ConsoleVideoConfig): void; packet(p: Uint8Array): void };
export interface VideoFeed {
  subscribe(l: VideoListener): () => void;
}

/**
 * 받은 패킷을 구독자에게 나눠 준다. 늦게 들어온 화면도 바로 그릴 수 있게 마지막 키프레임부터의 패킷을 갖고 있다.
 * 패킷 = [플래그 1바이트: 1=키프레임] + Annex B. 설정 패킷(SPS·PPS)은 다음 키프레임 앞에 붙인다.
 */
export class VideoHub implements VideoFeed {
  private listeners = new Set<VideoListener>();
  private cfg: ConsoleVideoConfig | undefined;
  private params: Uint8Array | undefined;
  private gop: Uint8Array[] = [];

  subscribe(l: VideoListener) {
    this.listeners.add(l);
    if (this.cfg) l.config(this.cfg);
    for (const p of this.gop) l.packet(p);
    return () => void this.listeners.delete(l);
  }

  setConfig(c: ConsoleVideoConfig) {
    this.cfg = c;
    this.gop = [];
    for (const l of this.listeners) l.config(c);
  }

  /** 디코더 설정 데이터 (SPS·PPS) */
  setParams(data: Uint8Array) {
    this.params = data;
  }

  frame(data: Uint8Array, key: boolean) {
    if (!key && this.gop.length === 0) return; // 키프레임 전의 프레임은 그릴 수 없다
    const body = key && this.params ? concat(this.params, data) : data;
    const p = new Uint8Array(body.length + 1);
    p[0] = key ? 1 : 0;
    p.set(body, 1);
    if (key) this.gop = [];
    if (this.gop.length < 600) this.gop.push(p);
    for (const l of this.listeners) l.packet(p);
  }
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * scrcpy(5.x) 영상 소켓 파서: [더미 1바이트] [코덱 4바이트] 다음 패킷마다 12바이트 헤더 (빅엔디언)
 *   - 세션 패킷 (bit63): [플래그 4][너비 4][높이 4], 본문 없음. 처음과 회전·해상도가 바뀔 때 온다
 *   - 미디어 패킷: [pts·플래그 8: bit62 설정(SPS·PPS), bit61 키프레임][크기 4][데이터]
 */
export class ScrcpyParser {
  private buf: Uint8Array = new Uint8Array(0);
  private stage: 'dummy' | 'codec' | 'packets';

  constructor(
    private readonly out: {
      session(s: { width: number; height: number }): void;
      packet(p: { config: boolean; key: boolean; data: Uint8Array }): void;
    },
    dummyByte = true,
  ) {
    this.stage = dummyByte ? 'dummy' : 'codec';
  }

  push(chunk: Uint8Array) {
    this.buf = this.buf.length ? concat(this.buf, chunk) : chunk;
    for (;;) {
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      if (this.stage === 'dummy') {
        if (this.buf.length < 1) return;
        this.buf = this.buf.subarray(1);
        this.stage = 'codec';
      } else if (this.stage === 'codec') {
        if (this.buf.length < 4) return;
        this.buf = this.buf.subarray(4); // h264 (요청한 코덱)
        this.stage = 'packets';
      } else {
        if (this.buf.length < 12) return;
        const flags = v.getUint8(0);
        if (flags & 0x80) {
          this.out.session({ width: v.getUint32(4), height: v.getUint32(8) });
          this.buf = this.buf.subarray(12);
          continue;
        }
        const size = v.getUint32(8);
        if (this.buf.length < 12 + size) return;
        this.out.packet({
          config: (flags & 0x40) !== 0,
          key: (flags & 0x20) !== 0,
          data: this.buf.slice(12, 12 + size),
        });
        this.buf = this.buf.subarray(12 + size);
      }
    }
  }
}

const SERVER_CANDIDATES = [
  process.env.SCRCPY_SERVER_PATH,
  '/opt/homebrew/share/scrcpy/scrcpy-server',
  '/usr/local/share/scrcpy/scrcpy-server',
];
const DEVICE_JAR = '/data/local/tmp/qcard-scrcpy-server.jar';

/** 설치된 scrcpy의 서버 파일과 버전 (서버 버전이 정확히 맞아야 한다) */
export async function findScrcpy(): Promise<{ server: string; version: string } | undefined> {
  const server = SERVER_CANDIDATES.find((p) => p && existsSync(p));
  if (!server) return undefined;
  const out = await new Promise<string>((resolve) => {
    const p = spawn('scrcpy', ['--version']);
    let s = '';
    p.stdout.on('data', (d: Buffer) => (s += d.toString()));
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(s));
  });
  const version = /scrcpy (\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1];
  return version ? { server, version } : undefined;
}

/** scrcpy 서버를 띄워 화면을 hub로 보낸다. stop()으로 끈다 */
export async function startScrcpy(opts: {
  serial: string;
  hub: VideoHub;
  maxSize?: number;
  log?: (line: string) => void;
}): Promise<{ stop(): Promise<void>; alive(): boolean }> {
  const log = opts.log ?? (() => {});
  const found = await findScrcpy();
  if (!found) throw new Error('scrcpy가 없습니다 (brew install scrcpy). 화면 없이 진행합니다');
  const adb = execAdb(resolveAdb(), 30_000);
  const scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, '0');
  const socketName = `scrcpy_${scid}`;
  const s = (...a: string[]) => ['-s', opts.serial, ...a];

  await adb(s('push', found.server, DEVICE_JAR));
  const port = 27200 + Math.floor(Math.random() * 800);
  await adb(s('forward', `tcp:${port}`, `localabstract:${socketName}`));

  const args = [
    `CLASSPATH=${DEVICE_JAR}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    found.version,
    `scid=${scid}`,
    'log_level=warn',
    'tunnel_forward=true',
    'audio=false',
    'control=false',
    'video_codec=h264',
    `max_size=${opts.maxSize ?? 1280}`,
    'max_fps=30',
    'video_bit_rate=4000000',
    // 늦게 연 화면도 금방 그릴 수 있게 키프레임을 자주 둔다
    'video_codec_options=i-frame-interval=2',
    'send_device_meta=false',
    'send_dummy_byte=true',
    'send_stream_meta=true',
    'send_frame_meta=true',
    'cleanup=true',
  ];
  const proc: ChildProcess = spawn(resolveAdb(), s('shell', ...args), { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr?.on('data', (d: Buffer) => log(`scrcpy: ${d.toString().trim()}`));
  proc.stdout?.on('data', (d: Buffer) => log(`scrcpy: ${d.toString().trim()}`));

  const parser = new ScrcpyParser({
    session: (m) => opts.hub.setConfig({ type: 'video', width: m.width, height: m.height }),
    packet: (p) => (p.config ? opts.hub.setParams(p.data) : opts.hub.frame(p.data, p.key)),
  });

  // 서버가 소켓을 열 때까지 연결을 다시 시도한다 (adb forward는 서버가 없어도 연결을 받고 바로 끊는다)
  let socket: Socket | undefined;
  for (let i = 0; i < 50 && !socket; i++) {
    socket = await tryConnect(port);
    if (!socket) await new Promise((r) => setTimeout(r, 100));
  }
  if (!socket) {
    proc.kill();
    await adb(s('forward', '--remove', `tcp:${port}`)).catch(() => {});
    throw new Error('scrcpy 서버에 연결하지 못했습니다');
  }
  socket.on('data', (d: Buffer) => parser.push(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)));
  socket.on('error', (e) => log(`scrcpy 소켓: ${e.message}`));
  // 디바이스가 빠지면 서버·소켓이 끝난다 — 다시 연결되면 새로 띄운다
  let dead = false;
  proc.on('exit', () => (dead = true));
  socket.on('close', () => (dead = true));
  socket.resume();

  return {
    alive: () => !dead,
    async stop() {
      dead = true;
      socket?.destroy();
      proc.kill();
      await adb(s('forward', '--remove', `tcp:${port}`)).catch(() => {});
    },
  };
}

/** 연결해서 첫 바이트(더미)가 오면 그 소켓을, 바로 끊기면 undefined */
function tryConnect(port: number): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    const fail = () => {
      sock.destroy();
      resolve(undefined);
    };
    sock.once('error', fail);
    sock.once('close', fail);
    sock.once('data', (d: Buffer) => {
      sock.removeListener('close', fail);
      sock.removeListener('error', fail);
      // 받은 첫 조각은 되돌려 둔다 (더미 바이트 + 이어진 데이터). 받는 쪽이 리스너를 단 뒤 resume한다
      sock.pause();
      sock.unshift(d);
      resolve(sock);
    });
  });
}
