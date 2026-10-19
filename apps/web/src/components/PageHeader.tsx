import { Icons, textClass, token } from '@qcard/ui';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

export type Crumb = { label: string; to?: string };

/** 페이지 머리: 이동 경로 + 제목(title3 bold) + 메타 + 오른쪽 동작. */
export function PageHeader({
  title,
  crumbs = [],
  meta,
  actions,
}: {
  title: ReactNode;
  crumbs?: Crumb[];
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: token('space-16') }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: token('space-4'), minWidth: 0, flex: '1 1 320px' }}>
        {crumbs.length > 0 && (
          <nav
            aria-label="이동 경로"
            className={textClass('label2', 'medium')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token('space-2'),
              color: token('foreground-neutral-tertiary'),
            }}
          >
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <Icons.IconChevronRightSmall aria-hidden />}
                {c.to ? (
                  <Link to={c.to} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <h1 className={textClass('title3', 'bold')}>{title}</h1>
        {meta && (
          <div className={textClass('label1')} style={{ color: token('foreground-neutral-secondary') }}>
            {meta}
          </div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: token('space-8') }}>{actions}</div>}
    </header>
  );
}
