import { describe, expect, it } from 'vitest';
import { connectedPcs, parseConnectRequest } from './model';

describe('parseConnectRequest: 호스트가 연 연결 화면 주소', () => {
  const ok = { port: '51234', nonce: 'abcdefghijklmnop_-12', name: 'MacBook Pro' };
  const parse = (p: Record<string, string>) => parseConnectRequest(new URLSearchParams(p));

  it('포트·nonce·PC 이름이 맞으면 읽는다', () => {
    expect(parse(ok)).toEqual({ port: 51234, nonce: 'abcdefghijklmnop_-12', name: 'MacBook Pro' });
  });

  it('형식이 맞지 않으면 연결하지 않는다', () => {
    for (const bad of [
      { ...ok, port: '80' },
      { ...ok, port: '70000' },
      { ...ok, port: '5173abc' },
      { ...ok, nonce: 'short' },
      { ...ok, nonce: 'abcdefghijklmnop<script>' },
      { ...ok, name: '   ' },
      { ...ok, name: 'x'.repeat(61) },
    ]) {
      expect(parse(bad)).toBeUndefined();
    }
  });
});

describe('connectedPcs', () => {
  it('연결 신호가 최근이면 켜짐, 없거나 오래됐으면 꺼짐', () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    const conn = (id: string) => ({ id, uid: 'u', name: id, connectedAt: '2026-10-20T00:00:00Z' });
    const pcs = connectedPcs(
      [conn('a'), conn('b'), conn('c')],
      [
        { id: 'a', name: 'a', lastSeen: '2026-10-24T09:59:30Z' },
        { id: 'b', name: 'b', lastSeen: '2026-10-24T09:00:00Z' },
      ],
      now,
    );
    expect(pcs.map((p) => [p.id, p.online, p.lastSeen])).toEqual([
      ['a', true, '2026-10-24T09:59:30Z'],
      ['b', false, '2026-10-24T09:00:00Z'],
      ['c', false, undefined],
    ]);
  });
});
