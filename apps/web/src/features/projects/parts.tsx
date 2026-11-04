// 프로젝트·멤버·초대 화면이 함께 쓰는 조각.
import { DATA_NOTICE, ROLE_LABEL, type Role } from '@qcard/shared';
import { ContentBadge, Icons, SectionMessage, textClass } from '@qcard/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckLabel } from '../../components/CheckLabel';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="qp-field">
      <span className={`${textClass('label2', 'medium')} qp-faint`}>{label}</span>
      {children}
      {hint && <span className={`${textClass('caption1')} qp-faint`}>{hint}</span>}
    </label>
  );
}

/** 역할은 글자로 쓴다 (색만으로 구분하지 않는다) */
export function RoleBadge({ role }: { role: Role }) {
  return (
    <ContentBadge
      size="small"
      variant="outlined"
      color="neutral"
      leadingContent={role === 'admin' ? <Icons.IconSetting aria-hidden /> : undefined}
    >
      {ROLE_LABEL[role]}
    </ContentBadge>
  );
}

/** 데이터 처리 안내 확인. 프로젝트 생성·초대 수락 때 받는다 */
export function DataNotice({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="qp-notice">
      <div className="qp-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Icons.IconCircleInfo aria-hidden className="qp-notice-icon" />
        <div className="qp-stack" style={{ gap: 4 }}>
          <span className={textClass('label1', 'bold')}>데이터 처리 안내</span>
          <span className={`${textClass('label2')} qp-muted`}>
            {DATA_NOTICE}{' '}
            <Link to="/privacy" target="_blank" className="qp-link">
              개인정보처리방침
            </Link>
          </span>
        </div>
      </div>
      <CheckLabel className={`${textClass('label1', 'medium')} qp-check`} checked={checked} onCheckedChange={onChange}>
        확인했습니다
      </CheckLabel>
    </div>
  );
}

/** mutation 오류를 그 자리에 보여 준다 (규칙 위반 메시지는 그대로) */
export function ErrorMessage({ error, title = '할 수 없습니다' }: { error: unknown; title?: string }) {
  if (!error) return null;
  return (
    <SectionMessage variant="negative" description={error instanceof Error ? error.message : String(error)}>
      {title}
    </SectionMessage>
  );
}
