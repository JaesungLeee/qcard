import { PauseReason, type Host, type Verdict } from '@qcard/shared';
import {
  Button,
  Chip,
  ContentBadge,
  Icons,
  SectionMessage,
  Tab,
  TabList,
  TabListItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TextField,
  VerdictBadge,
  textClass,
  token,
} from '@qcard/ui';
import { createFixtureDb, type ClaudeCodeState } from '@qcard/fixtures';
import type { CSSProperties, ReactNode } from 'react';
import { ClaudeCodeChip } from '../features/console/TopBar';
import '../features/console/console.css';
import { HostStatusView } from '../features/qa-doc/Jobs';
import { RunState } from '../features/qa-sheet/parts';
import '../features/qa-sheet/qa-sheet.css';
import { MockScreen } from '../mock/MockScreen';

/** 로컬 콘솔의 Claude Code 상태 */
const CLAUDE_CODE_STATES: ClaudeCodeState[] = [
  { installed: true, version: '2.1.185', loggedIn: true, plan: 'max' },
  { installed: true, version: '2.1.185', loggedIn: true, plan: 'pro' },
  {
    installed: true,
    version: '2.1.185',
    loggedIn: true,
    plan: 'max',
    limited: true,
    limitedUntil: '2026-10-22T14:30:00+09:00',
  },
  { installed: true, version: '2.1.185', loggedIn: true, plan: 'pro', limited: true },
  { installed: true, version: '2.1.250', loggedIn: true, plan: 'max', requiredVersion: '2.1.284' },
  { installed: true, version: '2.1.185', loggedIn: false },
  { installed: false, loggedIn: false },
];

/** 지금 연결된 내 호스트 (Claude Code 상태만 바꿔 본다) */
const demoHost = (claudeCode: Host['claudeCode']): Host => ({
  id: 'macbook-pro',
  name: '이재성의 MacBook Pro',
  lastSeen: new Date().toISOString(),
  claudeCode,
});

const MOCK_STEPS = createFixtureDb().console.current.steps;

const VERDICTS: Verdict[] = ['pass', 'fail', 'blocked', 'check', 'nt', 'na'];

const SAMPLE_ROWS: { id: string; title: string; verdict: Verdict }[] = [
  { id: 'TC-onboarding-001', title: '첫 실행 시 온보딩 1단계가 보인다', verdict: 'pass' },
  { id: 'TC-onboarding-002', title: '건너뛰기를 누르면 홈으로 이동한다', verdict: 'fail' },
  { id: 'TC-onboarding-003', title: '알림 권한 거부 후에도 진행된다', verdict: 'check' },
  { id: 'TC-onboarding-004', title: '오프라인에서 재시도 안내가 보인다', verdict: 'blocked' },
  { id: 'TC-onboarding-005', title: '닉네임 20자 제한', verdict: 'nt' },
];

const card: CSSProperties = {
  background: token('surface-neutral-primary'),
  border: `1px solid ${token('line-neutral-secondary')}`,
  borderRadius: token('radius-12'),
  padding: token('space-20'),
  display: 'flex',
  flexDirection: 'column',
  gap: token('space-12'),
  minWidth: 0,
};
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: token('space-8'), alignItems: 'center' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 className={textClass('headline2', 'bold')}>{title}</h2>
      {children}
    </section>
  );
}

/** 디자인 시스템 요소와 qcard 확장(판정 배지)을 한 화면에 모은 카탈로그. 새 공용 UI를 만들면 여기에 추가한다. */
export function UiCatalog() {
  return (
    <main
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: token('space-24'),
        display: 'flex',
        flexDirection: 'column',
        gap: token('space-24'),
      }}
    >
      <header>
        <h1 className={textClass('title3', 'bold')}>UI 카탈로그</h1>
        <p className={textClass('label1')} style={{ color: token('foreground-neutral-secondary') }}>
          Montage for qcard 토큰·컴포넌트 확인용 화면
        </p>
      </header>

      <Section title="판정">
        <div style={row}>
          {VERDICTS.map((v) => (
            <VerdictBadge key={v} verdict={v} />
          ))}
        </div>
        <div style={row}>
          {VERDICTS.map((v) => (
            <VerdictBadge key={v} verdict={v} short />
          ))}
        </div>
      </Section>

      <Section title="동작">
        <div style={row}>
          <Button variant="solid" color="primary">
            승인
          </Button>
          <Button variant="outlined" color="assistive">
            편집
          </Button>
          <Button variant="solid" color="negative">
            반려
          </Button>
          <Button variant="solid" color="primary" size="small" leadingContent={<Icons.IconPlus />}>
            사이클 만들기
          </Button>
          <Button variant="solid" color="primary" loading>
            저장
          </Button>
        </div>
      </Section>

      <Section title="필터 · 배지 · 입력">
        <div style={row}>
          <Chip active>전체</Chip>
          <Chip>신규</Chip>
          <Chip>변경</Chip>
          <Chip>삭제</Chip>
          <ContentBadge size="small" variant="outlined">
            Auto
          </ContentBadge>
          <ContentBadge size="small" variant="outlined">
            Manual
          </ContentBadge>
        </div>
        <TextField aria-label="케이스 검색" placeholder="TC ID, 제목으로 검색" />
      </Section>

      <Section title="탭 · 표">
        <Tab defaultValue="cases">
          <TabList size="small">
            <TabListItem value="summary">요약</TabListItem>
            <TabListItem value="cases">테스트 케이스 5</TabListItem>
            <TabListItem value="defects">결함 1</TabListItem>
          </TabList>
        </Tab>
        {/* 좁은 화면에서는 표만 가로로 스크롤한다. 열을 찌그러뜨리지 않는다. */}
        <div style={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableHeadCell>TC ID</TableHeadCell>
                <TableHeadCell>제목</TableHeadCell>
                <TableHeadCell>판정</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {SAMPLE_ROWS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className={`${textClass('label2')} qc-mono`} style={{ whiteSpace: 'nowrap' }}>
                      {r.id}
                    </span>
                  </TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>
                    <VerdictBadge verdict={r.verdict} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="디바이스 화면 (fixture 목업 + 액션 표시)">
        <div style={{ ...row, alignItems: 'flex-start' }}>
          {MOCK_STEPS.map((step) => (
            <figure key={step.index} style={{ display: 'flex', flexDirection: 'column', gap: token('space-4') }}>
              <MockScreen screenshot={step.screenshot} width={160} action={step} />
              <figcaption className={textClass('caption1')} style={{ maxWidth: 180 }}>
                {step.index}. {step.intent}
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="실행 상태 · Claude Code">
        <div style={row}>
          <RunState paused={false} />
          <RunState paused={false} stale />
          <RunState paused />
          {PauseReason.options.map((r) => (
            <RunState key={r} paused reason={r} />
          ))}
        </div>
        <div style={row}>
          {CLAUDE_CODE_STATES.map((s, i) => (
            <ClaudeCodeChip key={i} state={s} />
          ))}
        </div>
        {/* 대시보드 QA 문서 작업 화면의 내 호스트 안내 */}
        <HostStatusView hosts={[demoHost({ version: '2.1.308', loggedIn: true, subscriptionType: 'max' })]} />
        <HostStatusView hosts={[demoHost({ version: '2.1.308', loggedIn: false })]} />
        <HostStatusView
          hosts={[
            demoHost({ version: '2.1.250', loggedIn: true, subscriptionType: 'max', requiredVersion: '2.1.280' }),
          ]}
        />
      </Section>

      <Section title="안내">
        <SectionMessage variant="cautionary" description="스펙 확인 질문 2건에 답하면 승인할 수 있습니다.">
          승인 보류
        </SectionMessage>
        <SectionMessage variant="negative" description="Wi-Fi ADB 연결에서는 네트워크를 끌 수 없습니다.">
          Blocked
        </SectionMessage>
      </Section>
    </main>
  );
}
