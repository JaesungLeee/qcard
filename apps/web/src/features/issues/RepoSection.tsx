// 프로젝트 설정의 GitHub 저장소 (docs/product/issues.md#저장소-연결): 연결·해제·끊김 안내, 담당자 매핑
import { specNameOf, type Project } from '@qcard/shared';
import { Button, Chip, Icons, SectionMessage, TextButton, TextField, textClass } from '@qcard/ui';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtDateTime } from '../../components/format';
import { useIssueContext, useQaDoc, useQaDocs, useRepoSettings } from '../../data/hooks';
import { ErrorMessage, Section, SECTION_ICON } from '../projects/parts';
import './issues.css';

export function RepoSection({ project, admin }: { project: Project; admin: boolean }) {
  const { start, disconnect } = useRepoSettings(project.id);
  const navigate = useNavigate();
  const [confirmOff, setConfirmOff] = useState(false);
  const repo = project.repo;
  /** GitHub로 보낸다 (메모리 구현은 바로 돌아오는 상대 주소) */
  const go = (which: 'installUrl' | 'authorizeUrl') =>
    start.mutate(undefined, {
      onSuccess: (urls) => {
        const url = urls[which];
        if (url.startsWith('/')) void navigate(url);
        else window.location.assign(url);
      },
    });
  return (
    <Section title="GitHub 저장소" icon={<Icons.IconLink aria-hidden style={SECTION_ICON} />}>
      <span className={`${textClass('label2')} qi-muted`}>
        결함을 이 저장소의 이슈로 발행하고, 이슈를 닫거나 다시 열면 결함 상태를 맞춥니다. qcard GitHub App이 고른
        저장소의 이슈 쓰기·템플릿 읽기 권한만 받습니다.
      </span>
      {repo ? (
        <div className="qi-stack">
          <div className={`qi-row ${textClass('label1')}`}>
            <a
              href={`https://github.com/${repo.owner}/${repo.name}`}
              target="_blank"
              rel="noreferrer"
              className="qi-link qc-mono"
            >
              {repo.owner}/{repo.name}
            </a>
            <span className={`${textClass('label2')} qi-muted`}>{repo.private ? '비공개' : '공개'}</span>
            <span className={`${textClass('caption1')} qi-faint`}>
              {repo.connectedBy} · {fmtDateTime(repo.connectedAt)} 연결
            </span>
          </div>
          {repo.status === 'broken' && (
            <SectionMessage
              variant="negative"
              description="GitHub에서 qcard App을 지웠거나 이 저장소를 설치에서 뺐습니다. 발행과 상태 동기화가 멈췄습니다. Admin이 다시 연결하세요."
            >
              저장소 연결이 끊겼습니다
            </SectionMessage>
          )}
          {!repo.private && (
            <span className={`${textClass('caption1')} qi-faint`}>
              공개 저장소라 발행할 때마다 “누구나 볼 수 있다”를 확인합니다.
            </span>
          )}
          {admin && (
            <div className="qi-row">
              {repo.status === 'broken' && (
                <Button
                  size="small"
                  variant="solid"
                  color="primary"
                  disabled={start.isPending}
                  onClick={() => go('installUrl')}
                >
                  다시 연결
                </Button>
              )}
              {confirmOff ? (
                <>
                  <span className={`${textClass('label2')} qi-muted`}>
                    발행한 이슈와 결함의 연결은 남고 동기화만 멈춥니다.
                  </span>
                  <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirmOff(false)}>
                    취소
                  </Button>
                  <Button
                    size="small"
                    variant="solid"
                    color="negative"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate(undefined, { onSuccess: () => setConfirmOff(false) })}
                  >
                    해제하기
                  </Button>
                </>
              ) : (
                <Button size="small" variant="outlined" color="assistive" onClick={() => setConfirmOff(true)}>
                  연결 해제
                </Button>
              )}
            </div>
          )}
        </div>
      ) : admin ? (
        <div className="qi-stack" style={{ gap: 'var(--qc-space-4)' }}>
          <div className="qi-row">
            <Button
              size="small"
              variant="solid"
              color="primary"
              leadingContent={<Icons.IconPlus aria-hidden />}
              disabled={start.isPending}
              onClick={() => go('installUrl')}
            >
              GitHub 저장소 연결
            </Button>
            <TextButton size="small" color="assistive" disabled={start.isPending} onClick={() => go('authorizeUrl')}>
              설치한 App으로 저장소 고르기
            </TextButton>
          </div>
          <span className={`${textClass('caption1')} qi-faint`}>
            다른 프로젝트에서 이미 qcard App을 설치했다면 [설치한 App으로 저장소 고르기]로 설치 없이 저장소만 고릅니다.
          </span>
        </div>
      ) : (
        <span className={`${textClass('caption1')} qi-faint`}>연결한 저장소가 없습니다. Admin이 연결합니다.</span>
      )}
      <ErrorMessage error={start.error ?? disconnect.error} />
      <AssigneeMap project={project} admin={admin} />
    </Section>
  );
}

/** 담당자 매핑: 스펙 이름 → GitHub 사용자명. 스펙 목록은 가장 최근 QA 문서에서, 저장소가 있으면 지정 가능한 사람에서 고른다 */
function AssigneeMap({ project, admin }: { project: Project; admin: boolean }) {
  const docs = useQaDocs(project.id);
  const latest = useMemo(
    () => [...(docs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0],
    [docs.data],
  );
  const doc = useQaDoc(project.id, latest?.id ?? '', !!latest);
  const saved = project.assigneeMap ?? {};
  const specs = useMemo(
    () => [...new Set([...(doc.data?.cases ?? []).map((c) => specNameOf(c.sourceId)), ...Object.keys(saved)])].sort(),
    [doc.data, saved],
  );
  const live = project.repo?.status === 'active';
  const ctx = useIssueContext(project.id, admin && live);
  const { assignees: save } = useRepoSettings(project.id);
  const [draft, setDraft] = useState<Record<string, string[]>>(saved);
  const [text, setText] = useState<Record<string, string>>({});
  const changed = JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(saved));
  const assignable = ctx.data?.assignees;
  return (
    <div className="qi-stack" style={{ marginTop: 'var(--qc-space-8)' }}>
      <span className={textClass('label1', 'bold')}>스펙별 담당자</span>
      <span className={`${textClass('label2')} qi-muted`}>
        이슈 담당자의 기본값입니다. 스펙 이름은 케이스 출처 ID의 앞부분이고 버전이 바뀌어도 유지됩니다. 없으면 템플릿의
        assignees를 씁니다.
      </span>
      {specs.length === 0 ? (
        <span className={`${textClass('caption1')} qi-faint`}>QA 문서를 만들면 스펙 목록이 생깁니다.</span>
      ) : (
        <div className="qi-assignees" role="list" aria-label="스펙별 담당자">
          {specs.map((spec) => {
            const users = draft[spec] ?? [];
            return (
              <div key={spec} role="listitem" style={{ display: 'contents' }}>
                <span className={`qc-mono ${textClass('label1', 'medium')}`}>{spec}</span>
                {!admin ? (
                  <span className={`${textClass('label1')} ${users.length ? '' : 'qi-faint'}`}>
                    {users.length ? users.map((u) => `@${u}`).join(', ') : '미지정'}
                  </span>
                ) : assignable ? (
                  <div className="qi-chips" role="group" aria-label={`${spec} 담당자`}>
                    {[...new Set([...assignable, ...users])].map((u) => (
                      <Chip
                        key={u}
                        size="small"
                        active={users.includes(u)}
                        disabled={!assignable.includes(u) && !users.includes(u)}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            [spec]: users.includes(u) ? users.filter((x) => x !== u) : [...users, u],
                          })
                        }
                      >
                        @{u}
                        {!assignable.includes(u) ? ' (지정할 수 없음)' : ''}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <TextField
                    aria-label={`${spec} 담당자`}
                    placeholder="미지정 · 사용자명을 쉼표로 구분"
                    value={text[spec] ?? users.join(', ')}
                    onChange={(e) => {
                      setText({ ...text, [spec]: e.target.value });
                      setDraft({
                        ...draft,
                        [spec]: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {admin && (
        <>
          <ErrorMessage error={save.error ?? ctx.error} title="담당자를 저장하지 못했습니다" />
          <div className="qi-row" style={{ justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="solid"
              color="primary"
              disabled={!changed || save.isPending}
              onClick={() => save.mutate(draft, { onSuccess: (m) => (setDraft(m), setText({})) })}
            >
              담당자 저장
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const normalize = (m: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(m)
      .filter(([, v]) => v.length)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
