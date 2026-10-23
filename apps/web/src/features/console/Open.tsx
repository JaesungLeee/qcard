// 웹 대시보드에서 로컬 콘솔 열기: 내 호스트가 연결 신호에 실어 보낸 일회용 주소(Host.consoleUrl)를 새 탭으로 연다.
// 콘솔은 그 PC의 127.0.0.1에만 열려 있어, 호스트를 켠 PC의 브라우저에서만 들어갈 수 있다.
import type { Host } from '@qcard/shared';
import { Button, Icons, SectionMessage, textClass, token } from '@qcard/ui';
import { NavLink, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { isMemoryApi } from '../../data/memory';
import { useApi, useMyHosts } from '../../data/hooks';
import { isOnline, serveCommand } from '../qa-doc/Jobs';

/** 연결된 내 호스트의 콘솔 주소 (없으면 호스트가 꺼져 있거나 콘솔 없이 켠 것) */
export const consoleUrlOf = (hosts: Host[], now = Date.now()) =>
  hosts.find((h) => isOnline(h, now) && h.consoleUrl)?.consoleUrl;

/** 사이드바 [로컬 콘솔]: 내 호스트가 연결돼 있으면 콘솔을 새 탭으로, 아니면 켜는 방법 화면으로 */
export function ConsoleNavLink({ className }: { className: string }) {
  const api = useApi();
  const { projectId = '' } = useParams();
  const hosts = useMyHosts();
  const label = (
    <>
      <Icons.IconPhone />
      로컬 콘솔
    </>
  );
  // 메모리 구현(pnpm dev)에는 호스트가 없어 fixture 재생 화면을 연다
  if (isMemoryApi(api)) {
    return (
      <NavLink to="/console" className={className}>
        {label}
      </NavLink>
    );
  }
  const url = consoleUrlOf(hosts.data ?? []);
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener" className={className} onClick={() => void hosts.refetch()}>
        {label}
        <Icons.IconExternalLink aria-label="새 탭" style={{ marginLeft: 'auto', width: 14, height: 14 }} />
      </a>
    );
  }
  return (
    <NavLink to={`/p/${projectId}/console`} className={className}>
      {label}
    </NavLink>
  );
}

/** 내 호스트가 없을 때 [로컬 콘솔]이 오는 화면: 켜는 방법. 켜지면 [로컬 콘솔 열기] */
export function ConsoleOpenPage() {
  const api = useApi();
  const hosts = useMyHosts();
  const url = consoleUrlOf(hosts.data ?? []);
  const online = (hosts.data ?? []).some((h) => isOnline(h));
  return (
    <div className="qc-page">
      <PageHeader
        crumbs={[{ label: '로컬 콘솔' }]}
        title="로컬 콘솔"
        meta="디바이스가 연결된 내 PC에서 Run 진행을 보고, 수동 스텝·Take over를 하는 화면입니다."
      />
      {hosts.isPending ? null : url ? (
        <div>
          <Button
            variant="solid"
            color="primary"
            onClick={() => {
              window.open(url, '_blank', 'noopener');
              void hosts.refetch();
            }}
          >
            로컬 콘솔 열기
          </Button>
        </div>
      ) : (
        <SectionMessage
          variant="cautionary"
          description={
            <span style={{ display: 'flex', flexDirection: 'column', gap: token('space-6') }}>
              <span>
                {online
                  ? '호스트 에이전트가 로컬 콘솔 없이(--headless) 실행 중입니다. 콘솔을 띄우려면 옵션 없이 다시 켜세요.'
                  : '로컬 콘솔은 내 PC의 호스트 에이전트가 띄웁니다. 터미널에서 켜 두면 여기서 바로 열 수 있습니다.'}
              </span>
              <code
                className={textClass('label2')}
                style={{
                  fontFamily: 'var(--qc-font-mono)',
                  padding: `0 ${token('space-4')}`,
                  borderRadius: token('radius-4'),
                  background: token('surface-neutral-tertiary'),
                  overflowWrap: 'anywhere',
                }}
              >
                {serveCommand(api.currentUid)}
              </code>
            </span>
          }
        >
          {online ? '로컬 콘솔이 꺼져 있습니다' : '내 호스트 에이전트가 꺼져 있습니다'}
        </SectionMessage>
      )}
    </div>
  );
}
