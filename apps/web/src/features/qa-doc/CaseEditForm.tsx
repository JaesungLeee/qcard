import {
  type CaseBody,
  PLATFORM_LABEL,
  POINT_COMPARE_LABEL,
  POINT_METHOD_LABEL,
  type PointCompare,
  type PointMethod,
  type PrepFlow,
  PRIORITY_LABEL,
  type QADocument,
  TEST_TYPE_LABEL,
  type TestCase,
  type VerificationPoint,
} from '@qcard/shared';
import {
  Button,
  Checkbox,
  IconButton,
  Icons,
  Option,
  SectionMessage,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  TextArea,
  TextButton,
  TextField,
  textClass,
  token,
} from '@qcard/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { fmtDateTime } from '../../components/format';
import { ConflictError } from '../../data/api';
import { useUpdateCase } from '../../data/hooks';
import { CaseDiff } from './CaseDiff';
import {
  BODY_LABEL,
  cleanBody,
  diffCase,
  isDirty,
  nextPointId,
  rebaseDraft,
  toBody,
  validateBody,
  type Rebase,
} from './logic';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="qd-form-field">
      <span className={`${textClass('label2', 'medium')} qd-form-label`}>{label}</span>
      {children}
      {hint && <span className={`${textClass('caption1')} qd-faint`}>{hint}</span>}
    </div>
  );
}

function EnumSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
  disabled?: (v: T) => boolean;
}) {
  return (
    <Field label={label}>
      <Select aria-label={label} value={value} onChange={(v) => onChange(v as T)}>
        {(Object.keys(options) as T[]).map((k) => (
          <Option key={k} value={k} disabled={disabled?.(k)}>
            {options[k]}
          </Option>
        ))}
      </Select>
    </Field>
  );
}

const MODE_LABEL = { auto: 'Auto', manual: 'Manual' } as const;

/** 케이스 편집 폼 (F-QD-04). 저장은 낙관적 잠금 (F-QD-09). */
export function CaseEditForm({
  doc,
  c,
  prepFlows,
  onDone,
}: {
  doc: QADocument;
  c: TestCase;
  prepFlows: PrepFlow[];
  onDone: () => void;
}) {
  const update = useUpdateCase(doc.id);
  /** 편집을 시작한 기준 본문과 rev. 충돌 후 "다시 적용"하면 최신으로 바뀐다. */
  const [base, setBase] = useState(() => ({ body: toBody(c), rev: c.rev }));
  const [draft, setDraft] = useState<CaseBody>(() => toBody(c));
  const [conflict, setConflict] = useState<TestCase | null>(null);
  const [rebased, setRebased] = useState<Rebase | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const dirty = isDirty(base.body, draft);
  const prepName = useMemo(() => {
    const byId = new Map(prepFlows.map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [prepFlows]);
  const conflictDiff = useMemo(
    () => (conflict ? diffCase(toBody(conflict), cleanBody(draft), prepName) : []),
    [conflict, draft, prepName],
  );
  /** 저장 전에 서버에 더 새로운 rev가 보이면(다른 사람이 저장) 미리 알린다 */
  const staleNotice = !conflict && c.rev > base.rev;

  const patch = (p: Partial<CaseBody>) => setDraft((d) => ({ ...d, ...p }));
  const setPoint = (i: number, p: Partial<VerificationPoint>) =>
    patch({ verificationPoints: draft.verificationPoints.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const save = () => {
    const body = cleanBody(draft);
    const errs = validateBody(body);
    setErrors(errs);
    if (errs.length) return;
    update.mutate(
      { tcId: c.tcId, body, expectedRev: base.rev },
      {
        onSuccess: () => onDone(),
        onError: (e) => {
          if (e instanceof ConflictError) setConflict(e.latest);
        },
      },
    );
  };

  const reapply = () => {
    if (!conflict) return;
    const latest = toBody(conflict);
    const r = rebaseDraft(base.body, draft, latest);
    setBase({ body: latest, rev: conflict.rev });
    setDraft(r.body);
    setRebased(r);
    setConflict(null);
    update.reset();
  };
  const discard = () => {
    const latest = conflict ?? c;
    setBase({ body: toBody(latest), rev: latest.rev });
    setDraft(toBody(latest));
    setConflict(null);
    setRebased(null);
    update.reset();
  };

  return (
    <form
      className="qd-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      aria-label={`${c.tcId} 편집`}
    >
      {conflict && (
        <SectionMessage
          variant="negative"
          description={
            <span className="qd-stack" style={{ gap: token('space-8') }}>
              <span>
                {conflict.updatedBy ?? '다른 사용자'}님이{' '}
                {conflict.updatedAt ? <span className="qd-num">{fmtDateTime(conflict.updatedAt)}</span> : '먼저'}에
                저장했습니다 (rev {base.rev} → {conflict.rev}). 내 편집은 아직 저장되지 않았습니다. 아래는 최신 내용과
                내 편집의 차이입니다.
              </span>
              <CaseDiff diffs={conflictDiff} labels={{ del: '최신', add: '내 편집' }} />
              <span className="qd-row">
                <Button size="small" variant="outlined" color="primary" type="button" onClick={reapply}>
                  최신 내용에 내 편집 다시 적용
                </Button>
                <Button size="small" variant="outlined" color="assistive" type="button" onClick={discard}>
                  내 편집 버리고 최신 내용 보기
                </Button>
              </span>
            </span>
          }
        >
          다른 사람이 먼저 저장했습니다
        </SectionMessage>
      )}
      {rebased && !conflict && (
        <SectionMessage
          variant={rebased.conflicts.length ? 'cautionary' : 'info'}
          closeButton
          onOpenChange={(open) => !open && setRebased(null)}
          description={
            rebased.conflicts.length
              ? `최신 내용(rev ${base.rev}) 위에 내 변경을 다시 적용했습니다. ${rebased.conflicts.map((k) => BODY_LABEL[k]).join(', ')}은(는) 상대도 바꾼 필드라 내 값으로 덮었습니다. 확인 후 저장하세요.`
              : `최신 내용(rev ${base.rev}) 위에 내 변경(${rebased.mine.map((k) => BODY_LABEL[k]).join(', ') || '없음'})을 다시 적용했습니다. 확인 후 저장하세요.`
          }
        >
          내 편집을 다시 적용했습니다
        </SectionMessage>
      )}
      {staleNotice && (
        <SectionMessage
          variant="info"
          description={`편집하는 동안 ${c.updatedBy ?? '다른 사용자'}님이 저장해 rev ${c.rev}가 되었습니다. 저장하면 충돌을 확인합니다.`}
        >
          더 새로운 버전이 있습니다
        </SectionMessage>
      )}
      {c.approval.status === 'approved' && (
        <SectionMessage variant="cautionary" description="내용을 바꿔 저장하면 승인이 해제되어 다시 승인해야 합니다.">
          승인된 케이스입니다
        </SectionMessage>
      )}

      <Field label="제목">
        <TextField aria-label="제목" value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
      </Field>

      <Field label="사전 조건">
        <div className="qd-stack" style={{ gap: token('space-8') }}>
          {draft.preconditions.map((p, i) => (
            <div key={i} className="qd-edit-line">
              <div className="qd-grow">
                <TextField
                  aria-label={`사전 조건 ${i + 1}`}
                  value={p}
                  onChange={(e) =>
                    patch({ preconditions: draft.preconditions.map((x, j) => (j === i ? e.target.value : x)) })
                  }
                />
              </div>
              <IconButton
                type="button"
                aria-label={`사전 조건 ${i + 1} 삭제`}
                onClick={() => patch({ preconditions: draft.preconditions.filter((_, j) => j !== i) })}
              >
                <Icons.IconTrash />
              </IconButton>
            </div>
          ))}
          <div>
            <TextButton
              size="small"
              type="button"
              leadingContent={<Icons.IconPlus />}
              onClick={() => patch({ preconditions: [...draft.preconditions, ''] })}
            >
              사전 조건 추가
            </TextButton>
          </div>
        </div>
      </Field>

      <Field label="준비 플로우" hint="Agent가 실행 전에 확인 조건을 보고, 충족되지 않으면 순서대로 수행합니다.">
        <div className="qd-stack" style={{ gap: token('space-6') }}>
          {prepFlows.map((pf) => {
            const on = draft.prepFlowIds.includes(pf.id);
            return (
              <label
                key={pf.id}
                className={`${textClass('label1')} qd-check`}
                style={{ alignItems: 'flex-start', whiteSpace: 'normal' }}
              >
                <Checkbox
                  size="small"
                  checked={on}
                  onCheckedChange={(v) =>
                    patch({
                      // 준비 플로우 목록 순서(수행 순서)를 유지한다
                      prepFlowIds: prepFlows
                        .map((x) => x.id)
                        .filter((id) => (id === pf.id ? v : draft.prepFlowIds.includes(id))),
                    })
                  }
                />
                <span style={{ paddingTop: 2 }}>
                  {pf.name}
                  <span className={`${textClass('caption1')} qd-faint`} style={{ display: 'block' }}>
                    확인: {pf.check}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Field>

      <label className={`${textClass('label1')} qd-check`}>
        <Checkbox size="small" checked={draft.cleanState} onCheckedChange={(v) => patch({ cleanState: v })} />
        클린 상태 필요 (시작 전 앱 데이터 초기화)
      </label>

      <div className="qd-form-grid">
        <Field label="테스트 데이터">
          <TextField
            aria-label="테스트 데이터"
            value={draft.data ?? ''}
            onChange={(e) => patch({ data: e.target.value })}
            placeholder="예: 닉네임 `콩콩이`"
          />
        </Field>
        <Field label="필요 계정 역할">
          <TextField
            aria-label="필요 계정 역할"
            value={draft.accountRole ?? ''}
            onChange={(e) => patch({ accountRole: e.target.value })}
            placeholder="로그인이 없는 앱은 비워 둡니다"
          />
        </Field>
      </div>

      <Field label={`단계 ${draft.steps.length}`}>
        <div className="qd-stack" style={{ gap: token('space-8') }}>
          {draft.steps.map((s, i) => (
            <div key={i} className="qd-edit-item">
              <div className="qd-edit-line">
                <span className={`${textClass('label2', 'medium')} qc-mono qd-faint`}>{i + 1}</span>
                <label className={`${textClass('label2')} qd-check`} style={{ marginLeft: 'auto' }}>
                  <Checkbox
                    size="small"
                    checked={s.manual}
                    onCheckedChange={(v) =>
                      patch({ steps: draft.steps.map((x, j) => (j === i ? { ...x, manual: v } : x)) })
                    }
                  />
                  수동
                </label>
                <IconButton
                  type="button"
                  aria-label={`단계 ${i + 1} 삭제`}
                  onClick={() => patch({ steps: draft.steps.filter((_, j) => j !== i) })}
                >
                  <Icons.IconTrash />
                </IconButton>
              </div>
              <TextArea
                width="100%"
                aria-label={`단계 ${i + 1}`}
                minRows={1}
                maxRows={6}
                value={s.text}
                onChange={(e) =>
                  patch({ steps: draft.steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })
                }
              />
            </div>
          ))}
          <div>
            <TextButton
              size="small"
              type="button"
              leadingContent={<Icons.IconPlus />}
              onClick={() => patch({ steps: [...draft.steps, { text: '', manual: false }] })}
            >
              단계 추가
            </TextButton>
          </div>
        </div>
      </Field>

      <Field label={`검증 포인트 ${draft.verificationPoints.length}`}>
        <div className="qd-stack" style={{ gap: token('space-8') }}>
          {draft.verificationPoints.map((p, i) => (
            <div key={p.id} className="qd-edit-item">
              <div className="qd-edit-line">
                <span className={`${textClass('caption1')} qc-mono qd-faint`}>{p.id.replace(`${c.tcId}-`, '')}</span>
                <div className="qd-grow">
                  <TextField
                    aria-label={`검증 포인트 ${i + 1} 대상`}
                    placeholder="대상 (예: 첫 습관 만들기 스텝)"
                    value={p.target}
                    onChange={(e) => setPoint(i, { target: e.target.value })}
                  />
                </div>
                <IconButton
                  type="button"
                  aria-label={`검증 포인트 ${i + 1} 삭제`}
                  onClick={() => patch({ verificationPoints: draft.verificationPoints.filter((_, j) => j !== i) })}
                >
                  <Icons.IconTrash />
                </IconButton>
              </div>
              <div className="qd-form-grid">
                <Select
                  aria-label={`검증 포인트 ${i + 1} 비교 종류`}
                  value={p.compare}
                  onChange={(v) => setPoint(i, { compare: v as PointCompare })}
                >
                  {(Object.keys(POINT_COMPARE_LABEL) as PointCompare[]).map((k) => (
                    <Option key={k} value={k}>
                      {POINT_COMPARE_LABEL[k]}
                    </Option>
                  ))}
                </Select>
                <SegmentedControl
                  size="medium"
                  value={p.method}
                  onValueChange={(v) => setPoint(i, { method: v as PointMethod })}
                  name={`method-${p.id}`}
                >
                  {(Object.keys(POINT_METHOD_LABEL) as PointMethod[]).map((k) => (
                    <SegmentedControlItem key={k} value={k}>
                      {k === 'tree' ? '트리' : POINT_METHOD_LABEL[k]}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </div>
              <TextArea
                width="100%"
                aria-label={`검증 포인트 ${i + 1} 기대값`}
                placeholder="기대값"
                minRows={1}
                maxRows={6}
                value={p.expected}
                onChange={(e) => setPoint(i, { expected: e.target.value })}
              />
            </div>
          ))}
          <div>
            <TextButton
              size="small"
              type="button"
              leadingContent={<Icons.IconPlus />}
              onClick={() =>
                patch({
                  verificationPoints: [
                    ...draft.verificationPoints,
                    { id: nextPointId(c.tcId, draft), target: '', compare: 'visible', expected: '', method: 'tree' },
                  ],
                })
              }
            >
              검증 포인트 추가
            </TextButton>
          </div>
        </div>
      </Field>

      <div className="qd-form-grid">
        <EnumSelect
          label="우선순위"
          value={draft.priority}
          options={PRIORITY_LABEL}
          onChange={(v) => patch({ priority: v })}
        />
        <EnumSelect label="유형" value={draft.type} options={TEST_TYPE_LABEL} onChange={(v) => patch({ type: v })} />
        <EnumSelect
          label="플랫폼"
          value={draft.platform}
          options={PLATFORM_LABEL}
          onChange={(v) => patch({ platform: v })}
          disabled={(v) => v === 'ios'}
        />
        <EnumSelect label="수행 방식" value={draft.mode} options={MODE_LABEL} onChange={(v) => patch({ mode: v })} />
      </div>

      {errors.length > 0 && (
        <SectionMessage variant="negative" description={errors.join(' ')}>
          저장할 수 없습니다
        </SectionMessage>
      )}
      {update.isError && !conflict && (
        <SectionMessage variant="negative" description={update.error.message}>
          저장하지 못했습니다
        </SectionMessage>
      )}

      <div className="qd-form-actions">
        <span className={`${textClass('label2')} qd-faint`} style={{ marginRight: 'auto', alignSelf: 'center' }}>
          rev <span className="qc-mono">{base.rev}</span> 기준 편집{dirty ? ' · 저장 안 됨' : ''}
        </span>
        <Button size="small" variant="outlined" color="assistive" type="button" onClick={onDone}>
          취소
        </Button>
        <Button
          size="small"
          variant="solid"
          color="primary"
          type="submit"
          loading={update.isPending}
          disabled={!dirty || !!conflict}
        >
          저장
        </Button>
      </div>
    </form>
  );
}
