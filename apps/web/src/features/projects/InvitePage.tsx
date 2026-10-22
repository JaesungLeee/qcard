import { ROLE_DESCRIPTION } from '@qcard/shared';
import { Button, Icons, SectionMessage, textClass } from '@qcard/ui';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { QueryState } from '../../components/QueryState';
import { fmtDate } from '../../components/format';
import type { InvitationView } from '../../data/api';
import { useAcceptInvitation, useInvitation } from '../../data/hooks';
import { PlainShell } from '../../shell/PlainShell';
import { DataNotice, ErrorMessage, RoleBadge } from './parts';
import './projects.css';

/** 초대 수락 (F-TM-10): 데이터 처리 안내를 확인하고 수락하면 멤버가 된다 */
export function InvitePage() {
  const { token = '' } = useParams();
  const view = useInvitation(token);
  return (
    <PlainShell>
      <QueryState query={view}>{(v) => <InviteCard token={token} view={v} />}</QueryState>
    </PlainShell>
  );
}

const BLOCKED: Record<Exclude<InvitationView['state'], 'pending' | 'member'>, [string, string]> = {
  expired: ['만료된 초대입니다', '초대한 사람에게 새 초대를 요청하세요.'],
  revoked: ['취소된 초대입니다', '초대한 사람에게 새 초대를 요청하세요.'],
  accepted: ['이미 사용된 초대입니다', '사용자명으로 보낸 초대는 한 번만 쓸 수 있습니다.'],
  'other-user': ['다른 사람에게 보낸 초대입니다', ''],
};

function InviteCard({ token, view }: { token: string; view: InvitationView }) {
  const navigate = useNavigate();
  const accept = useAcceptInvitation(token);
  const [ack, setAck] = useState(false);
  const { invitation: inv, project: p, state } = view;
  return (
    <div className="qp-card qp-form-col" style={{ margin: '0 auto', width: '100%' }}>
      <div className="qp-row" style={{ gap: 12 }}>
        <Icons.IconPersonPlus aria-hidden style={{ width: 24, height: 24 }} />
        <h1 className={textClass('title3', 'bold')}>{p.name}에 초대받았습니다</h1>
      </div>
      <dl className={`qp-stack ${textClass('label1')}`} style={{ gap: 8, margin: 0 }}>
        <div className="qp-row">
          <dt className="qp-faint" style={{ width: 72 }}>
            앱
          </dt>
          <dd style={{ margin: 0 }}>
            {p.appName} · <span className="qc-mono">{p.packageName}</span>
          </dd>
        </div>
        <div className="qp-row">
          <dt className="qp-faint" style={{ width: 72 }}>
            초대한 사람
          </dt>
          <dd style={{ margin: 0 }}>{inv.invitedBy}</dd>
        </div>
        <div className="qp-row">
          <dt className="qp-faint" style={{ width: 72 }}>
            역할
          </dt>
          <dd className="qp-row" style={{ margin: 0 }}>
            <RoleBadge role={inv.role} />
            <span className="qp-muted">{ROLE_DESCRIPTION[inv.role]}</span>
          </dd>
        </div>
        <div className="qp-row">
          <dt className="qp-faint" style={{ width: 72 }}>
            만료
          </dt>
          <dd style={{ margin: 0 }}>{fmtDate(inv.expiresAt)}</dd>
        </div>
      </dl>

      {state === 'pending' && (
        <>
          <DataNotice checked={ack} onChange={setAck} />
          <ErrorMessage error={accept.error} title="참여할 수 없습니다" />
          <div className="qp-row" style={{ justifyContent: 'flex-end' }}>
            <Button
              variant="solid"
              color="primary"
              disabled={!ack || accept.isPending}
              onClick={() =>
                accept.mutate({ dataNoticeAck: ack }, { onSuccess: (proj) => void navigate(`/p/${proj.id}/cycles`) })
              }
            >
              참여하기
            </Button>
          </div>
        </>
      )}
      {state === 'member' && (
        <SectionMessage variant="positive" description="이미 이 프로젝트의 멤버입니다.">
          <Link to={`/p/${p.id}/cycles`}>{p.name} 열기</Link>
        </SectionMessage>
      )}
      {state !== 'pending' && state !== 'member' && (
        <SectionMessage
          variant="cautionary"
          description={
            state === 'other-user'
              ? `@${inv.github}에게 보낸 초대입니다. 본인 계정으로 받은 초대 링크를 여세요.`
              : BLOCKED[state][1]
          }
        >
          {BLOCKED[state][0]}
        </SectionMessage>
      )}
      {state !== 'pending' && (
        <Link to="/projects" className={textClass('label1', 'medium')}>
          내 프로젝트로
        </Link>
      )}
    </div>
  );
}
