import { describe, expect, it } from 'vitest';
import { loginErrorMessage, loginPath, safeNext } from './loginRedirect';

describe('safeNext: 로그인 뒤 돌아갈 주소', () => {
  it('같은 사이트의 경로는 쿼리·해시까지 그대로 돌려준다', () => {
    expect(safeNext('/invite/atlas-join')).toBe('/invite/atlas-join');
    expect(safeNext('/p/haru/cycles/c1?tab=cases#TC-1')).toBe('/p/haru/cycles/c1?tab=cases#TC-1');
  });

  it('없거나 다른 사이트로 나가는 값이면 내 프로젝트 목록으로', () => {
    for (const raw of [
      null,
      '',
      'projects',
      '//evil.com',
      '/\\evil.com',
      'https://evil.com/x',
      'javascript:alert(1)',
    ]) {
      expect(safeNext(raw)).toBe('/projects');
    }
  });

  it('로그인 페이지 자신으로는 돌아가지 않는다', () => {
    expect(safeNext('/login?next=/x')).toBe('/projects');
  });
});

describe('loginPath', () => {
  it('기본 화면이면 next를 붙이지 않고, 아니면 인코딩해서 붙인다', () => {
    expect(loginPath()).toBe('/login');
    expect(loginPath('/projects')).toBe('/login');
    expect(loginPath('/p/haru/cycles?tab=cases')).toBe('/login?next=%2Fp%2Fharu%2Fcycles%3Ftab%3Dcases');
  });
});

describe('loginErrorMessage', () => {
  it('사용자가 로그인 창을 닫았으면 오류로 보이지 않는다', () => {
    expect(loginErrorMessage({ code: 'auth/popup-closed-by-user' })).toBeUndefined();
  });

  it('알려진 코드는 해결 방법을, 나머지는 원래 메시지를 보여 준다', () => {
    expect(loginErrorMessage({ code: 'auth/popup-blocked' })).toContain('팝업을 허용');
    expect(loginErrorMessage(new Error('GitHub 사용자를 확인하지 못했습니다 (401).'))).toBe(
      'GitHub 사용자를 확인하지 못했습니다 (401).',
    );
  });
});
