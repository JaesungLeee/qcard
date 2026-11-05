/*
 * 개인정보처리방침·이용약관의 운영자 정보 (docs/security.md, docs/roadmap.md 공개 출시 조건).
 * 시행일·문의처가 비어 있으면 두 문서는 "초안"으로 보인다.
 */

/** 운영자 표기 (서비스명만 쓴다) */
export const OPERATOR = 'qcard 운영자';
/** 개인정보 문의·정보주체 권리 행사 이메일. 공개 전 확정 */
export const CONTACT_EMAIL: string | undefined = 'viki0114@naver.com';
/** 시행일 (YYYY-MM-DD). 바꾸면 변경 공지 기간(시행 7일 전, 불리하면 30일 전)을 지킨다 */
export const EFFECTIVE_DATE: string | undefined = '2026-11-13';

export const isDraft = () => !CONTACT_EMAIL || !EFFECTIVE_DATE;

/** 이번 변경 요약 (시행 전 공지 배너에 보인다). 다음 변경 때 함께 바꾼다 */
export const CHANGE_SUMMARY = 'GitHub 이슈 연동 추가';

/** 서울 기준 오늘 (YYYY-MM-DD) */
export const seoulDate = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);

/** 시행 전 공지를 보일까: 시행일 전이고, 이번 시행일 공지를 닫지 않았다 */
export function policyNoticeActive(now: Date, dismissed: string | null): boolean {
  if (!EFFECTIVE_DATE || isDraft()) return false;
  return seoulDate(now) < EFFECTIVE_DATE && dismissed !== EFFECTIVE_DATE;
}

/** 공지를 닫은 기록 (localStorage). 값은 닫은 공지의 시행일 */
export const NOTICE_DISMISS_KEY = 'qcard.policyNotice';
