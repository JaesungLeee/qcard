import type { ConsoleVideoConfig, ExecStep } from '@qcard/shared';
import { Icons, textClass, token } from '@qcard/ui';
import { useEffect, useRef, useState } from 'react';
import { ActionOverlay } from '../../../mock/MockScreen';

/*
 * 실시간 디바이스 화면 (F-DB-01): 호스트가 중계하는 scrcpy H.264를 WebCodecs로 디코딩해 canvas에 그린다.
 * 패킷 = [플래그 1바이트: 1=키프레임] + Annex B (키프레임 앞에 SPS·PPS). 액션 오버레이는 디바이스 좌표로 겹친다.
 */

type Status = 'connecting' | 'live' | 'none' | 'unsupported';

/** Annex B에서 SPS(NAL 7)를 찾아 avc1.PPCCLL 코덱 문자열을 만든다 */
export function avcCodec(data: Uint8Array): string | undefined {
  for (let i = 0; i + 4 < data.length; i++) {
    const start3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    if (!start3) continue;
    const nal = data[i + 3]!;
    if ((nal & 0x1f) === 7 && i + 6 < data.length) {
      const hex = (b: number) => b.toString(16).padStart(2, '0');
      return `avc1.${hex(data[i + 4]!)}${hex(data[i + 5]!)}${hex(data[i + 6]!)}`;
    }
  }
  return undefined;
}

export function LiveScreen({
  width,
  screen,
  action,
}: {
  /** 화면 너비 (CSS px) */
  width: number;
  /** 디바이스 화면 크기 (px). 액션 오버레이 좌표계 */
  screen: { w: number; h: number };
  action?: ExecStep;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const height = Math.round((width * screen.h) / screen.w);

  useEffect(() => {
    if (typeof VideoDecoder === 'undefined') {
      setStatus('unsupported');
      return;
    }
    let decoder: VideoDecoder | undefined;
    let codec: string | undefined;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let sock: WebSocket | undefined;

    const draw = (frame: VideoFrame) => {
      const c = canvas.current;
      if (c) {
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
          c.width = frame.displayWidth;
          c.height = frame.displayHeight;
        }
        c.getContext('2d')?.drawImage(frame, 0, 0);
        setStatus('live');
      }
      frame.close();
    };
    const reset = () => {
      if (decoder && decoder.state !== 'closed') decoder.close();
      decoder = undefined;
      codec = undefined;
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      sock = new WebSocket(`${proto}://${location.host}/console-api/screen`);
      sock.binaryType = 'arraybuffer';
      sock.onmessage = (e) => {
        if (typeof e.data === 'string') {
          const c = JSON.parse(e.data) as ConsoleVideoConfig;
          if (c.type === 'video') reset();
          return;
        }
        const p = new Uint8Array(e.data as ArrayBuffer);
        const key = (p[0]! & 1) === 1;
        const data = p.subarray(1);
        if (key) {
          const next = avcCodec(data);
          if (next && next !== codec) {
            reset();
            decoder = new VideoDecoder({ output: draw, error: () => reset() });
            // description이 없으면 Annex B로 받는다
            decoder.configure({ codec: next, optimizeForLatency: true });
            codec = next;
          }
        }
        if (!decoder || decoder.state !== 'configured') return;
        // 디코더가 밀리면 다음 키프레임까지 프레임을 버린다 (지연이 쌓이지 않게)
        if (!key && decoder.decodeQueueSize > 10) return;
        decoder.decode(
          new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data }),
        );
      };
      sock.onclose = () => {
        reset();
        if (closed) return;
        setStatus('none');
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      sock?.close();
      reset();
    };
  }, []);

  const scale = width / screen.w;
  return (
    <div
      role="img"
      aria-label="실시간 디바이스 화면"
      style={{
        position: 'relative',
        width,
        height,
        flex: 'none',
        overflow: 'hidden',
        borderRadius: Math.max(6, 48 * scale),
        background: token('atomic-cool-neutral-10'),
        boxShadow: `0 0 0 ${Math.max(2, 10 * scale)}px ${token('atomic-cool-neutral-15')}`,
        margin: Math.max(2, 10 * scale),
      }}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} />
      {action && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: screen.w,
            height: screen.h,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            pointerEvents: 'none',
          }}
        >
          <ActionOverlay step={action} size={screen} />
        </div>
      )}
      {status !== 'live' && (
        <div
          className={textClass('label2', 'medium')}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: 16,
            textAlign: 'center',
            color: token('static-white'),
          }}
        >
          <Icons.IconMobile aria-hidden style={{ width: 24, height: 24 }} />
          {status === 'connecting' && '화면 연결 중…'}
          {status === 'none' && '화면 스트림이 없습니다 — 디바이스 화면이 꺼져 있거나 scrcpy가 없습니다'}
          {status === 'unsupported' && '이 브라우저는 영상 디코딩(WebCodecs)을 지원하지 않습니다. Chrome에서 여세요'}
        </div>
      )}
    </div>
  );
}
