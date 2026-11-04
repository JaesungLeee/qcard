import {
  ACCOUNT_STATE_LABEL,
  DEFAULT_ACCOUNT_KIND,
  type AccountState,
  type TestAccount,
} from '@qcard/shared';
import {
  Button,
  Chip,
  Icons,
  Option,
  SectionMessage,
  Select,
  TextButton,
  TextField,
  textClass,
} from '@qcard/ui';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CheckLabel } from '../../components/CheckLabel';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDateTime } from '../../components/format';
import type { AccountView } from '../../data/api';
import {
  useAccounts,
  useClearAccountFlag,
  useCreateAccount,
  useDeleteAccount,
  useMyRole,
  useQaDoc,
  useQaDocs,
  useUpdateAccount,
} from '../../data/hooks';
import { ErrorMessage, Field } from '../projects/parts';
import {
  filterCounts,
  filterViews,
  isFlagged,
  kindRows,
  latestDoc,
  showsKinds,
  type KindRow,
  type StateFilter,
} from './model';
import './accounts.css';

/**
 * 테스트 계정. 로그인이 필요한 케이스는 실행할 때 여기 계정을 하나씩 배정받는다.
 * 계정 종류는 기본 외의 종류가 있을 때만 드러낸다. 비밀값은 저장한 뒤 다시 보여 주지 않는다.
 * 주소: `?account=<id>`는 그 계정의 수정·상세를 펼치고, `?new=1`(또는 `?new=<종류>`)은 계정 추가를 연다.
 */
export function AccountsPage() {
  const { projectId = '' } = useParams();
  const role = useMyRole(projectId);
  const editor = role.data === 'admin' || role.data === 'qa';
  const accounts = useAccounts(projectId);
  const docs = useQaDocs(projectId);
  const latest = docs.data && latestDoc(docs.data);
  const doc = useQaDoc(projectId, latest?.id ?? '', !!latest);
  const [params, setParams] = useSearchParams();
  const param = (key: string, value?: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const newKind = params.get('new');
  const adding = newKind === null ? undefined : { kind: newKind === '1' ? undefined : newKind };
  const setAdding = (v?: { kind?: string }) => param('new', v && (v.kind ?? '1'));
  const open = params.get('account') ?? undefined;
  const caseKinds = doc.data?.cases.map((c) => c.accountKind) ?? [];

  return (
    <div className="qc-page">
      <PageHeader
        title="테스트 계정"
        meta="로그인이 필요한 케이스는 실행할 때 비어 있는 계정을 하나씩 배정받습니다. 비밀번호·TOTP 시드는 암호화해 보관하고, 계정을 배정받은 실행자의 PC에만 전달합니다."
        actions={
          editor &&
          !adding && (
            <Button variant="solid" color="primary" leadingContent={<Icons.IconPlus />} onClick={() => setAdding({})}>
              계정 추가
            </Button>
          )
        }
      />
      <QueryState query={accounts}>
        {(views) => {
          const rows = kindRows(views, caseKinds);
          const kinds = showsKinds(rows) ? rows.map((r) => r.kind) : undefined;
          const needed = views.length > 0 || caseKinds.some(Boolean);
          return (
            <>
              {adding && (
                <AddAccount
                  projectId={projectId}
                  kinds={kinds}
                  initialKind={adding.kind}
                  onClose={() => setAdding(undefined)}
                />
              )}
              {!needed && !adding && <NoAccountsNeeded projectId={projectId} doc={latest} />}
              {kinds && (
                <KindsSection
                  rows={rows}
                  docVersion={latest?.appVersion}
                  editor={editor}
                  onAdd={(kind) => setAdding({ kind })}
                />
              )}
              {views.length > 0 && (
                <AccountList
                  projectId={projectId}
                  views={views}
                  kinds={kinds}
                  editor={editor}
                  open={open}
                  onOpen={(id) => param('account', id)}
                />
              )}
              {needed && !kinds && latest && (
                <span className={`${textClass('caption1')} qac-faint`}>
                  이 프로젝트의 케이스는 모두 기본 계정을 씁니다. 구독자·관리자처럼 다른 종류의 계정이 필요한 케이스가
                  생기면 계정 종류별 현황이 나타납니다.
                </span>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="qac-card" aria-label={title}>
      {(title || actions) && (
        <div className="qac-card-head">
          {title && <h2 className={textClass('headline2', 'bold')}>{title}</h2>}
          {actions && <div className="qac-push">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function NoAccountsNeeded({ projectId, doc }: { projectId: string; doc?: { id: string; appVersion: string } }) {
  return (
    <div className="qac-empty">
      <Icons.IconLock aria-hidden className="qac-empty-icon" />
      <h2 className={textClass('headline2', 'bold')}>계정이 필요한 케이스가 없습니다</h2>
      <p className={`${textClass('body2-reading')} qac-muted`}>
        {doc ? `QA 문서 ${doc.appVersion}의 케이스` : '케이스'}에 필요 계정 종류가 없어, 실행할 때 계정을 배정하지
        않습니다. 앱 데이터 초기화가 곧 새 사용자를 만드는 앱은 이대로 두면 됩니다.
      </p>
      <p className={`${textClass('label1')} qac-faint`}>
        로그인이 있는 앱이라면 QA 문서에서 로그인이 필요한 케이스에 계정 종류를 지정하세요.
      </p>
      {doc && (
        <Link to={`/p/${projectId}/docs/${doc.id}`} className={textClass('label1', 'bold')}>
          QA 문서 {doc.appVersion} 케이스 보기
        </Link>
      )}
    </div>
  );
}

function KindsSection({
  rows,
  docVersion,
  editor,
  onAdd,
}: {
  rows: KindRow[];
  docVersion?: string;
  editor: boolean;
  onAdd: (kind: string) => void;
}) {
  return (
    <Card title="계정 종류">
      {docVersion && (
        <span className={`${textClass('label2')} qac-faint`} style={{ marginTop: -8 }}>
          케이스 수는 QA 문서 {docVersion} 기준
        </span>
      )}
      <div className="qac-kinds">
        {rows.map((r) => {
          const missing = r.accounts === 0 && r.cases > 0;
          return (
            <div key={r.kind} className="qac-kind" data-missing={missing || undefined}>
              <div className="qac-row" style={{ justifyContent: 'space-between' }}>
                <span className={textClass('headline2', 'bold')}>{r.kind}</span>
                {docVersion && <span className={`${textClass('label2')} qac-muted`}>케이스 {r.cases}건</span>}
              </div>
              {missing ? (
                <>
                  <span className={`${textClass('label1')} qac-warn`}>
                    <Icons.IconCircleExclamation aria-hidden />
                    계정이 없습니다. 이 종류가 필요한 케이스는 실행하면 Blocked(계정 없음)가 됩니다.
                  </span>
                  {editor && (
                    <TextButton size="small" color="primary" onClick={() => onAdd(r.kind)}>
                      이 종류로 계정 추가
                    </TextButton>
                  )}
                </>
              ) : (
                <span className={`${textClass('label1')} qac-muted`}>
                  계정 {r.accounts} · <b className="qac-strong">배정 가능 {r.free}</b>
                  {r.busy > 0 && ` · 사용 중 ${r.busy}`}
                  {r.flagged > 0 && ` · 확인 필요 ${r.flagged}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const FILTER_LABEL: Record<StateFilter, string> = {
  all: '전체',
  free: '사용 가능',
  busy: '사용 중',
  flagged: '확인 필요',
};

function AccountList({
  projectId,
  views,
  kinds,
  editor,
  open,
  onOpen,
}: {
  projectId: string;
  views: AccountView[];
  kinds?: string[];
  editor: boolean;
  open?: string;
  onOpen: (id?: string) => void;
}) {
  const [filter, setFilter] = useState<StateFilter>('all');
  const counts = filterCounts(views);
  const shown = filterViews(views, filter);
  return (
    <Card
      title={`계정 ${views.length}`}
      actions={
        <div className="qac-row" role="group" aria-label="상태 필터">
          {(Object.keys(FILTER_LABEL) as StateFilter[]).map((f) => (
            <Chip key={f} size="small" variant="outlined" active={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} <span className="qc-mono">{counts[f]}</span>
            </Chip>
          ))}
        </div>
      }
    >
      <div className="qac-list" role="list" aria-label="테스트 계정">
        {shown.map((v) => (
          <AccountRow
            key={v.account.id}
            projectId={projectId}
            view={v}
            kinds={kinds}
            editor={editor}
            open={open === v.account.id}
            onToggle={() => onOpen(open === v.account.id ? undefined : v.account.id)}
          />
        ))}
        {shown.length === 0 && (
          <span className={`${textClass('label1')} qac-muted qac-none`}>이 상태의 계정이 없습니다.</span>
        )}
      </div>
      <span className={`${textClass('caption1')} qac-faint`}>
        Admin·QA: 등록·수정·삭제·표시 해제 · Viewer: 조회만. 사용 중인 계정은 삭제할 수 없습니다. 저장한 비밀값은 다시
        볼 수 없고 새 값으로 바꿀 수만 있습니다.
      </span>
    </Card>
  );
}

const STATE_ICON: Record<AccountState, ReactNode> = {
  free: <Icons.IconCircleCheck aria-hidden />,
  busy: <Icons.IconPlay aria-hidden />,
  login_failed: <Icons.IconCircleExclamation aria-hidden />,
  quarantined: <Icons.IconCircleBlock aria-hidden />,
};

/** 계정 상태 배지. 색만으로 구분하지 않도록 아이콘·글자를 함께 쓴다 */
export function AccountStateBadge({ state }: { state: AccountState }) {
  return (
    <span className={`qac-state ${textClass('caption1', 'medium')}`} data-state={state}>
      {STATE_ICON[state]}
      {ACCOUNT_STATE_LABEL[state]}
    </span>
  );
}

function stateDetail(a: TestAccount, state: AccountState): string | undefined {
  if (state === 'busy' && a.lease) return `${a.lease.executor} · ${a.lease.tcId}`;
  if (state === 'login_failed' && a.loginFailed) {
    return `${fmtDateTime(a.loginFailed.at)} · 비밀번호를 고칠 때까지 배정하지 않습니다`;
  }
  if (state === 'quarantined' && a.quarantine) {
    return `${a.quarantine.reason === 'restore_failed' ? '원복 실패' : '원복 중 끊김'} · ${fmtDateTime(a.quarantine.at)}`;
  }
  return undefined;
}

function AccountRow({
  projectId,
  view: { account: a, state },
  kinds,
  editor,
  open,
  onToggle,
}: {
  projectId: string;
  view: AccountView;
  kinds?: string[];
  editor: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const flagged = isFlagged(state);
  const detail = stateDetail(a, state);
  return (
    <div className="qac-item" role="listitem" data-open={open || undefined}>
      <div className="qac-item-main">
        <div className="qac-stack" style={{ gap: 2 }}>
          <span className={`${textClass('label1', 'medium')} qc-mono qac-id`}>{a.loginId}</span>
          {a.note && <span className={`${textClass('caption1')} qac-faint`}>{a.note}</span>}
        </div>
        {kinds && (
          <div>
            <span className={`qac-kind-badge ${textClass('caption1', 'medium')}`}>{a.kind}</span>
          </div>
        )}
        <div className="qac-stack" style={{ gap: 2 }}>
          <span className={textClass('label1')}>{a.usesTotp ? '비밀번호 + TOTP' : '비밀번호'}</span>
          <span className={`${textClass('caption1')} qac-faint`}>
            {fmtDateTime(a.secretUpdated.at)} {a.secretUpdated.by}이(가) 변경
          </span>
        </div>
        <div className="qac-stack" style={{ gap: 4 }}>
          <AccountStateBadge state={state} />
          {detail && <span className={`${textClass('caption1')} qac-muted`}>{detail}</span>}
        </div>
        <div className="qac-item-actions">
          {(editor || flagged) && (
            <Button size="small" variant="outlined" color="assistive" onClick={onToggle} aria-expanded={open}>
              {open ? '닫기' : flagged ? '자세히' : '수정'}
            </Button>
          )}
        </div>
      </div>
      {open &&
        (flagged ? (
          <FlagPanel projectId={projectId} account={a} state={state} editor={editor} onDone={onToggle} />
        ) : (
          <EditPanel projectId={projectId} account={a} kinds={kinds} busy={state === 'busy'} onDone={onToggle} />
        ))}
    </div>
  );
}

function KindField({ kinds, value, onChange }: { kinds: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="계정 종류" hint="QA 문서 케이스에 쓰인 계정 종류에서 고릅니다.">
      <Select aria-label="계정 종류" value={value} onChange={(v) => onChange(v as string)}>
        {kinds.map((k) => (
          <Option key={k} value={k}>
            {k}
          </Option>
        ))}
      </Select>
    </Field>
  );
}

const TOTP_HINT =
  '인증 앱(OTP) 2단계 로그인이 있을 때만 넣습니다. otpauth:// 주소나 base32 키. SMS·이메일 인증번호는 자동으로 처리하지 않고 실행자가 직접 입력합니다.';

function AddAccount({
  projectId,
  kinds,
  initialKind,
  onClose,
}: {
  projectId: string;
  kinds?: string[];
  initialKind?: string;
  onClose: () => void;
}) {
  const create = useCreateAccount(projectId);
  const [kind, setKind] = useState(initialKind ?? kinds?.[0] ?? DEFAULT_ACCOUNT_KIND);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [note, setNote] = useState('');
  return (
    <Card title="계정 추가">
      <SectionMessage
        variant="cautionary"
        description="실제 서비스 계정이나 개인 계정을 넣지 마세요. 비밀번호는 이 프로젝트에서 실행하는 멤버의 PC로 전달됩니다."
      >
        테스트 전용 계정만 등록하세요
      </SectionMessage>
      <form
        className="qac-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { kind, loginId, password, totp: totp || undefined, note: note || undefined },
            { onSuccess: onClose },
          );
        }}
      >
        {kinds && <KindField kinds={kinds} value={kind} onChange={setKind} />}
        <Field label="로그인 ID">
          <TextField value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="qa01@example.com" />
        </Field>
        <Field label="비밀번호">
          <TextField type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="TOTP 시드 (선택)" hint={TOTP_HINT}>
          <TextField type="password" autoComplete="off" value={totp} onChange={(e) => setTotp(e.target.value)} />
        </Field>
        <Field label="메모 (선택)" hint="계정의 기준 상태를 적어 두면 격리됐을 때 원복하기 쉽습니다.">
          <TextField value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 책 5권 보유, 알림 끔" />
        </Field>
        <ErrorMessage error={create.error} title="등록할 수 없습니다" />
        <div className="qac-row qac-form-foot">
          <span className={`${textClass('label2')} qac-muted`}>저장한 비밀번호·TOTP 시드는 다시 볼 수 없습니다.</span>
          <div className="qac-row qac-push">
            <Button type="button" variant="outlined" color="assistive" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" variant="solid" color="primary" disabled={!loginId.trim() || !password || create.isPending}>
              저장
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function EditPanel({
  projectId,
  account: a,
  kinds,
  busy,
  onDone,
}: {
  projectId: string;
  account: TestAccount;
  kinds?: string[];
  busy: boolean;
  onDone: () => void;
}) {
  const update = useUpdateAccount(projectId);
  const del = useDeleteAccount(projectId);
  const [kind, setKind] = useState(a.kind);
  const [loginId, setLoginId] = useState(a.loginId);
  const [note, setNote] = useState(a.note ?? '');
  const [password, setPassword] = useState<string>();
  const [totp, setTotp] = useState<string | null>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <form
      className="qac-panel qac-form"
      aria-label={`${a.loginId} 수정`}
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            id: a.id,
            patch: {
              ...(kind !== a.kind ? { kind } : {}),
              ...(loginId !== a.loginId ? { loginId } : {}),
              ...(note !== (a.note ?? '') ? { note } : {}),
              ...(password ? { password } : {}),
              ...(totp === null || totp ? { totp } : {}),
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="qac-grid2">
        {kinds && <KindField kinds={kinds} value={kind} onChange={setKind} />}
        <Field label="로그인 ID">
          <TextField value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        </Field>
      </div>
      <div className="qac-secrets">
        <div className="qac-secret">
          <div className="qac-stack" style={{ gap: 2 }}>
            <span className={textClass('label1', 'medium')}>비밀번호 설정됨</span>
            <span className={`${textClass('caption1')} qac-faint`}>
              {fmtDateTime(a.secretUpdated.at)} {a.secretUpdated.by}이(가) 변경 · 값은 다시 볼 수 없음
            </span>
          </div>
          {password === undefined ? (
            <Button type="button" size="small" variant="outlined" color="assistive" onClick={() => setPassword('')}>
              새 비밀번호로 바꾸기
            </Button>
          ) : (
            <TextField
              type="password"
              autoComplete="new-password"
              aria-label="새 비밀번호"
              placeholder="새 비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </div>
        <div className="qac-secret">
          <div className="qac-stack" style={{ gap: 2 }}>
            <span className={textClass('label1', 'medium')}>
              {totp === null ? 'TOTP 시드를 지웁니다' : a.usesTotp ? 'TOTP 시드 설정됨' : 'TOTP 시드 없음'}
            </span>
            <span className={`${textClass('caption1')} qac-faint`}>인증 앱 2단계 로그인이 있는 계정만</span>
          </div>
          {totp === undefined ? (
            <div className="qac-row">
              <Button type="button" size="small" variant="outlined" color="assistive" onClick={() => setTotp('')}>
                {a.usesTotp ? 'TOTP 바꾸기' : 'TOTP 추가'}
              </Button>
              {a.usesTotp && (
                <TextButton type="button" size="small" color="assistive" onClick={() => setTotp(null)}>
                  지우기
                </TextButton>
              )}
            </div>
          ) : totp !== null ? (
            <TextField
              type="password"
              autoComplete="off"
              aria-label="TOTP 시드"
              placeholder="otpauth://… 또는 base32 키"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          ) : (
            <TextButton type="button" size="small" color="assistive" onClick={() => setTotp(undefined)}>
              되돌리기
            </TextButton>
          )}
        </div>
      </div>
      <Field label="메모">
        <TextField value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorMessage error={update.error ?? del.error} />
      <div className="qac-row qac-form-foot">
        {confirmDelete ? (
          <div className="qac-row">
            <span className={`${textClass('label2')} qac-muted`}>비밀값과 함께 지웁니다.</span>
            <Button type="button" size="small" variant="outlined" color="assistive" onClick={() => setConfirmDelete(false)}>
              취소
            </Button>
            <Button
              type="button"
              size="small"
              variant="solid"
              color="negative"
              leadingContent={<Icons.IconTrash />}
              disabled={del.isPending}
              onClick={() => del.mutate(a.id)}
            >
              삭제하기
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="small"
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconTrash />}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            title={busy ? '사용 중인 계정은 삭제할 수 없습니다' : undefined}
          >
            계정 삭제
          </Button>
        )}
        <div className="qac-row qac-push">
          <Button type="button" variant="outlined" color="assistive" onClick={onDone}>
            취소
          </Button>
          <Button type="submit" variant="solid" color="primary" disabled={update.isPending}>
            저장
          </Button>
        </div>
      </div>
    </form>
  );
}

function FlagPanel({
  projectId,
  account: a,
  state,
  editor,
  onDone,
}: {
  projectId: string;
  account: TestAccount;
  state: AccountState;
  editor: boolean;
  onDone: () => void;
}) {
  const clear = useClearAccountFlag(projectId);
  const update = useUpdateAccount(projectId);
  const [restored, setRestored] = useState(false);
  const [password, setPassword] = useState('');
  const q = state === 'quarantined' ? a.quarantine : undefined;
  const f = q ?? a.loginFailed;
  if (!f) return null;
  return (
    <div className="qac-panel" aria-label={`${a.loginId} ${ACCOUNT_STATE_LABEL[state]} 상세`}>
      <h3 className={textClass('label1', 'bold')}>
        {q
          ? q.reason === 'restore_failed'
            ? '원복에 실패했습니다'
            : '원복하는 중에 실행이 끊겼습니다'
          : '로그인 준비 플로우가 실패했습니다'}
      </h3>
      <dl className={`qac-facts ${textClass('label1')}`}>
        <dt>케이스</dt>
        <dd className="qc-mono">{f.tcId}</dd>
        {f.detail && (
          <>
            <dt>{q ? '이유' : '앱 메시지'}</dt>
            <dd>{f.detail}</dd>
          </>
        )}
        <dt>시각</dt>
        <dd>{fmtDateTime(f.at)}</dd>
      </dl>
      <span className={`${textClass('label2')} qac-muted`}>
        {q
          ? '원복 결과는 케이스 판정에 영향을 주지 않습니다. 계정 상태가 기준과 다를 수 있어 다른 케이스에 배정하지 않습니다.'
          : '같은 비밀번호로 다시 시도하면 앱이 계정을 잠글 수 있어, 비밀번호를 고치기 전까지 배정하지 않습니다.'}
      </span>
      {editor && q && (
        <>
          <div className="qac-howto">
            <span className={textClass('label1', 'bold')}>해제하기 전에</span>
            <ol className={`${textClass('label1')} qac-muted`}>
              <li>앱에서 이 계정으로 로그인합니다.</li>
              <li>원복 플로우의 확인 조건이 맞도록 직접 되돌립니다.</li>
              <li>{a.note ? `메모의 기준 상태(${a.note})와 같은지 확인합니다.` : '계정의 기준 상태와 같은지 확인합니다.'}</li>
            </ol>
          </div>
          <CheckLabel className={`${textClass('label1', 'medium')} qac-check`} checked={restored} onCheckedChange={setRestored}>
            계정을 기준 상태로 되돌렸습니다
          </CheckLabel>
        </>
      )}
      {editor && !q && (
        <Field label="새 비밀번호">
          <TextField
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      )}
      <ErrorMessage error={clear.error ?? update.error} />
      {editor && (
        <div className="qac-row qac-form-foot">
          {!q && (
            <TextButton
              size="small"
              color="assistive"
              onClick={() => clear.mutate({ id: a.id, flag: 'loginFailed' }, { onSuccess: onDone })}
            >
              비밀번호는 맞음 · 표시 해제
            </TextButton>
          )}
          <div className="qac-row qac-push">
            {q ? (
              <Button
                variant="solid"
                color="primary"
                disabled={!restored || clear.isPending}
                onClick={() => clear.mutate({ id: a.id, flag: 'quarantine' }, { onSuccess: onDone })}
              >
                격리 해제
              </Button>
            ) : (
              <Button
                variant="solid"
                color="primary"
                disabled={!password || update.isPending}
                onClick={() => update.mutate({ id: a.id, patch: { password } }, { onSuccess: onDone })}
              >
                새 비밀번호 저장
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
