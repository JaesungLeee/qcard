import { useEffect, useMemo, useReducer } from 'react';
import { initialState, jumpState, reduce, type JumpTarget, type PlaybackAction, type Script } from './playback';

/** 시계 대역: 콜백에 경과 ms를 넣어 주고, 해제 함수를 돌려준다. 테스트·스냅샷에서는 쓰지 않는다. */
export type Ticker = (onTick: (dt: number) => void) => () => void;

export const intervalTicker: Ticker = (onTick) => {
  let last = performance.now();
  const id = window.setInterval(() => {
    const now = performance.now();
    onTick(now - last);
    last = now;
  }, 100);
  return () => window.clearInterval(id);
};

export function usePlayback(script: Script, at: JumpTarget | undefined, ticker: Ticker = intervalTicker) {
  const reducer = useMemo(
    () => (s: ReturnType<typeof initialState>, a: PlaybackAction) => reduce(script, s, a),
    [script],
  );
  const [state, dispatch] = useReducer(reducer, at, (x) => (x === undefined ? initialState() : jumpState(script, x)));
  const ticking = state.live && (state.phase === 'running' || state.phase === 'manual' || state.phase === 'verifying');
  useEffect(() => {
    if (!ticking) return;
    return ticker((dt) => dispatch({ type: 'tick', dt }));
  }, [ticking, ticker]);
  return [state, dispatch] as const;
}
