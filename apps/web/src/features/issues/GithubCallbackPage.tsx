// GitHub에서 돌아오는 곳 `/github/callback?code&installation_id&state` (docs/product/issues.md#저장소-연결).
// 연결하는 사람이 접근할 수 있는 저장소만 보이고, 하나를 골라 프로젝트에 연결한다
import type { ConnectableRepo } from '@qcard/shared';
import { Button, Icons, Loading, SectionMessage, textClass } from '@qcard/ui';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckLabel } from '../../components/CheckLabel';
import { useConnectableRepos, useConnectRepo } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';
import '../projects/projects.css';
import './issues.css';

export function GithubCallbackPage() {
  const [params] = useSearchParams();
  const state = params.get('state');
  return (
    <div className="qc-page">
      <div className="qp-card qp-form-col" style={{ margin: '0 auto', width: '100%', maxWidth: 640 }}>
        <div className="qp-row" style={{ gap: 12 }}>
          <Icons.IconLink aria-hidden style={{ width: 24, height: 24 }} />
          <h1 className={textClass('title3', 'bold')}>GitHub 저장소 연결</h1>
        </div>
        {state ? (
          <Pick
            state={state}
            code={params.get('code') ?? undefined}
            installationId={Number(params.get('installation_id')) || undefined}
          />
        ) : (
          <SectionMessage variant="info" description="프로젝트 설정의 [GitHub 저장소 연결]에서 시작하세요.">
            GitHub App 설치를 마쳤습니다
          </SectionMessage>
        )}
      </div>
    </div>
  );
}

function Pick({ state, code, installationId }: { state: string; code?: string; installationId?: number }) {
  const navigate = useNavigate();
  const list = useConnectableRepos({ state, ...(code ? { code } : {}), ...(installationId ? { installationId } : {}) });
  const connect = useConnectRepo();
  const [picked, setPicked] = useState<ConnectableRepo>();
  const [confirmPublic, setConfirmPublic] = useState(false);
  if (list.isPending) return <Loading aria-label="저장소를 확인하는 중" />;
  if (list.error) return <ErrorMessage error={list.error} title="저장소를 확인하지 못했습니다" />;
  const { projectId, projectName, login, repos } = list.data;
  return (
    <div className="qi-stack" style={{ gap: 'var(--qc-space-16)' }}>
      <span className={`${textClass('label2')} qi-muted`}>
        「{projectName}」에 연결할 저장소를 고르세요. @{login}이(가) 접근할 수 있는 저장소만 보입니다.
      </span>
      {repos.length === 0 ? (
        <SectionMessage
          variant="cautionary"
          description="App을 설치할 때 저장소를 고르지 않았거나, 조직 저장소라 조직 Admin의 설치 승인을 기다리고 있을 수 있습니다. 승인된 뒤 다시 연결하세요."
        >
          연결할 저장소가 보이지 않습니다
        </SectionMessage>
      ) : (
        <div className="qi-stack" role="radiogroup" aria-label="저장소">
          {repos.map((r) => (
            <button
              key={r.repoId}
              type="button"
              role="radio"
              aria-checked={picked?.repoId === r.repoId}
              className="qi-template"
              style={picked?.repoId === r.repoId ? { borderColor: 'var(--qc-line-brand-strong)' } : undefined}
              onClick={() => {
                setPicked(r);
                setConfirmPublic(false);
              }}
            >
              <span className={`qc-mono ${textClass('label1', 'bold')}`}>
                {r.owner}/{r.name}
              </span>
              <span className={`${textClass('caption1')} qi-muted`}>{r.private ? '비공개' : '공개 저장소'}</span>
            </button>
          ))}
        </div>
      )}
      {picked && !picked.private && (
        <>
          <SectionMessage
            variant="cautionary"
            description="이슈는 누구나 볼 수 있습니다. 미공개 스펙 내용이 들어갈 수 있습니다."
          >
            공개 저장소입니다
          </SectionMessage>
          <CheckLabel
            className={`qi-row ${textClass('label1', 'medium')}`}
            checked={confirmPublic}
            onCheckedChange={setConfirmPublic}
          >
            확인했습니다
          </CheckLabel>
        </>
      )}
      <ErrorMessage error={connect.error} title="연결하지 못했습니다" />
      <div className="qi-row" style={{ justifyContent: 'flex-end' }}>
        <Link to={`/p/${projectId}/settings`} className={`qi-link ${textClass('label2', 'medium')}`}>
          취소
        </Link>
        <Button
          size="small"
          variant="solid"
          color="primary"
          disabled={!picked || (!picked.private && !confirmPublic) || connect.isPending}
          onClick={() =>
            picked &&
            connect.mutate(
              { state, repoId: picked.repoId, ...(picked.private ? {} : { confirmPublic }) },
              { onSuccess: () => void navigate(`/p/${projectId}/settings`) },
            )
          }
        >
          연결
        </Button>
      </div>
    </div>
  );
}
