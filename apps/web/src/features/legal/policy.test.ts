import { describe, expect, it } from 'vitest';
import { EFFECTIVE_DATE, policyNoticeActive, seoulDate } from './policy';

describe('약관 변경 공지', () => {
  it('서울 날짜로 시행일 전에만 보이고, 이번 시행일 공지를 닫으면 숨긴다', () => {
    const day = (iso: string) => new Date(iso);
    // 시행일 전날 밤 11시(서울) = 그날 14:00 UTC
    const before = day(`${EFFECTIVE_DATE}T00:00:00+09:00`).getTime() - 60 * 60_000;
    expect(seoulDate(new Date(before))).not.toBe(EFFECTIVE_DATE);
    expect(policyNoticeActive(new Date(before), null)).toBe(true);
    expect(policyNoticeActive(new Date(before), '2026-01-01')).toBe(true);
    expect(policyNoticeActive(new Date(before), EFFECTIVE_DATE!)).toBe(false);
    expect(policyNoticeActive(day(`${EFFECTIVE_DATE}T00:00:00+09:00`), null)).toBe(false);
  });
});
