import { Button, Icons, SectionMessage, textClass } from '@qcard/ui';
import type { HostCredential } from '@qcard/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi, useConnectHost } from '../../data/hooks';
import { PlainShell } from '../../shell/PlainShell';
import { ErrorMessage } from '../projects/parts';
import '../projects/projects.css';
import { CONNECT_COMMAND, INSTALL_NOTE, pairEndpoint, parseConnectRequest } from './model';
import './hosts.css';

/**
 * 이 PC 연결 `/connect?port&nonce&name` (F-TM-14). 호스트 에이전트의 `connect`가 브라우저로 연다.
 * [이 PC 연결]을 누르면 호스트 자격을 만들고, 그 PC의 127.0.0.1 임시 서버로 폼을 보내 넘긴다
 * (페이지 이동이라 비밀값이 스크립트 응답·주소창에 남지 않고, 다른 PC의 호스트에는 닿지 않는다)
 */
export function ConnectHostPage() {
  const [params] = useSearchParams();
  const req = parseConnectRequest(params);
  const api = useApi();
  const connect = useConnectHost();
  const [cred, setCred] = useState<HostCredential>();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!cred) return;
    // https 웹 → http://127.0.0.1 폼 전송은 기본 정책(strict-origin-when-cross-origin)에서 Origin이 "null"로 간다.
    // 호스트가 Origin으로 웹 주소를 확인하므로 origin만 보내게 한다(주소·nonce는 보내지 않는다)
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'origin';
    document.head.appendChild(meta);
    form.current?.submit();
  }, [cred]);

  return (
    <PlainShell>
      <div className="qp-card qp-form-col" style={{ margin: '0 auto', width: '100%', wordBreak: 'keep-all' }}>
        <div className="qp-row" style={{ gap: 12 }}>
          <Icons.IconDesktop aria-hidden style={{ width: 24, height: 24 }} />
          <h1 className={textClass('title3', 'bold')}>이 PC 연결</h1>
        </div>
        {!req ? (
          <SectionMessage
            variant="negative"
            description={
              <span className="qp-stack" style={{ gap: 6 }}>
                <span>연결할 PC의 터미널에서 다시 시작하세요.</span>
                <code className={`qh-code ${textClass('label2')}`}>{CONNECT_COMMAND}</code>
                <span className={textClass('caption1')}>{INSTALL_NOTE}</span>
              </span>
            }
          >
            연결 주소가 올바르지 않습니다
          </SectionMessage>
        ) : (
          <>
            <dl className={`qp-stack ${textClass('label1')}`} style={{ gap: 8, margin: 0 }}>
              <div className="qp-row">
                <dt className="qp-faint" style={{ width: 72 }}>
                  PC
                </dt>
                <dd style={{ margin: 0 }}>{req.name}</dd>
              </div>
              <div className="qp-row">
                <dt className="qp-faint" style={{ width: 72 }}>
                  계정
                </dt>
                <dd style={{ margin: 0 }}>{api.currentUser}</dd>
              </div>
            </dl>
            <span className={`${textClass('label2')} qp-muted`}>
              연결하면 이 PC의 호스트 에이전트가 내 계정으로 프로젝트 데이터를 읽고, 내 Claude Code로 Run과 QA 문서
              생성을 실행해 결과를 올립니다. 연결은 [연결된 PC]에서 언제든 해제할 수 있습니다.
            </span>
            <SectionMessage
              variant="cautionary"
              description="다른 사람이 보낸 링크로 이 화면을 열었다면 연결하지 마세요."
            >
              이 PC의 터미널에서 직접 시작한 경우에만 연결하세요
            </SectionMessage>
            <div className="qp-row">
              <Button
                variant="solid"
                color="primary"
                leadingContent={<Icons.IconLink />}
                loading={connect.isPending || !!cred}
                onClick={() => connect.mutate(req.name, { onSuccess: setCred })}
              >
                이 PC 연결
              </Button>
              <Link to="/hosts" className={`${textClass('label1', 'medium')} qp-muted`}>
                취소
              </Link>
            </div>
            <ErrorMessage error={connect.error} title="연결하지 못했습니다" />
            {cred && (
              <form ref={form} method="post" action={pairEndpoint(req.port)} hidden>
                <input type="hidden" name="nonce" value={req.nonce} />
                <input type="hidden" name="uid" value={cred.uid} />
                <input type="hidden" name="hostId" value={cred.hostId} />
                <input type="hidden" name="secret" value={cred.secret} />
              </form>
            )}
          </>
        )}
      </div>
    </PlainShell>
  );
}
