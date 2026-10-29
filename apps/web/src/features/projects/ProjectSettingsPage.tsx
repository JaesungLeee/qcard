import {
  DEFAULT_RUN_LIMITS,
  DELETE_GRACE_DAYS,
  INVITE_TTL_DAYS,
  Role,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  RUN_LIMIT_LABEL,
  runLimitsOf,
  runLimitsProblem,
  type Invitation,
  type Member,
  type Project,
  type RunLimits,
} from '@qcard/shared';
import { Button, Icons, Option, Select, SectionMessage, TextButton, TextField, textClass } from '@qcard/ui';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { fmtDate } from '../../components/format';
import {
  useApi,
  useCreateInvitation,
  useDeleteProject,
  useInvitations,
  useLeaveProject,
  useMembers,
  useMyRole,
  useProject,
  useRemoveMember,
  useRestoreProject,
  useRevokeInvitation,
  useSetMemberRole,
  useSetRunLimits,
} from '../../data/hooks';
import { ErrorMessage, Field, RoleBadge } from './parts';
import './projects.css';

/** 프로젝트 설정 (F-TM-03·10·11·12, F-EX-12): 멤버 · 초대(Admin) · 실행 안전장치 · 탈퇴·삭제. Admin이 아니면 보기와 탈퇴만 */
export function ProjectSettingsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const role = useMyRole(projectId);
  const admin = role.data === 'admin';
  return (
    <div className="qc-page">
      <PageHeader
        title="프로젝트 설정"
        meta={
          admin
            ? '멤버를 초대하고 역할과 실행 안전장치를 정합니다.'
            : '멤버와 실행 안전장치를 볼 수 있습니다. 초대와 변경은 Admin이 합니다.'
        }
      />
      <QueryState query={project}>
        {(p) => (
          <>
            <MembersSection projectId={projectId} admin={admin} />
            {admin && <InvitationsSection projectId={projectId} />}
            <RunLimitsSection project={p} admin={admin} />
            <DangerSection project={p} admin={admin} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`qp-card ${className}`} aria-label={title}>
      <div className="qp-card-head">
        {icon}
        <h2 className={textClass('headline2', 'bold')}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

const icon = { width: 20, height: 20 };

function MembersSection({ projectId, admin }: { projectId: string; admin: boolean }) {
  const api = useApi();
  const members = useMembers(projectId);
  const setRole = useSetMemberRole(projectId);
  const remove = useRemoveMember(projectId);
  return (
    <Section title="멤버" icon={<Icons.IconPersons aria-hidden style={icon} />}>
      <ErrorMessage error={setRole.error ?? remove.error} />
      <QueryState query={members}>
        {(list) => (
          <div className="qp-list" role="list" aria-label="멤버">
            {list.map((m) => (
              <MemberRow
                key={m.uid}
                m={m}
                me={m.uid === api.currentUid}
                admin={admin}
                onRole={(r) => setRole.mutate({ uid: m.uid, role: r })}
                onRemove={() => remove.mutate(m.uid)}
              />
            ))}
          </div>
        )}
      </QueryState>
      <span className={`${textClass('caption1')} qp-faint`}>
        {Role.options.map((r) => `${ROLE_LABEL[r]}: ${ROLE_DESCRIPTION[r]}`).join(' · ')}
      </span>
    </Section>
  );
}

function MemberRow({
  m,
  me,
  admin,
  onRole,
  onRemove,
}: {
  m: Member;
  me: boolean;
  admin: boolean;
  onRole: (r: Role) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`qp-item ${textClass('label1')}`} role="listitem">
      <div className="qp-stack" style={{ gap: 2 }}>
        <span className={textClass('label1', 'medium')}>
          {m.user}
          {me && <span className="qp-faint"> (나)</span>}
        </span>
        <span className={`${textClass('caption1')} qp-faint qc-mono`}>@{m.github}</span>
      </div>
      <div>
        {admin ? (
          <Select aria-label={`${m.user} 역할`} value={m.role} onChange={(v) => onRole(v as Role)}>
            {Role.options.map((r) => (
              <Option key={r} value={r}>
                {ROLE_LABEL[r]}
              </Option>
            ))}
          </Select>
        ) : (
          <RoleBadge role={m.role} />
        )}
      </div>
      <span className={`${textClass('label2')} qp-faint`}>{fmtDate(m.joinedAt)} 참여</span>
      <div className="qp-item-actions">
        {admin && !me && (
          <TextButton size="small" color="assistive" onClick={onRemove} aria-label={`${m.user} 내보내기`}>
            내보내기
          </TextButton>
        )}
      </div>
    </div>
  );
}

const inviteUrl = (inv: Invitation) => `${location.origin}/invite/${inv.token}`;

function InvitationsSection({ projectId }: { projectId: string }) {
  const invitations = useInvitations(projectId);
  const create = useCreateInvitation(projectId);
  const revoke = useRevokeInvitation(projectId);
  const [github, setGithub] = useState('');
  const [role, setRole] = useState<Role>('qa');
  const [created, setCreated] = useState<Invitation>();
  const [copied, setCopied] = useState<string>();
  const copy = (inv: Invitation) => {
    void navigator.clipboard?.writeText(inviteUrl(inv)).then(() => setCopied(inv.id));
  };
  return (
    <Section title="초대" icon={<Icons.IconPersonPlus aria-hidden style={icon} />}>
      <form
        className="qp-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { role, github: github || undefined },
            {
              onSuccess: (inv) => {
                setCreated(inv);
                setGithub('');
              },
            },
          );
        }}
      >
        <Field label="GitHub 사용자명">
          <TextField value={github} onChange={(e) => setGithub(e.target.value)} placeholder="@username" />
        </Field>
        <Field label="역할">
          <Select aria-label="초대 역할" value={role} onChange={(v) => setRole(v as Role)}>
            {Role.options.map((r) => (
              <Option key={r} value={r}>
                {ROLE_LABEL[r]}
              </Option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="solid" color="primary" disabled={create.isPending}>
          {github.trim() ? '초대 보내기' : '초대 링크 만들기'}
        </Button>
      </form>
      <span className={`${textClass('caption1')} qp-faint`} style={{ marginTop: -8 }}>
        사용자명을 비워 두면 링크를 가진 사람 누구나 참여할 수 있는 링크 초대를 만듭니다. 초대는 {INVITE_TTL_DAYS}일 뒤
        만료됩니다.
      </span>
      <ErrorMessage error={create.error ?? revoke.error} />
      {created && !create.error && (
        <SectionMessage
          variant="positive"
          description={`${inviteUrl(created)} — ${fmtDate(created.expiresAt)}까지 유효합니다. 초대받은 사람에게 이 링크를 보내세요.`}
        >
          {created.github ? `@${created.github} 초대를 만들었습니다` : '초대 링크를 만들었습니다'}
        </SectionMessage>
      )}
      <QueryState query={invitations}>
        {(list) =>
          list.length === 0 ? (
            <span className={`${textClass('label1')} qp-muted`}>대기 중인 초대가 없습니다.</span>
          ) : (
            <div className="qp-list" role="list" aria-label="대기 중인 초대">
              {list.map((inv) => {
                const expired = inv.expiresAt < new Date().toISOString();
                return (
                  <div key={inv.id} className={`qp-item ${textClass('label1')}`} role="listitem">
                    <div className="qp-stack" style={{ gap: 2 }}>
                      <span className={textClass('label1', 'medium')}>
                        {inv.github ? <span className="qc-mono">@{inv.github}</span> : '링크 초대'}
                      </span>
                      <span className={`${textClass('caption1')} qp-faint`}>{inv.invitedBy}이(가) 초대</span>
                    </div>
                    <div>
                      <RoleBadge role={inv.role} />
                    </div>
                    <span className={`${textClass('label2')} ${expired ? 'qp-muted' : 'qp-faint'}`}>
                      {expired ? `만료됨 (${fmtDate(inv.expiresAt)})` : `${fmtDate(inv.expiresAt)}까지`}
                    </span>
                    <div className="qp-item-actions">
                      {!expired && (
                        <TextButton
                          size="small"
                          color="assistive"
                          leadingContent={<Icons.IconCopy />}
                          onClick={() => copy(inv)}
                        >
                          {copied === inv.id ? '복사됨' : '링크 복사'}
                        </TextButton>
                      )}
                      <TextButton size="small" color="assistive" onClick={() => revoke.mutate(inv.id)}>
                        {expired ? '지우기' : '취소'}
                      </TextButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      </QueryState>
    </Section>
  );
}

type LimitKey = keyof RunLimits;
type LimitDraft = Record<LimitKey, string>;
const fmtNum = (n: number) => n.toLocaleString('ko-KR');
const draftOf = (l: RunLimits) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, fmtNum(v)])) as LimitDraft;
/** 쉼표를 떼고 숫자로. 비었거나 숫자가 아니면 NaN (검사가 범위 문구로 알린다) */
const limitsOf = (d: LimitDraft) =>
  Object.fromEntries(
    Object.entries(d).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v.replace(/[,\s]/g, ''))]),
  ) as RunLimits;

/** 실행 안전장치 (F-EX-08·12). Admin만 바꾸고, 다른 멤버는 값만 본다. 진행 중 사이클도 다음 Run부터 적용 */
function RunLimitsSection({ project, admin }: { project: Project; admin: boolean }) {
  const saved = runLimitsOf(project);
  const save = useSetRunLimits(project.id);
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [done, setDone] = useState(false);
  const next = limitsOf(draft);
  const problem = runLimitsProblem(next);
  const changed = (Object.keys(saved) as LimitKey[]).some((k) => next[k] !== saved[k]);
  const isDefault = (Object.keys(saved) as LimitKey[]).every((k) => next[k] === DEFAULT_RUN_LIMITS[k]);
  const input = (k: LimitKey, unit?: string) => (
    <TextField
      aria-label={RUN_LIMIT_LABEL[k]}
      inputMode="numeric"
      value={draft[k]}
      readOnly={!admin}
      status={admin && Number.isNaN(next[k]) ? 'negative' : undefined}
      trailingContent={unit ? <span className={`${textClass('label2')} qp-faint`}>{unit}</span> : undefined}
      onChange={(e) => {
        setDone(false);
        setDraft({ ...draft, [k]: e.target.value });
      }}
    />
  );
  return (
    <Section title="실행 안전장치" icon={<Icons.IconThunder aria-hidden style={icon} />}>
      <span className={`${textClass('label2')} qp-muted`}>
        Agent가 실행자의 Claude 플랜 사용량을 지나치게 쓰지 않도록 막습니다. 케이스 한도를 넘으면 그 케이스는
        Blocked(실행 한도 초과)로 끝나고 다음 케이스로 넘어갑니다. 바꾼 값은 진행 중인 사이클에도 다음 Run부터
        적용됩니다.
      </span>
      <div className="qp-limits">
        <Field
          label="케이스당 최대 턴"
          hint="단계 수 × 단계당 턴 + 추가 턴. 준비·원복 플로우도 각자의 스텝 수로 셉니다"
        >
          <div className="qp-row qp-limit-turns" style={{ flexWrap: 'nowrap' }}>
            <span className={`${textClass('label1')} qp-muted`}>단계 수 ×</span>
            {input('turnsPerStep')}
            <span className={`${textClass('label1')} qp-muted`}>+</span>
            {input('extraTurns')}
          </div>
        </Field>
        <Field label="같은 화면 · 같은 액션 반복" hint="이만큼 반복하면 Blocked">
          {input('repeatLimit', '회')}
        </Field>
        <Field label="자가 복구" hint="액션 실패 후 다시 시도한 횟수가 이보다 많으면 Pass를 자동 확정하지 않습니다">
          {input('retryLimit', '회')}
        </Field>
        <Field label="케이스당 LLM 호출" hint="준비·검증·원복 포함">
          {input('callsPerCase', '회')}
        </Field>
        <Field label="케이스당 토큰" hint="입력(캐시 포함) + 출력">
          {input('tokensPerCase', '토큰')}
        </Field>
        <Field label="Run당 토큰" hint="넘으면 다음 케이스 전에 Run을 일시정지합니다. 한도를 올린 뒤 이어서 실행합니다">
          {input('tokensPerRun', '토큰')}
        </Field>
        <Field label="실행자 대기" hint="수동 스텝·위험 액션 승인을 기다리는 시간. 지나면 Blocked">
          {input('waitTimeoutMin', '분')}
        </Field>
      </div>
      {admin ? (
        <>
          {problem && (
            <SectionMessage variant="negative" description={problem}>
              저장할 수 없습니다
            </SectionMessage>
          )}
          <ErrorMessage error={save.error} title="저장하지 못했습니다" />
          {done && !changed && (
            <SectionMessage variant="positive" description="다음 Run부터 적용됩니다.">
              실행 안전장치를 저장했습니다
            </SectionMessage>
          )}
          <div className="qp-row" style={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="outlined"
              color="assistive"
              disabled={isDefault}
              onClick={() => {
                setDone(false);
                setDraft(draftOf(DEFAULT_RUN_LIMITS));
              }}
            >
              기본값으로
            </Button>
            <Button
              size="small"
              variant="solid"
              color="primary"
              disabled={!changed || !!problem || save.isPending}
              onClick={() =>
                save.mutate(next, {
                  onSuccess: (p) => {
                    setDraft(draftOf(runLimitsOf(p)));
                    setDone(true);
                  },
                })
              }
            >
              저장
            </Button>
          </div>
        </>
      ) : (
        <span className={`${textClass('caption1')} qp-faint`}>실행 안전장치는 Admin이 바꿉니다.</span>
      )}
    </Section>
  );
}

function DangerSection({ project: p, admin }: { project: Project; admin: boolean }) {
  const navigate = useNavigate();
  const leave = useLeaveProject(p.id);
  const del = useDeleteProject(p.id);
  const restore = useRestoreProject(p.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [name, setName] = useState('');
  return (
    <Section title="탈퇴 · 삭제" icon={<Icons.IconTrash aria-hidden style={icon} />} className="qp-danger">
      <div className="qp-danger-row">
        <div className="qp-stack">
          <span className={textClass('label1', 'bold')}>프로젝트에서 탈퇴</span>
          <span className={`${textClass('label2')} qp-muted`}>
            탈퇴하면 이 프로젝트를 볼 수 없습니다. 내가 남긴 판정과 이력은 그대로 남습니다. 마지막 Admin은 다른 멤버를
            Admin으로 지정한 뒤 탈퇴할 수 있습니다.
          </span>
        </div>
        {confirmLeave ? (
          <div className="qp-row">
            <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirmLeave(false)}>
              취소
            </Button>
            <Button
              size="small"
              variant="solid"
              color="negative"
              leadingContent={<Icons.IconLogout />}
              disabled={leave.isPending}
              onClick={() => leave.mutate(undefined, { onSuccess: () => void navigate('/projects') })}
            >
              탈퇴하기
            </Button>
          </div>
        ) : (
          <Button
            size="small"
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconLogout />}
            onClick={() => setConfirmLeave(true)}
          >
            탈퇴
          </Button>
        )}
      </div>
      <ErrorMessage error={leave.error} title="탈퇴할 수 없습니다" />

      {admin && (
        <div className="qp-danger-row">
          {p.deletedAt ? (
            <>
              <div className="qp-stack">
                <span className={textClass('label1', 'bold')}>삭제 예정</span>
                <span className={`${textClass('label2')} qp-muted`}>
                  {fmtDate(p.purgeAt!)}에 QA 문서·사이클·결과·녹화·스크린샷과 테스트 계정 비밀값이 영구 삭제됩니다. 그
                  전까지 복구할 수 있습니다.
                </span>
              </div>
              <Button
                size="small"
                variant="outlined"
                color="assistive"
                leadingContent={<Icons.IconRefresh />}
                disabled={restore.isPending}
                onClick={() => restore.mutate(undefined)}
              >
                복구
              </Button>
            </>
          ) : (
            <>
              <div className="qp-stack">
                <span className={textClass('label1', 'bold')}>프로젝트 삭제</span>
                <span className={`${textClass('label2')} qp-muted`}>
                  {DELETE_GRACE_DAYS}일 동안 삭제 예정으로 남고, 그 뒤 모든 데이터와 비밀값이 영구 삭제됩니다. 확인을
                  위해 프로젝트 이름 「{p.name}」을 입력하세요.
                </span>
              </div>
              <div className="qp-row" style={{ flexWrap: 'nowrap' }}>
                <TextField
                  aria-label="삭제 확인용 프로젝트 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={p.name}
                />
                <Button
                  size="small"
                  variant="solid"
                  color="negative"
                  leadingContent={<Icons.IconTrash />}
                  disabled={name.trim() !== p.name || del.isPending}
                  onClick={() => del.mutate(name, { onSuccess: () => setName('') })}
                >
                  삭제
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <ErrorMessage error={del.error ?? restore.error} />
    </Section>
  );
}
