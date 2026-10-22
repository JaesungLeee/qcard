import { DEVICE_SIZE, SCREENS, type MockElement } from '@qcard/fixtures';
import type { Bounds, ExecStep, Screenshot } from '@qcard/shared';
import { STEP_ACTION_LABEL } from '@qcard/shared';
import { token } from '@qcard/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useApi } from '../data/hooks';

/**
 * 디바이스 스크린샷 자리. fixture의 목업 화면(`kind: 'mock'`)은 요소 배치대로 그리고,
 * 실제 이미지(`kind: 'url'`)는 그대로, Storage 이미지(`kind: 'storage'`)는 로그인 상태로 받아 보여준다. 실제 이미지는 w·h(디바이스 px)가 있으면 그 비율을 쓴다. 디바이스 화면은 qcard 테마와 무관해야 하므로
 * 테마에 따라 바뀌지 않는 atomic·static 토큰만 쓴다.
 *
 * `action`을 주면 액션 표시(탭 위치·대상 박스·스와이프 화살표·액션 배지)를 겹쳐 그린다 (F-EX-06, F-DB-03).
 */
/** 실제 이미지 주소. Storage 이미지는 보안 규칙을 거쳐 받은 뒤 같은 경로는 다시 받지 않는다 */
function useImageSrc(screenshot: Screenshot): string | undefined {
  const api = useApi();
  const path = screenshot.kind === 'storage' ? screenshot.path : '';
  const stored = useQuery({
    queryKey: ['screenshot', path],
    queryFn: () => api.screenshotUrl(path),
    enabled: path !== '',
    staleTime: Infinity,
  });
  return screenshot.kind === 'url' ? screenshot.url : stored.data;
}

export function MockScreen({
  screenshot,
  width,
  action,
  highlight,
  label,
}: {
  screenshot: Screenshot;
  /** 화면 너비 (CSS px). 높이는 디바이스 비율로 정해진다. */
  width: number;
  action?: ExecStep;
  /** 강조할 요소 박스 (검증 포인트의 대상 요소 등) */
  highlight?: Bounds;
  /** 스크린 리더용 설명 */
  label?: string;
}) {
  const src = useImageSrc(screenshot);
  const size =
    screenshot.kind !== 'mock' && screenshot.w && screenshot.h ? { w: screenshot.w, h: screenshot.h } : DEVICE_SIZE;
  const scale = width / size.w;
  const height = Math.round(size.h * scale);
  // 액션 표시·강조 박스는 디바이스 좌표로 그린 뒤 화면 크기에 맞춰 줄인다
  const overlay = (
    <>
      {highlight && <Box bounds={highlight} color={token('atomic-orange-50')} dashed />}
      {action && <ActionOverlay step={action} size={size} />}
    </>
  );
  const layer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: size.w,
    height: size.h,
    transform: `scale(${scale})`,
    transformOrigin: '0 0',
  };
  const def = screenshot.kind === 'mock' ? SCREENS[screenshot.screen] : undefined;
  return (
    <div
      role="img"
      aria-label={label ?? def?.name ?? '디바이스 화면'}
      style={{
        position: 'relative',
        width,
        height,
        flex: 'none',
        overflow: 'hidden',
        borderRadius: Math.max(6, 48 * scale),
        background: token('static-white'),
        boxShadow: `0 0 0 ${Math.max(2, 10 * scale)}px ${token('atomic-cool-neutral-15')}`,
        margin: Math.max(2, 10 * scale),
      }}
    >
      {screenshot.kind !== 'mock' ? (
        <>
          {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {(highlight || action) && <div style={{ ...layer, pointerEvents: 'none' }}>{overlay}</div>}
        </>
      ) : (
        <div style={{ ...layer, fontFamily: 'var(--qc-font-sans)' }}>
          {def?.elements.map((el) =>
            el.kind === 'sheet' && def.dim ? (
              <Fragment key={el.id}>
                {/* 시트 아래 화면을 어둡게 덮는다 */}
                <div
                  style={{ position: 'absolute', inset: 0, background: token('atomic-cool-neutral-10'), opacity: 0.45 }}
                />
                <MockEl el={el} />
              </Fragment>
            ) : el.kind === 'toast' ? (
              <Toasts key={el.id} el={el} count={Number(screenshot.state?.toastCount ?? 1)} />
            ) : (
              <MockEl key={el.id} el={el} value={screenshot.state?.[el.id]} />
            ),
          )}
          {!def && (
            <Center
              bounds={{ x: 0, y: 1000, w: 1080, h: 200 }}
              style={{ fontSize: 44, color: token('atomic-cool-neutral-50') }}
            >
              알 수 없는 화면: {screenshot.kind === 'mock' ? screenshot.screen : ''}
            </Center>
          )}
          {overlay}
        </div>
      )}
    </div>
  );
}

const abs = (b: Bounds): CSSProperties => ({ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h });

function Center({ bounds, style, children }: { bounds: Bounds; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{
        ...abs(bounds),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const INK = () => token('atomic-cool-neutral-10');
const SUB = () => token('atomic-cool-neutral-50');
const LINE = () => token('atomic-cool-neutral-95');
const BRAND = () => token('atomic-blue-50');

function MockEl({ el, value }: { el: MockElement; value?: string }) {
  const b = el.bounds;
  switch (el.kind) {
    case 'statusbar':
      return (
        <div
          style={{
            ...abs(b),
            display: 'flex',
            alignItems: 'center',
            padding: '0 56px',
            fontSize: 34,
            fontWeight: 600,
            color: INK(),
          }}
        >
          {el.label}
          <span style={{ marginLeft: 'auto', letterSpacing: 6 }}>▂▄▆ ▮</span>
        </div>
      );
    case 'appbar-title':
      return (
        <Center bounds={b} style={{ fontSize: 50, fontWeight: 700, color: INK() }}>
          {el.label}
        </Center>
      );
    case 'text-button':
      return (
        <Center bounds={b} style={{ fontSize: 42, fontWeight: 600, color: SUB() }}>
          {el.label}
        </Center>
      );
    case 'icon-button':
      return (
        <Center bounds={b} style={{ fontSize: 64, color: INK() }}>
          <span aria-hidden>✕</span>
        </Center>
      );
    case 'title':
      return (
        <div
          style={{
            ...abs(b),
            fontSize: 60,
            lineHeight: '76px',
            fontWeight: 700,
            color: INK(),
            letterSpacing: '-0.02em',
          }}
        >
          {el.label}
        </div>
      );
    case 'body':
      return <div style={{ ...abs(b), fontSize: 40, lineHeight: '60px', color: SUB() }}>{el.label}</div>;
    case 'label':
      return <div style={{ ...abs(b), fontSize: 38, fontWeight: 700, color: BRAND() }}>{el.label}</div>;
    case 'input':
      return (
        <div
          style={{
            ...abs(b),
            border: `3px solid ${LINE()}`,
            borderRadius: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 44px',
            fontSize: 44,
            color: value ? INK() : SUB(),
          }}
        >
          {value ?? el.label}
        </div>
      );
    case 'image':
      return (
        <Center
          bounds={b}
          style={{
            background: token('atomic-cool-neutral-98'),
            border: `3px dashed ${token('atomic-cool-neutral-90')}`,
            borderRadius: 36,
            fontSize: 38,
            color: token('atomic-cool-neutral-60'),
          }}
        >
          {el.label}
        </Center>
      );
    case 'button':
      return (
        <Center
          bounds={b}
          style={{ background: BRAND(), color: token('static-white'), borderRadius: 32, fontSize: 46, fontWeight: 700 }}
        >
          {el.label}
        </Center>
      );
    case 'dots': {
      const [cur, total] = el.label.split('/').map(Number) as [number, number];
      return (
        <Center bounds={b} style={{ gap: 28 }}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              style={{
                width: i + 1 === cur ? 56 : 24,
                height: 24,
                borderRadius: 12,
                background: i + 1 === cur ? BRAND() : token('atomic-cool-neutral-90'),
              }}
            />
          ))}
        </Center>
      );
    }
    case 'sheet':
      return (
        <div
          style={{
            ...abs(b),
            background: token('static-white'),
            borderRadius: '48px 48px 0 0',
            padding: '56px 72px',
            fontSize: 46,
            fontWeight: 700,
            color: INK(),
          }}
        >
          {el.label}
        </div>
      );
    case 'app-icon':
      return (
        <div style={{ ...abs(b), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <span
            style={{
              width: 150,
              height: 150,
              borderRadius: 40,
              background: el.label === '하루콩' ? BRAND() : token('atomic-cool-neutral-95'),
            }}
          />
          <span style={{ fontSize: 34, color: INK() }}>{el.label}</span>
        </div>
      );
    case 'bottom-nav':
      return (
        <div
          style={{ ...abs(b), display: 'flex', borderTop: `3px solid ${LINE()}`, background: token('static-white') }}
        >
          {el.label.split(' · ').map((t, i) => (
            <Center
              key={t}
              bounds={{ x: (i * b.w) / 3, y: 0, w: b.w / 3, h: b.h }}
              style={{ fontSize: 36, fontWeight: 600, color: i === 0 ? INK() : SUB() }}
            >
              {t}
            </Center>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function Toasts({ el, count }: { el: MockElement; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Center
          key={i}
          bounds={{ ...el.bounds, x: el.bounds.x + i * 18, y: el.bounds.y - i * 28 }}
          style={{
            background: token('atomic-cool-neutral-15'),
            color: token('static-white'),
            borderRadius: 28,
            fontSize: 40,
            opacity: 1 - i * 0.12,
          }}
        >
          {el.label}
        </Center>
      ))}
    </>
  );
}

function Box({ bounds, color, dashed }: { bounds: Bounds; color: string; dashed?: boolean }) {
  return (
    <div
      style={{
        ...abs({ x: bounds.x - 8, y: bounds.y - 8, w: bounds.w + 16, h: bounds.h + 16 }),
        border: `8px ${dashed ? 'dashed' : 'solid'} ${color}`,
        borderRadius: 24,
        pointerEvents: 'none',
      }}
    />
  );
}

/** 액션 표시. 디바이스 좌표 위에 그린다. */
export function ActionOverlay({ step, size = DEVICE_SIZE }: { step: ExecStep; size?: { w: number; h: number } }) {
  const color = token('atomic-red-orange-50');
  const b = step.target?.bounds;
  const cx = b ? b.x + b.w / 2 : 0;
  const cy = b ? b.y + b.h / 2 : 0;
  const badge = !b && !step.swipe;
  return (
    <>
      {b && <Box bounds={b} color={color} />}
      {b && (step.action === 'tap' || step.action === 'input') && (
        <div
          style={{
            position: 'absolute',
            left: cx - 60,
            top: cy - 60,
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: color,
            opacity: 0.55,
            boxShadow: `0 0 0 16px ${color}`,
          }}
        />
      )}
      {step.swipe && (
        <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <defs>
            <marker
              id={`arrow-${step.index}`}
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          </defs>
          <line
            x1={step.swipe.from[0]}
            y1={step.swipe.from[1]}
            x2={step.swipe.to[0]}
            y2={step.swipe.to[1]}
            stroke={color}
            strokeWidth={20}
            strokeLinecap="round"
            markerEnd={`url(#arrow-${step.index})`}
          />
        </svg>
      )}
      {badge && (
        <div
          style={{
            position: 'absolute',
            left: 60,
            right: 60,
            top: size.h * 0.44,
            padding: '36px 48px',
            borderRadius: 36,
            background: color,
            color: token('static-white'),
            fontSize: 52,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {STEP_ACTION_LABEL[step.action]}
          {step.action === 'env' ? ` · ${step.input ?? 'pm clear'}` : ''}
        </div>
      )}
    </>
  );
}
