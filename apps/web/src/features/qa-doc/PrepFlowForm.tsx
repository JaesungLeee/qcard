import { prepFlowProblem, type PrepFlow, type PrepFlowInput, type PrepFlowKind } from '@qcard/shared';
import {
  Button,
  Option,
  SectionMessage,
  Select,
  TextArea,
  TextField,
  textClass,
  token,
} from '@qcard/ui';
import { useState, type ReactNode } from 'react';
import { fmtDateTime } from '../../components/format';
import { PrepFlowConflictError, type DocRef } from '../../data/api';
import { useCreatePrepFlow, useUpdatePrepFlow } from '../../data/hooks';
import { PREP_KIND_HINT, PREP_KIND_LABEL } from './params';
import { SortableSteps } from './SortableSteps';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="qd-form-field">
      <span className={`${textClass('label2', 'medium')} qd-form-label`}>{label}</span>
      {children}
      {hint && <span className={`${textClass('caption1')} qd-faint`}>{hint}</span>}
    </div>
  );
}

const toInput = (f?: PrepFlow): PrepFlowInput =>
  f
    ? { name: f.name, kind: f.kind, check: f.check, steps: [...f.steps] }
    : { name: '', kind: 'login', check: '', steps: [''] };
const same = (a: PrepFlowInput, b: PrepFlowInput) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 준비 플로우 추가·편집 폼 (F-PF-01). 편집은 낙관적 잠금 — 다른 사람이 먼저 저장했으면 최신 내용을 보이고
 * 내 편집을 그 위에 다시 쓸지 버릴지 고른다. 편집은 그 QA 문서 버전에만 적용되고, 사이클에 고정되지 않아
 * 그 버전으로 만든 진행 중인 사이클도 다음 Run부터 바뀐다
 */
export function PrepFlowForm({
  docRef,
  appVersion,
  flow,
  onDone,
}: {
  docRef: DocRef;
  appVersion: string;
  flow?: PrepFlow;
  onDone: () => void;
}) {
  const create = useCreatePrepFlow(docRef);
  const update = useUpdatePrepFlow(docRef);
  const save = flow ? update : create;
  const [base, setBase] = useState(() => ({ input: toInput(flow), rev: flow?.rev ?? 0 }));
  const [draft, setDraft] = useState<PrepFlowInput>(() => toInput(flow));
  const [conflict, setConflict] = useState<PrepFlow | null>(null);
  const [problem, setProblem] = useState<string>();
  const dirty = !same(base.input, draft);
  const patch = (p: Partial<PrepFlowInput>) => setDraft((d) => ({ ...d, ...p }));
  const submit = () => {
    const p = prepFlowProblem(draft);
    setProblem(p);
    if (p) return;
    const opts = {
      onSuccess: onDone,
      onError: (e: Error) => {
        if (e instanceof PrepFlowConflictError) setConflict(e.latest);
      },
    };
    if (flow) update.mutate({ id: flow.id, input: draft, expectedRev: base.rev }, opts);
    else create.mutate(draft, opts);
  };
  /** 최신 rev 기준으로 내 편집을 다시 저장할 수 있게 한다 (필드 단위 병합 없이 내 값으로 덮는다) */
  const keepMine = () => {
    if (!conflict) return;
    setBase({ input: toInput(conflict), rev: conflict.rev ?? 0 });
    setConflict(null);
    update.reset();
  };
  const takeLatest = () => {
    if (!conflict) return;
    setBase({ input: toInput(conflict), rev: conflict.rev ?? 0 });
    setDraft(toInput(conflict));
    setConflict(null);
    update.reset();
  };

  const env = draft.kind === 'env';
  return (
    <form
      className="qd-form"
      aria-label={flow ? `${flow.name} 편집` : '준비 플로우 추가'}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className={textClass('headline2', 'bold')}>{flow ? '준비 플로우 편집' : '준비 플로우 추가'}</h2>
      {conflict && (
        <SectionMessage
          variant="negative"
          description={
            <span className="qd-stack" style={{ gap: token('space-8') }}>
              <span>
                {conflict.updatedBy ?? '다른 사용자'}님이{' '}
                {conflict.updatedAt ? <span className="qd-num">{fmtDateTime(conflict.updatedAt)}</span> : '먼저'}에
                저장했습니다 (rev {base.rev} → {conflict.rev ?? 0}). 내 편집은 아직 저장되지 않았습니다.
              </span>
              <span className="qd-stack" style={{ gap: token('space-4') }}>
                <span className={textClass('label2', 'bold')}>최신 내용</span>
                <span>
                  {PREP_KIND_LABEL[conflict.kind]} · {conflict.name}
                </span>
                <span>확인 조건: {conflict.check}</span>
                <ol className="qd-list">
                  {conflict.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </span>
              <span className="qd-row">
                <Button size="small" variant="outlined" color="primary" type="button" onClick={keepMine}>
                  내 편집으로 덮어쓰기
                </Button>
                <Button size="small" variant="outlined" color="assistive" type="button" onClick={takeLatest}>
                  내 편집 버리고 최신 내용 보기
                </Button>
              </span>
            </span>
          }
        >
          다른 사람이 먼저 저장했습니다
        </SectionMessage>
      )}
      {flow && (
        <SectionMessage
          variant="info"
          description={`QA 문서 ${appVersion}의 플로우만 바뀌고, 다른 버전의 같은 플로우는 그대로입니다. 준비 플로우는 사이클에 고정되지 않아 이 버전으로 만든 진행 중인 사이클도 다음 실행부터 바뀐 내용으로 준비합니다.`}
        >
          QA 문서 {appVersion}에만 적용됩니다
        </SectionMessage>
      )}

      <div className="qd-form-grid">
        <Field label="이름">
          <TextField aria-label="이름" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="종류" hint={PREP_KIND_HINT[draft.kind]}>
          <Select aria-label="종류" value={draft.kind} onChange={(v) => patch({ kind: v as PrepFlowKind })}>
            {(Object.keys(PREP_KIND_LABEL) as PrepFlowKind[]).map((k) => (
              <Option key={k} value={k}>
                {PREP_KIND_LABEL[k]}
              </Option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="확인 조건" hint="준비가 끝났을 때 화면에서 보여야 하는 것을 한 문장으로 씁니다.">
        <TextArea
          width="100%"
          aria-label="확인 조건"
          minRows={1}
          maxRows={4}
          value={draft.check}
          onChange={(e) => patch({ check: e.target.value })}
        />
      </Field>

      <Field
        label={`수행 스텝 ${draft.steps.length}`}
        hint={
          env
            ? '환경 플로우는 코드가 앱 데이터를 초기화하고 앱을 실행합니다. 스텝은 설명으로만 보이고 Agent가 수행하지 않습니다.'
            : 'Agent가 위에서부터 순서대로 UI로 수행합니다. 테스트 계정 값은 {{account.loginId}}·{{account.password}}로 씁니다.'
        }
      >
        <SortableSteps steps={draft.steps} onChange={(steps) => patch({ steps })} />
      </Field>

      {problem && (
        <SectionMessage variant="negative" description={problem}>
          저장할 수 없습니다
        </SectionMessage>
      )}
      {save.isError && !conflict && (
        <SectionMessage variant="negative" description={save.error.message}>
          저장하지 못했습니다
        </SectionMessage>
      )}

      <div className="qd-form-actions">
        {flow && (
          <span className={`${textClass('label2')} qd-faint`} style={{ marginRight: 'auto', alignSelf: 'center' }}>
            rev <span className="qc-mono">{base.rev}</span> 기준 편집{dirty ? ' · 저장 안 됨' : ''}
          </span>
        )}
        <Button size="small" variant="outlined" color="assistive" type="button" onClick={onDone}>
          취소
        </Button>
        <Button
          size="small"
          variant="solid"
          color="primary"
          type="submit"
          loading={save.isPending}
          disabled={!dirty || !!conflict}
        >
          {flow ? '저장' : '추가'}
        </Button>
      </div>
    </form>
  );
}
