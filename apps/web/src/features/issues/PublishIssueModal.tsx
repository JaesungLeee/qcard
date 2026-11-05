// 이슈 발행 팝업 (docs/product/issues.md#발행-팝업): 템플릿 고르기 → 내 호스트의 초안(또는 초안 없이) → 편집 → 발행
import {
  issueFieldLabel,
  issueValueEmpty,
  MAX_ISSUE_ASSIGNEES,
  missingRequired,
  type Defect,
  type IssueDraftJob,
  type IssueField,
  type IssueTemplate,
  type Project,
  type TestCycle,
} from '@qcard/shared';
import {
  ActionArea,
  ActionAreaButton,
  Button,
  Chip,
  Icons,
  Loading,
  Modal,
  ModalContainer,
  ModalContent,
  ModalNavigation,
  SectionMessage,
  TextArea,
  TextButton,
  TextField,
  textClass,
} from '@qcard/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { CheckLabel } from '../../components/CheckLabel';
import { useIssueContext, useIssueDraft, useMyHosts, usePublishIssue, useRequestIssueDraft } from '../../data/hooks';
import { ErrorMessage } from '../projects/parts';
import { hostSupport } from '../qa-doc/logic';
import {
  bodyOf,
  draftFor,
  droppedDefaults,
  footerPreview,
  initialForm,
  templateChoices,
  templateKey,
  type IssueForm,
} from './model';
import './issues.css';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  cycle: Pick<TestCycle, 'id' | 'name'>;
  defect: Defect;
  /** 결함의 스펙 이름 (담당자 매핑의 키) */
  specName: string;
  /** 요청자 GitHub 사용자명 (끝줄 미리 보기) */
  requester: string;
};

export function PublishIssueModal(props: Props) {
  const { open, onOpenChange, defect } = props;
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContainer variant="popup" size="large" sticky>
        <ModalNavigation variant="emphasized">{`${defect.id} 이슈 발행`}</ModalNavigation>
        {open && <PublishFlow {...props} />}
      </ModalContainer>
    </Modal>
  );
}

function PublishFlow({ onOpenChange, project, cycle, defect, specName, requester }: Props) {
  const ref = { projectId: project.id, cycleId: cycle.id };
  const ctx = useIssueContext(project.id, true);
  const draft = useIssueDraft(ref, defect.id, true);
  const request = useRequestIssueDraft(ref, defect.id);
  const hosts = useMyHosts();
  const [picked, setPicked] = useState<IssueTemplate>();
  const [noDraft, setNoDraft] = useState(false);
  const [form, setForm] = useState<IssueForm>();
  /** 템플릿을 고른 시각: 그 전에 만든 초안(같은 템플릿의 지난 초안)은 쓰지 않는다 */
  const [since, setSince] = useState<string>();

  // 팝업을 닫았다 열면 마지막 초안의 템플릿으로 바로 간다
  const last = draft.data;
  useEffect(() => {
    if (!picked && last) setPicked(last.input.template);
    // 처음 읽었을 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  const job = picked && last && draftFor(last, picked) && (!since || last.createdAt >= since) ? last : undefined;
  useEffect(() => {
    if (!picked || form || !ctx.data) return;
    const result = job?.status === 'done' ? job.result : undefined;
    if (!result && !noDraft) return;
    setForm(
      initialForm({
        template: picked,
        draft: result,
        defect,
        ctx: ctx.data,
        assigneeMap: project.assigneeMap,
        specName,
      }),
    );
  }, [picked, form, ctx.data, job?.status, job?.result, noDraft, defect, project.assigneeMap, specName]);

  const choose = (t: IssueTemplate) => {
    setSince(new Date().toISOString());
    setPicked(t);
    setForm(undefined);
    setNoDraft(false);
    request.mutate({ template: t });
  };
  const back = () => {
    setPicked(undefined);
    setForm(undefined);
    setNoDraft(false);
  };

  if (ctx.isPending)
    return (
      <ModalContent>
        <Loading aria-label="저장소 템플릿을 읽는 중" />
      </ModalContent>
    );
  if (ctx.error)
    return (
      <ModalContent>
        <ErrorMessage error={ctx.error} title="저장소를 읽지 못했습니다" />
      </ModalContent>
    );
  const c = ctx.data;
  if (!picked)
    return (
      <ModalContent gap="var(--qc-space-12)">
        <RepoLine repo={c.repo} />
        <TemplateList entries={templateChoices(c)} onPick={choose} />
      </ModalContent>
    );
  if (!form)
    return (
      <ModalContent gap="var(--qc-space-12)">
        <PickedLine template={picked} onBack={back} />
        <ErrorMessage error={request.error} title="초안을 요청하지 못했습니다" />
        <DraftWait
          job={job}
          host={hostSupport(hosts.data ?? [], 'issue_draft')}
          onRetry={() => (job ? request.mutate({ retryJobId: job.id }) : request.mutate({ template: picked }))}
          onSkip={() => setNoDraft(true)}
        />
      </ModalContent>
    );
  return (
    <Editor
      template={picked}
      form={form}
      setForm={setForm}
      empty={job?.status === 'done' && !noDraft ? (job.result?.empty ?? []) : []}
      ctx={c}
      dropped={droppedDefaults({ template: picked, ctx: c, assigneeMap: project.assigneeMap, specName })}
      footer={footerPreview({ projectId: project.id, cycleId: cycle.id, cycleName: cycle.name, defect, requester })}
      onBack={back}
      onClose={() => onOpenChange(false)}
      defectId={defect.id}
      cycleRef={ref}
      requester={requester}
    />
  );
}

function RepoLine({ repo }: { repo: { owner: string; name: string; private: boolean; url: string } }) {
  return (
    <div className={`qi-row ${textClass('label2')}`}>
      <Icons.IconLink aria-hidden className="qi-muted" />
      <a href={repo.url} target="_blank" rel="noreferrer" className="qi-link qc-mono">
        {repo.owner}/{repo.name}
      </a>
      <span className="qi-muted">{repo.private ? '비공개 저장소' : '공개 저장소'}</span>
    </div>
  );
}

function TemplateList({
  entries,
  onPick,
}: {
  entries: ReturnType<typeof templateChoices>;
  onPick: (t: IssueTemplate) => void;
}) {
  return (
    <div className="qi-stack" role="list" aria-label="이슈 템플릿">
      <span className={`${textClass('label2', 'medium')} qi-muted`}>템플릿을 고르면 내 호스트가 초안을 씁니다</span>
      {entries.map((e) =>
        'error' in e ? (
          <div key={e.file} role="listitem" className="qi-template qi-template-off" aria-disabled>
            <span className={textClass('label1', 'medium')}>{e.file.split('/').at(-1)}</span>
            <span className={`${textClass('caption1')} qi-muted`}>읽을 수 없음 · {e.error}</span>
          </div>
        ) : (
          <div key={templateKey(e.template)} role="listitem">
            <button type="button" className="qi-template" onClick={() => onPick(e.template)}>
              <span className={`qi-row ${textClass('label1', 'bold')}`}>
                {e.template.name}
                {!e.file && <span className={`${textClass('caption1')} qi-muted`}>qcard 기본</span>}
                {e.template.kind === 'form' && <span className={`${textClass('caption1')} qi-muted`}>이슈 폼</span>}
              </span>
              {e.template.about && <span className={`${textClass('label2')} qi-muted`}>{e.template.about}</span>}
              {e.file && <span className={`${textClass('caption1')} qi-faint qc-mono`}>{e.file}</span>}
            </button>
          </div>
        ),
      )}
    </div>
  );
}

function PickedLine({ template, onBack }: { template: IssueTemplate; onBack: () => void }) {
  return (
    <div className="qi-row">
      <span className={textClass('label1', 'bold')}>{template.name}</span>
      <TextButton size="small" color="assistive" onClick={onBack}>
        템플릿 바꾸기
      </TextButton>
    </div>
  );
}

/** 초안 기다리기: 대기·생성 중·호스트 꺼짐·실패. 언제든 [초안 없이 작성]으로 템플릿 원문을 편집한다 */
function DraftWait({
  job,
  host,
  onRetry,
  onSkip,
}: {
  job: IssueDraftJob | undefined;
  host: 'ok' | 'offline' | 'outdated';
  onRetry: () => void;
  onSkip: () => void;
}) {
  const failed = job?.status === 'failed' || job?.status === 'paused';
  const message: ReactNode = failed ? (
    <SectionMessage variant="negative" description={job?.error?.message ?? ''}>
      초안을 만들지 못했습니다
    </SectionMessage>
  ) : host === 'offline' ? (
    <SectionMessage
      variant="info"
      description="이 PC에서 qcard 호스트를 켜면 초안을 만듭니다. 기다리지 않으려면 초안 없이 작성하세요."
    >
      호스트를 켜면 초안을 만듭니다
    </SectionMessage>
  ) : host === 'outdated' ? (
    <SectionMessage
      variant="cautionary"
      description="이슈 초안을 만들려면 호스트를 업데이트하세요 (npm i -g @qcard/host)."
    >
      호스트가 이슈 초안을 지원하지 않습니다
    </SectionMessage>
  ) : (
    <div className="qi-wait">
      <Loading aria-label="초안을 쓰는 중" />
      <span className={`${textClass('label1')} qi-muted`}>
        {job?.status === 'running'
          ? `${job.host ?? '내 호스트'}에서 초안을 쓰고 있습니다`
          : '호스트가 받기를 기다립니다'}
      </span>
      <span className={`${textClass('caption1')} qi-faint`}>
        결함·케이스 텍스트만 보냅니다. 스크린샷은 보내지 않습니다. 사용량은 내 Claude 플랜에서 나갑니다.
      </span>
    </div>
  );
  return (
    <div className="qi-stack">
      {message}
      <div className="qi-row">
        {failed && (
          <Button size="small" variant="outlined" color="assistive" onClick={onRetry}>
            다시 시도
          </Button>
        )}
        <Button size="small" variant="outlined" color="assistive" onClick={onSkip}>
          초안 없이 작성
        </Button>
      </div>
    </div>
  );
}

function Editor({
  template,
  form,
  setForm,
  empty,
  ctx,
  dropped,
  footer,
  onBack,
  onClose,
  defectId,
  cycleRef,
  requester,
}: {
  requester: string;
  template: IssueTemplate;
  form: IssueForm;
  setForm: (f: IssueForm) => void;
  empty: string[];
  ctx: { repo: { private: boolean; owner: string; name: string; url: string }; labels: string[]; assignees: string[] };
  dropped: { labels: string[]; assignees: string[] };
  footer: string;
  onBack: () => void;
  onClose: () => void;
  defectId: string;
  cycleRef: { projectId: string; cycleId: string };
}) {
  const publish = usePublishIssue(cycleRef);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const set = (patch: Partial<IssueForm>) => setForm({ ...form, ...patch });
  const missing = template.kind === 'form' ? missingRequired(template, form.values) : [];
  const emptySet = new Set(empty);
  const blocked = !form.title.trim() || (!ctx.repo.private && !confirmPublic);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <>
      <ModalContent gap="var(--qc-space-16)">
        <PickedLine template={template} onBack={onBack} />
        {empty.length > 0 && (
          <SectionMessage
            variant="info"
            description={`넘긴 정보로 채울 수 없어 비운 칸: ${template.fields
              .filter((f) => emptySet.has(f.id))
              .map(issueFieldLabel)
              .join(', ')}`}
          >
            직접 채울 칸이 있습니다
          </SectionMessage>
        )}
        <label className="qi-field">
          <span className={`${textClass('label2', 'medium')} qi-muted`}>제목</span>
          <TextField aria-label="제목" value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        {template.kind === 'markdown' ? (
          <label className="qi-field">
            <span className={`${textClass('label2', 'medium')} qi-muted`}>본문 (Markdown)</span>
            <TextArea
              width="100%"
              aria-label="본문"
              minRows={10}
              maxRows={24}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
            />
          </label>
        ) : (
          template.fields.map((f) => (
            <FormField
              key={f.id}
              field={f}
              value={form.values[f.id]}
              mark={emptySet.has(f.id) && issueValueEmpty(f, form.values[f.id])}
              onChange={(v) => set({ values: { ...form.values, [f.id]: v } })}
            />
          ))
        )}
        {missing.length > 0 && (
          <SectionMessage
            variant="cautionary"
            description={`${missing.join(', ')} — GitHub는 API로 만드는 이슈의 필수 칸을 검사하지 않아 발행은 됩니다.`}
          >
            템플릿의 필수 칸이 비어 있습니다
          </SectionMessage>
        )}
        <div className="qi-field" role="group" aria-label="라벨">
          <span className={`${textClass('label2', 'medium')} qi-muted`}>라벨</span>
          <div className="qi-chips">
            {ctx.labels.map((l) => (
              <Chip
                key={l}
                size="small"
                active={form.labels.includes(l)}
                onClick={() => set({ labels: toggle(form.labels, l) })}
              >
                {l}
              </Chip>
            ))}
            {ctx.labels.length === 0 && (
              <span className={`${textClass('caption1')} qi-faint`}>저장소에 라벨이 없습니다</span>
            )}
          </div>
          {dropped.labels.length > 0 && (
            <span className={`${textClass('caption1')} qi-faint`}>
              저장소에 없음(빼고 발행): {dropped.labels.join(', ')} · qcard는 라벨을 만들지 않습니다
            </span>
          )}
        </div>
        <div className="qi-field" role="group" aria-label="담당자">
          <span className={`${textClass('label2', 'medium')} qi-muted`}>
            담당자 ({form.assignees.length}/{MAX_ISSUE_ASSIGNEES})
          </span>
          <div className="qi-chips">
            {ctx.assignees.map((u) => (
              <Chip
                key={u}
                size="small"
                active={form.assignees.includes(u)}
                disabled={!form.assignees.includes(u) && form.assignees.length >= MAX_ISSUE_ASSIGNEES}
                onClick={() => set({ assignees: toggle(form.assignees, u) })}
              >
                @{u}
              </Chip>
            ))}
          </div>
          {dropped.assignees.length > 0 && (
            <span className={`${textClass('caption1')} qi-faint`}>
              지정할 수 없음(빼고 발행): {dropped.assignees.map((u) => `@${u}`).join(', ')}
            </span>
          )}
        </div>
        <div className="qi-field">
          <span className={`${textClass('label2', 'medium')} qi-muted`}>본문 끝에 붙는 줄 (고칠 수 없음)</span>
          <pre className={`qi-footer ${textClass('caption1')} qc-mono`}>{footer}</pre>
          <span className={`${textClass('caption1')} qi-faint`}>
            판정 추적 링크는 qcard 멤버만 엽니다. 스크린샷은 이 링크로 봅니다.
          </span>
        </div>
        {!ctx.repo.private && (
          <SectionMessage
            variant="cautionary"
            description={`${ctx.repo.owner}/${ctx.repo.name}은(는) 공개 저장소입니다. 이슈는 누구나 볼 수 있고, 미공개 스펙 내용이 들어갈 수 있습니다.`}
          >
            공개 저장소에 발행합니다
          </SectionMessage>
        )}
        {!ctx.repo.private && (
          <CheckLabel
            className={`qi-row ${textClass('label1', 'medium')}`}
            checked={confirmPublic}
            onCheckedChange={setConfirmPublic}
          >
            누구나 볼 수 있다는 것을 확인했습니다
          </CheckLabel>
        )}
        <ErrorMessage error={publish.error} title="발행하지 못했습니다" />
      </ModalContent>
      <ActionArea variant="compact" caption={`작성자 qcard-bot[bot] · 본문 끝에 reported by @${requester}`}>
        <ActionAreaButton variant="alternative" onClick={onClose}>
          닫기
        </ActionAreaButton>
        <ActionAreaButton
          variant="main"
          disabled={blocked || publish.isPending}
          onClick={() =>
            publish.mutate(
              {
                ...cycleRef,
                defectId,
                title: form.title.trim(),
                body: bodyOf(template, form),
                labels: form.labels,
                assignees: form.assignees,
                confirmPublic: !ctx.repo.private ? confirmPublic : undefined,
              },
              { onSuccess: onClose },
            )
          }
        >
          {publish.isPending ? '발행 중…' : '발행'}
        </ActionAreaButton>
      </ActionArea>
    </>
  );
}

/** 이슈 폼 칸 하나: 한 줄·여러 줄·드롭다운(칩)·체크박스 */
function FormField({
  field: f,
  value,
  mark,
  onChange,
}: {
  field: IssueField;
  value: string | string[] | undefined;
  mark: boolean;
  onChange: (v: string | string[]) => void;
}) {
  if (f.type === 'section') return null;
  const head = (
    <span className={`qi-row ${textClass('label2', 'medium')}`}>
      <span className="qi-muted">{f.label}</span>
      {f.required && <span className="qi-required">필수</span>}
      {mark && <span className={`${textClass('caption1')} qi-mark`}>직접 채울 칸</span>}
    </span>
  );
  const desc = f.description && <span className={`${textClass('caption1')} qi-faint`}>{f.description}</span>;
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  if (f.type === 'dropdown' || f.type === 'checkboxes') {
    const options = f.type === 'dropdown' ? f.options : f.options.map((o) => o.label);
    const multi = f.type === 'checkboxes' || f.multiple;
    return (
      <div className="qi-field" role="group" aria-label={f.label}>
        {head}
        {desc}
        <div className={f.type === 'checkboxes' ? 'qi-stack' : 'qi-chips'}>
          {options.map((o) =>
            f.type === 'checkboxes' ? (
              <CheckLabel
                key={o}
                className={`qi-row ${textClass('label1')}`}
                checked={picked.includes(o)}
                onCheckedChange={(on) => onChange(on ? [...picked, o] : picked.filter((x) => x !== o))}
              >
                {o}
              </CheckLabel>
            ) : (
              <Chip
                key={o}
                size="small"
                active={picked.includes(o)}
                onClick={() =>
                  onChange(picked.includes(o) ? picked.filter((x) => x !== o) : multi ? [...picked, o] : [o])
                }
              >
                {o}
              </Chip>
            ),
          )}
        </div>
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <label className="qi-field">
      {head}
      {desc}
      {f.type === 'input' ? (
        <TextField
          aria-label={f.label}
          placeholder={f.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <TextArea
          width="100%"
          aria-label={f.label}
          placeholder={f.placeholder}
          minRows={f.render ? 3 : 2}
          maxRows={12}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
