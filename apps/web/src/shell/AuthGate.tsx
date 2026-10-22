import { Button, Icons, Loading, SectionMessage, textClass } from '@qcard/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { TEST_USERS, usingEmulator, type FirebaseClient, type SignedIn } from '../data/firebaseClient';
import '../features/projects/projects.css';
import { PlainShell } from './PlainShell';

/** 로그아웃 등 로그인 동작. 메모리 구현(로그인 없음)에서는 null */
export const AuthContext = createContext<{ signOut: () => Promise<void> } | null>(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Firebase 모드에서 로그인해야 화면을 보여 준다. 사용자가 바뀌면 조회 캐시를 비운다.
 * 운영은 GitHub 로그인(F-TM-01), 에뮬레이터는 시드 사용자를 고른다.
 */
export function AuthGate({ client, children }: { client: FirebaseClient; children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<SignedIn | undefined>(undefined);
  useEffect(
    () =>
      client.onUser((u) => {
        qc.clear();
        setUser(u);
      }),
    [client, qc],
  );
  if (user === undefined) return <Loading aria-label="로그인 확인 중" />;
  if (user === null) return <LoginPage client={client} />;
  return <AuthContext.Provider value={{ signOut: client.signOut }}>{children}</AuthContext.Provider>;
}

function LoginPage({ client }: { client: FirebaseClient }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <PlainShell outsideRouter>
      <div className="qp-card qp-form-col" style={{ margin: '0 auto', width: '100%' }}>
        <h1 className={textClass('title3', 'bold')}>qcard 로그인</h1>
        <span className={`${textClass('label1')} qp-muted`}>
          GitHub 계정으로 로그인합니다. 초대는 GitHub 사용자명 기준입니다.
        </span>
        {usingEmulator ? (
          <>
            <SectionMessage variant="info" description="로컬 에뮬레이터(demo-qcard)입니다. 시드 사용자로 로그인합니다.">
              개발용 로그인
            </SectionMessage>
            <div className="qp-stack" style={{ gap: 8 }}>
              {TEST_USERS.map((u) => (
                <Button
                  key={u.github}
                  variant="outlined"
                  color="assistive"
                  disabled={busy}
                  onClick={() => run(() => client.signInTestUser(u.email))}
                >
                  {u.name} (@{u.github})
                </Button>
              ))}
            </div>
          </>
        ) : (
          <Button
            variant="solid"
            color="primary"
            leadingContent={<Icons.IconPerson />}
            disabled={busy}
            onClick={() => run(() => client.signInWithGithub())}
          >
            GitHub로 로그인
          </Button>
        )}
        {error && (
          <SectionMessage variant="negative" description={error}>
            로그인하지 못했습니다
          </SectionMessage>
        )}
      </div>
    </PlainShell>
  );
}
