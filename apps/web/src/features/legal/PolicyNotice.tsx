// 개인정보처리방침·이용약관 변경 공지 (시행 7일 전부터 서비스 안에서 알린다 — 두 문서의 "변경" 절)
import { SectionMessage } from '@qcard/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import './policy-notice.css';
import { CHANGE_SUMMARY, EFFECTIVE_DATE, NOTICE_DISMISS_KEY, policyNoticeActive } from './policy';

const readDismissed = () => {
  try {
    return localStorage.getItem(NOTICE_DISMISS_KEY);
  } catch {
    return null;
  }
};

/** 시행일 전에만 보이고, 닫으면 그 브라우저에서는 이번 시행일 공지를 다시 보이지 않는다 */
export function PolicyNotice() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!policyNoticeActive(new Date(), dismissed)) return null;
  const [, m, d] = EFFECTIVE_DATE!.split('-').map(Number);
  const close = () => {
    try {
      localStorage.setItem(NOTICE_DISMISS_KEY, EFFECTIVE_DATE!);
    } catch {
      // 저장할 수 없으면 이번 화면에서만 닫는다
    }
    setDismissed(EFFECTIVE_DATE!);
  };
  return (
    <SectionMessage
      variant="info"
      description={
        <>
          {CHANGE_SUMMARY}.{' '}
          <Link to="/privacy" className="qc-notice-link">
            개인정보처리방침
          </Link>{' '}
          ·{' '}
          <Link to="/terms" className="qc-notice-link">
            이용약관
          </Link>
        </>
      }
      closeButton
      onOpenChange={(open) => !open && close()}
    >
      {`개인정보처리방침·이용약관이 ${m}월 ${d}일부터 바뀝니다`}
    </SectionMessage>
  );
}
