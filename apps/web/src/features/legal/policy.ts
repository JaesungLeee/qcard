/*
 * 개인정보처리방침·이용약관의 운영자 정보 (PRD §8, §10 공개 출시 조건).
 * 시행일·문의처가 비어 있으면 두 문서는 "초안"으로 보인다.
 */

/** 운영자 표기 (서비스명만 쓴다) */
export const OPERATOR = 'qcard 운영자';
/** 개인정보 문의·정보주체 권리 행사 이메일. 공개 전 확정 */
export const CONTACT_EMAIL: string | undefined = 'viki0114@naver.com';
/** 시행일 (YYYY-MM-DD). 바꾸면 변경 공지 기간(시행 7일 전, 불리하면 30일 전)을 지킨다 */
export const EFFECTIVE_DATE: string | undefined = '2026-11-01';

export const isDraft = () => !CONTACT_EMAIL || !EFFECTIVE_DATE;
