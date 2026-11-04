/** 로그인 뒤 돌아갈 기본 화면 (내 프로젝트 목록) */
export const HOME = '/projects';

/**
 * `?next=`로 받은 돌아갈 주소. 같은 사이트 안의 경로만 받는다 — `//evil.com`, `https://…`, `/\evil.com` 같은 값으로
 * 로그인 직후 다른 사이트로 보내는 것을 막는다. 로그인 페이지 자신이면 기본 화면으로.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return HOME;
  const base = 'http://qcard.invalid';
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return HOME;
  }
  if (url.origin !== base || url.pathname === '/login') return HOME;
  return url.pathname + url.search + url.hash;
}

/** 로그인 페이지 주소. 돌아갈 곳이 기본 화면이면 `next`를 붙이지 않는다 */
export function loginPath(next?: string): string {
  const to = next === undefined ? HOME : safeNext(next);
  return to === HOME ? '/login' : `/login?next=${encodeURIComponent(to)}`;
}

/** 사용자가 로그인 창을 직접 닫은 경우 — 오류로 보이지 않는다 */
const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

const MESSAGES: Record<string, string> = {
  'auth/popup-blocked': '브라우저가 로그인 창을 막았습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.',
  'auth/network-request-failed': '네트워크에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.',
  'auth/unauthorized-domain': '이 주소에서는 로그인할 수 없습니다. 서비스 관리자에게 알려 주세요.',
  'auth/operation-not-allowed': 'GitHub 로그인이 꺼져 있습니다. 서비스 관리자에게 알려 주세요.',
};

/** 로그인 실패를 사용자에게 보여 줄 문구로. 직접 취소했으면 undefined */
export function loginErrorMessage(e: unknown): string | undefined {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (CANCELLED.has(code)) return undefined;
  return MESSAGES[code] ?? (e instanceof Error ? e.message : String(e));
}
