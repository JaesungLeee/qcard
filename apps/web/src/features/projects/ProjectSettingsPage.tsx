import {
  DELETE_GRACE_DAYS,
  INVITE_TTL_DAYS,
  Role,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type Invitation,
  type Member,
  type Project,
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
} from '../../data/hooks';
import { ErrorMessage, Field, RoleBadge } from './parts';
import './projects.css';

/** 프로젝트 설정 (F-TM-03·10·11·12): 멤버 · 초대(Admin) · 탈퇴·삭제. Admin이 아니면 멤버 보기와 탈퇴만 */
export function ProjectSettingsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const role = useMyRole(projectId);
  const admin = role.data === 'admin';
  return (
    <div className="qc-page">
      <PageHeader
        title="프로젝트 설정"
        meta={admin ? '멤버를 초대하고 역할을 정합니다.' : '멤버를 볼 수 있습니다. 초대와 역할 변경은 Admin이 합니다.'}
      />
      <QueryState query={project}>
        {(p) => (
          <>
            <MembersSection projectId={projectId} admin={admin} />
            {admin && <InvitationsSection projectId={projectId} />}
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
