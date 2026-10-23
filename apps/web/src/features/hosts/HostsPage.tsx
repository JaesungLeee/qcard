import { Button, ContentBadge, Icons, SectionMessage, textClass } from '@qcard/ui';
import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDate, fmtDateTime } from '../../components/format';
import { useDisconnectHost, useHostConnections, useMyHosts } from '../../data/hooks';
import { PlainShell } from '../../shell/PlainShell';
import { ErrorMessage } from '../projects/parts';
import '../projects/projects.css';
import { CONNECT_COMMAND, connectedPcs, DEV_COMMAND_NOTE, type ConnectedPc } from './model';
import './hosts.css';

/**
 * 연결된 PC (F-TM-14): 내 계정에 연결한 호스트 에이전트 목록과 연결 해제.
 * 해제하면 그 PC는 바로 읽기·쓰기가 막힌다. 웹에서 로그아웃해도 연결은 남는다
 */
export function HostsPage() {
  const connections = useHostConnections();
  const hosts = useMyHosts();
  return (
    <PlainShell>
      <PageHeader
        crumbs={[{ label: '내 프로젝트', to: '/projects' }]}
        title="연결된 PC"
        meta="호스트 에이전트가 이 계정으로 Run을 실행하고 결과를 올리는 PC입니다. 잃어버렸거나 더 쓰지 않는 PC는 연결을 해제하세요."
      />
      <div className="qh-add">
        <Icons.IconCircleInfo aria-hidden className="qp-notice-icon" />
        <div className="qp-stack" style={{ gap: 6 }}>
          <span className={textClass('label1', 'bold')}>새 PC 연결</span>
          <span className={`${textClass('label2')} qp-muted`}>
            연결할 PC의 터미널에서 실행하면 브라우저가 열립니다. 그 화면에서 [이 PC 연결]을 누르세요.
          </span>
          <code className={`qh-code ${textClass('label2')}`}>{CONNECT_COMMAND}</code>
          <span className={`${textClass('caption1')} qp-faint`}>{DEV_COMMAND_NOTE}</span>
        </div>
      </div>
      <QueryState query={connections}>
        {(list) =>
          list.length === 0 ? (
            <SectionMessage variant="info" description="위 명령으로 이 계정에 PC를 연결하면 여기에 보입니다.">
              연결된 PC가 없습니다
            </SectionMessage>
          ) : (
            <ul className="qp-list qh-list" aria-label="연결된 PC">
              {connectedPcs(list, hosts.data ?? []).map((pc) => (
                <PcRow key={pc.id} pc={pc} />
              ))}
            </ul>
          )
        }
      </QueryState>
    </PlainShell>
  );
}

function PcRow({ pc }: { pc: ConnectedPc }) {
  const disconnect = useDisconnectHost();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="qh-item">
      <div className="qh-main">
        <div className="qp-row">
          <Icons.IconDesktop aria-hidden className="qh-icon" />
          <span className={textClass('label1', 'bold')}>{pc.name}</span>
          <ContentBadge size="small" variant={pc.online ? 'solid' : 'outlined'} color="neutral">
            {pc.online ? '켜짐' : '꺼짐'}
          </ContentBadge>
        </div>
        <span className={`${textClass('label2')} qp-faint`}>
          {fmtDate(pc.connectedAt)} 연결
          {pc.lastSeen ? ` · 마지막 신호 ${fmtDateTime(pc.lastSeen)}` : ''}
        </span>
        <ErrorMessage error={disconnect.error} title="연결을 해제하지 못했습니다" />
      </div>
      <div className="qh-actions">
        {confirm ? (
          <>
            <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirm(false)}>
              취소
            </Button>
            <Button
              size="small"
              variant="solid"
              color="negative"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate(pc.id)}
            >
              연결 해제
            </Button>
          </>
        ) : (
          <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirm(true)}>
            연결 해제
          </Button>
        )}
      </div>
    </li>
  );
}
