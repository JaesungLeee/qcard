import { Loading } from '@qcard/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { FirebaseClient, SignedIn } from '../data/firebaseClient';
import { loginPath } from './loginRedirect';

export type Auth = {
  user: SignedIn;
  /** 사용자가 직접 로그아웃했는지. 그때는 로그인 페이지로 보낼 때 돌아갈 주소를 붙이지 않는다 */
  signedOut: boolean;
  signInWithGithub: () => Promise<void>;
  signInTestUser: (email: string) => Promise<unknown>;
  signOut: () => Promise<void>;
};

/** 로그인 상태와 동작. 메모리 구현(로그인 없음)에서는 null */
export const AuthContext = createContext<Auth | null>(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Firebase 모드의 로그인 상태를 내려 준다. 사용자가 바뀌면 조회 캐시를 비운다.
 * 로그인 화면은 라우터의 `/login`(LoginPage)이 그리고, 로그인이 필요한 화면은 RequireAuth가 그리로 보낸다 (F-TM-01).
 */
export function AuthGate({ client, children }: { client: FirebaseClient; children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<SignedIn | undefined>(undefined);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(
    () =>
      client.onUser((u) => {
        qc.clear();
        setUser(u);
        if (u) setSignedOut(false);
      }),
    [client, qc],
  );
  const auth = useMemo<Auth | null>(
    () =>
      user === undefined
        ? null
        : {
            user,
            signedOut,
            signInWithGithub: client.signInWithGithub,
            signInTestUser: client.signInTestUser,
            signOut: async () => {
              setSignedOut(true);
              await client.signOut();
            },
          },
    [client, user, signedOut],
  );
  if (!auth) return <Loading aria-label="로그인 확인 중" />;
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** 로그인이 필요한 화면들의 레이아웃 라우트. 로그인하지 않았으면 지금 주소를 붙여 로그인 페이지로 보낸다 */
export function RequireAuth() {
  const auth = useAuth();
  const { pathname, search, hash } = useLocation();
  if (auth && !auth.user) {
    return <Navigate to={auth.signedOut ? loginPath() : loginPath(pathname + search + hash)} replace />;
  }
  return <Outlet />;
}
