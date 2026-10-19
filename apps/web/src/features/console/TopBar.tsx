import type { ConsoleDevice, ConsoleSession } from '@qcard/fixtures';
import { Button, Icons, Menu, MenuContent, MenuItem, MenuList, MenuTrigger, textClass, token } from '@qcard/ui';
import { Link } from 'react-router';
import { ThemeSwitch } from '../../shell/AppShell';

/** 상단 바: 호스트 연결 · 사이클 · 빌드 · 디바이스 선택 · 대시보드로 (F-DV-03, F-DV-04) */
export function TopBar({ session }: { session: ConsoleSession }) {
  const { build } = session;
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
          <span className="qcc-dot" style={{ background: token('foreground-positive-primary') }} />
          호스트 연결됨 · localhost:7420
        </span>
      </div>
      <div className={`qcc-top-meta ${textClass('label1')}`}>
        <span className={textClass('label1', 'medium')} style={{ color: token('foreground-neutral-primary') }}>
          {session.cycleName}
        </span>
        <span className="qcc-top-sep" />
        <span>
          빌드 <span className="qcc-mono">{`${build.version} (${build.buildNumber})`}</span>
        </span>
        <span className="qcc-top-sep" />
        <span>실행자 {session.run.executor}</span>
      </div>
      <div className="qcc-top-right">
        <DeviceMenu device={session.device} others={session.otherDevices} />
        <Link className={`qcc-link ${textClass('label1', 'medium')}`} to={`/p/haru/cycles/${session.cycleId}`}>
          대시보드에서 보기
          <Icons.IconArrowUpRight aria-hidden style={{ width: 16, height: 16 }} />
        </Link>
        <div className="qcc-top-theme">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

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
