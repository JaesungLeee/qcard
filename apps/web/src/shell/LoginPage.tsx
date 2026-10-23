import { Button, SectionMessage, textClass } from '@qcard/ui';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { TEST_USERS, usingEmulator } from '../data/firebaseClient';
import '../features/projects/projects.css';
import { useAuth } from './AuthGate';
import { loginErrorMessage, safeNext } from './loginRedirect';
import { PlainShell } from './PlainShell';

/**
 * 로그인 페이지 `/login?next=<돌아갈 주소>` (F-TM-01). GitHub 로그인만 있고, 로그인하면 next로 돌아간다.
 * 에뮬레이터는 시드 사용자를 고르고, 메모리 구현(로그인 없음)은 버튼을 누르면 그대로 들어간다(화면 확인용).
 */
export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // 로그인 중에는 프로필 등록(registerProfile)이 끝날 때까지 기다렸다가 넘어간다
  if (auth?.user && !busy) return <Navigate to={next} replace />;

  const run = (signIn: (() => Promise<unknown>) | undefined) => {
    if (!signIn) return void navigate(next, { replace: true });
    setBusy(true);
    setError(undefined);
    signIn()
      .catch((e: unknown) => setError(loginErrorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <PlainShell showUser={false}>
      <div className="qp-card qp-form-col" style={{ margin: '0 auto', width: '100%', maxWidth: 400, wordBreak: 'keep-all' }}>
        <div className="qp-stack" style={{ gap: 8 }}>
          <h1 className={textClass('title3', 'bold')}>qcard에 로그인</h1>
          <p className={`${textClass('label1')} qp-muted`} style={{ margin: 0 }}>
            스펙 문서로 앱 버전별 QA 문서를 만들고, Agent가 Android 디바이스에서 직접 수행합니다.
          </p>
        </div>
        {next.startsWith('/invite/') && (
          <SectionMessage variant="info" description="로그인하면 초대 화면으로 돌아갑니다.">
            초대를 수락하려면 먼저 로그인하세요
          </SectionMessage>
        )}
        {usingEmulator ? (
          <div className="qp-stack" style={{ gap: 8 }}>
            <span className={`${textClass('label2', 'medium')} qp-faint`}>개발용 로그인 (에뮬레이터 시드 사용자)</span>
            {TEST_USERS.map((u) => (
              <Button
                key={u.github}
                variant="outlined"
                color="assistive"
                disabled={busy}
                onClick={() => run(() => auth!.signInTestUser(u.email))}
              >
                {u.name} (@{u.github})
              </Button>
            ))}
          </div>
        ) : (
          <Button
            variant="solid"
            color="primary"
            leadingContent={<GithubMark />}
            fullWidth
            loading={busy}
            onClick={() => run(auth?.signInWithGithub)}
          >
            GitHub로 계속하기
          </Button>
        )}
        <span className={`${textClass('caption1')} qp-faint`}>
          GitHub 계정으로만 로그인합니다. 프로젝트 초대는 GitHub 사용자명 기준입니다.
        </span>
        {error && (
          <SectionMessage variant="negative" description={error}>
            로그인하지 못했습니다
          </SectionMessage>
        )}
      </div>
    </PlainShell>
  );
}

/** GitHub 마크 (Octicons mark-github, MIT). Montage 아이콘에 GitHub 로고가 없어 직접 그린다 */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
