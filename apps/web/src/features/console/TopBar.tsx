import type { ClaudeCodeState, ConsoleDevice } from '@qcard/shared';
import { Button, Icons, Menu, MenuContent, MenuItem, MenuList, MenuTrigger, textClass, token } from '@qcard/ui';
import { Link } from 'react-router';
import { ThemeSwitch } from '../../shell/AppShell';

/** 상단 바가 보는 정보 (재생 세션·실시간 상태·홈 공용). 사이클은 Run 중일 때만 */
export type TopBarInfo = {
  projectId?: string;
  cycleId?: string;
  cycleName?: string;
  build?: { version: string; buildNumber: number };
  executor: string;
  /** 없으면 연결된 디바이스 없음 */
  device?: ConsoleDevice;
  otherDevices?: ConsoleDevice[];
  claudeCode: ClaudeCodeState;
  /** 호스트 에이전트 연결 */
  host: { connected: boolean; label: string };
  /**
   * 웹 대시보드 주소. 배포한 `qcard serve`의 콘솔은 127.0.0.1에서 열려 같은 출처의 대시보드가 없으므로
   * 호스트가 알려 준 주소로 간다. 없으면 같은 출처(개발 서버·데모)
   */
  dashboardUrl?: string;
};

/** 상단 바: 호스트 연결 · 사이클 · 빌드 · 디바이스 선택 · 대시보드로 (F-DV-03, F-DV-04) */
export function TopBar({ session }: { session: TopBarInfo }) {
  const { build, host } = session;
  return (
    <header className="qcc-top">
      <div className="qcc-brand">
        <Icons.IconDesktop aria-hidden style={{ width: 20, height: 20, color: token('foreground-brand-primary') }} />
        <span className={textClass('headline2', 'bold')}>qcard 로컬 콘솔</span>
        <span
          className={`qcc-phase ${textClass('caption1', 'medium')}`}
          style={{ background: token('surface-neutral-tertiary'), color: token('foreground-neutral-secondary') }}
          title="호스트 에이전트 연결 상태"
        >
          <span
            className="qcc-dot"
            style={{
              background: token(host.connected ? 'foreground-positive-primary' : 'foreground-negative-primary'),
            }}
          />
          {host.connected ? `호스트 연결됨 · ${host.label}` : `호스트 연결 끊김 · ${host.label}`}
        </span>
        <ClaudeCodeChip state={session.claudeCode} />
      </div>
      <div className={`qcc-top-meta ${textClass('label1')}`}>
        {session.cycleName && build && (
          <>
            <span className={textClass('label1', 'medium')} style={{ color: token('foreground-neutral-primary') }}>
              {session.cycleName}
            </span>
            <span className="qcc-top-sep" />
            <span>
              빌드 <span className="qcc-mono">{`${build.version} (${build.buildNumber})`}</span>
            </span>
            <span className="qcc-top-sep" />
          </>
        )}
        <span>실행자 {session.executor}</span>
      </div>
      <div className="qcc-top-right">
        {session.device ? (
          <DeviceMenu device={session.device} others={session.otherDevices ?? []} />
        ) : (
          <span className={`${textClass('label1')} qcc-muted`}>디바이스 연결 안 됨</span>
        )}
        <DashboardLink
          base={session.dashboardUrl}
          path={
            session.projectId && session.cycleId ? `/p/${session.projectId}/cycles/${session.cycleId}` : '/projects'
          }
        />
        <div className="qcc-top-theme">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

/**
 * 이 PC의 Claude Code 상태 (F-DB-09). LLM 호출은 실행자 본인의 Claude Code·플랜으로 한다(PRD §8).
 * 문제가 있으면 무엇을 해야 하는지 글로 알린다 — 색 점만으로 구분하지 않는다.
 */
export function ClaudeCodeChip({ state }: { state: ClaudeCodeState }) {
  const plan = state.plan ? `${state.plan[0]!.toUpperCase()}${state.plan.slice(1)} 플랜` : '플랜';
  const [ok, label, help] = !state.installed
    ? [false, 'Claude Code 설치 필요', 'Claude Code를 설치하고 터미널에서 claude로 로그인하면 실행할 수 있습니다.']
    : !state.loggedIn
      ? [
          false,
          'Claude Code 로그인 필요',
          '터미널에서 claude를 실행해 로그인하세요. 로그인하면 일시정지된 Run을 재개할 수 있습니다.',
        ]
      : state.limitedUntil
        ? [
            false,
            `${plan} 한도 · ${fmtTime(state.limitedUntil)} 이후 재개`,
            '플랜 사용 한도에 닿아 Run을 일시정지했습니다. 한도가 풀리면 재개하세요.',
          ]
        : [
            true,
            `Claude Code · ${plan}`,
            `Claude Code ${state.version ?? ''} — LLM 사용량은 내 ${plan}에서 차감됩니다.`,
          ];
  return (
    <span
      className={`qcc-phase ${textClass('caption1', 'medium')}`}
      style={{ background: token('surface-neutral-tertiary'), color: token('foreground-neutral-secondary') }}
      title={help}
      role="status"
    >
      <span
        className="qcc-dot"
        style={{ background: token(ok ? 'foreground-positive-primary' : 'foreground-cautionary-primary') }}
      />
      {label}
    </span>
  );
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

function DeviceMenu({ device, others }: { device: ConsoleDevice; others: ConsoleDevice[] }) {
  return (
    <Menu value={device.serial}>
      <MenuTrigger>
        <Button
          size="small"
          variant="outlined"
          color="assistive"
          leadingContent={<Icons.IconMobile aria-hidden />}
          trailingContent={<Icons.IconChevronDownSmall aria-hidden />}
          aria-label={`디바이스 선택: ${device.model} 실행 중`}
        >
          {device.model}
          <span className="qcc-dot" style={{ background: token('foreground-brand-primary'), marginLeft: 6 }} />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuList>
          <MenuItem
            variant="radio"
            value={device.serial}
            textProps={{ description: `${device.serial} · Android ${device.osBuild} · 실행 중` }}
          >
            {device.model}
          </MenuItem>
          {others.map((d) => (
            <MenuItem
              key={d.serial}
              variant="radio"
              value={d.serial}
              disabled
              textProps={{ description: `${d.serial} · 대기 — 1인 1대 제한으로 잠김 (실행 중인 Run 종료 후 선택)` }}
            >
              {d.model}
            </MenuItem>
          ))}
        </MenuList>
      </MenuContent>
    </Menu>
  );
}

function DashboardLink({ base, path }: { base?: string; path: string }) {
  const className = `qcc-link ${textClass('label1', 'medium')}`;
  const body = (
    <>
      대시보드에서 보기
      <Icons.IconArrowUpRight aria-hidden style={{ width: 16, height: 16 }} />
    </>
  );
  return base ? (
    <a className={className} href={new URL(path, base).href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <Link className={className} to={path}>
      {body}
    </Link>
  );
}
