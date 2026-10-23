// 판정 확정 패널 (F-RP-04): Fail·Blocked·확인필요는 사람이 확정, 자동 확정 Pass는 오버라이드.
// 수동 케이스는 여기서 결과를 입력한다 (F-RP-05). 판정자는 로그인 사용자로 기록된다.
import { VERDICT_LABEL, type CaseResult, type Verdict } from '@qcard/shared';
import { Button, SectionMessage, SegmentedControl, SegmentedControlItem, TextArea, textClass, token } from '@qcard/ui';
import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useApi, useConfirmVerdict } from '../../data/hooks';
import { Card } from './parts';

const CHOICES: Verdict[] = ['pass', 'fail', 'blocked', 'na'];

/** 칸이 바뀌었는지 알아보는 값: 판정·이력·시도 횟수 (실시간 구독으로 다른 사람의 변경이 들어온다) */
const stamp = (r: CaseResult) => `${r.verdict}|${r.history.length}|${r.attempts}`;

export function ConfirmPanel({ cycleId, result, manual }: { cycleId: string; result: CaseResult; manual: boolean }) {
  const api = useApi();
  const confirm = useConfirmVerdict();
  const { projectId = '' } = useParams();
  const id = useId();
  const needsHuman = result.verdict === 'fail' || result.verdict === 'blocked' || result.verdict === 'check';
  const overridable = result.verdict === 'pass' || result.verdict === 'na';
  const [open, setOpen] = useState(needsHuman || (manual && result.verdict === 'nt'));
  const [verdict, setVerdict] = useState<Verdict | ''>(CHOICES.includes(result.verdict) ? result.verdict : '');
  const [actual, setActual] = useState(result.actualSummary ?? '');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<Verdict | null>(null);
  // 패널을 연 뒤(또는 내가 확정한 뒤) 다른 사람이 이 칸을 바꿨으면 알린다
  // ?demo=changed: 다른 사람이 바꾼 상태를 고정해 본다 (ui:snap)
  const [params] = useSearchParams();
  const [seen, setSeen] = useState(() => (params.get('demo') === 'changed' ? '' : stamp(result)));
  const changedByOther = open && stamp(result) !== seen && !confirm.isPending;
  const takeLatest = () => {
    setSeen(stamp(result));
    setVerdict(CHOICES.includes(result.verdict) ? result.verdict : '');
    setActual(result.actualSummary ?? '');
    setDone(null);
  };

  if (result.verdict === 'nt' && !manual) return null;

  const title = manual ? '수동 결과 입력' : overridable ? '판정 오버라이드' : '판정 확정';
  const needActual = verdict === 'fail' || verdict === 'blocked';
  const canSubmit = verdict !== '' && (!needActual || actual.trim().length > 0) && !confirm.isPending;

  const submit = () => {
    if (verdict === '') return;
    confirm.mutate(
      {
        projectId,
        cycleId,
        tcId: result.tcId,
        deviceId: result.deviceId,
        verdict,
        note: note.trim() || undefined,
        actualSummary: actual.trim() || undefined,
      },
      {
        onSuccess: (saved) => {
          setSeen(stamp(saved));
          setDone(verdict);
          setNote('');
          if (!needsHuman) setOpen(false);
        },
      },
    );
  };

  return (
    <Card title={title}>
      {done && (
        <SectionMessage variant="positive" description={`${api.currentUser} 이름으로 기록했습니다.`}>
          {VERDICT_LABEL[done]}(으)로 확정했습니다
        </SectionMessage>
      )}
      {changedByOther && (
        <SectionMessage
          variant="cautionary"
          description={`지금 판정: ${VERDICT_LABEL[result.verdict]}. 이대로 확정하면 그 판정을 덮어씁니다.`}
          bottomButton={
            <Button size="small" variant="outlined" color="assistive" onClick={takeLatest}>
              최신 내용으로
            </Button>
          }
        >
          다른 사람이 방금 이 칸을 바꿨습니다
        </SectionMessage>
      )}
      {confirm.isError && (
        <SectionMessage variant="negative" description={String(confirm.error.message)}>
          저장하지 못했습니다
        </SectionMessage>
      )}
      {!open ? (
        <>
          <span className={`${textClass('label2')} qs-muted`}>
            {result.autoConfirmed
              ? 'Agent가 자동 확정한 Pass입니다. 틀렸다면 오버라이드하세요 — 자동 Pass 반전으로 집계됩니다.'
              : '확정된 판정입니다. 바꾸려면 오버라이드하세요.'}
          </span>
          <div>
            <Button size="small" variant="outlined" color="assistive" onClick={() => setOpen(true)}>
              판정 바꾸기
            </Button>
          </div>
        </>
      ) : (
        <form
          className="qs-stack"
          style={{ gap: token('space-12') }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {result.verdict === 'check' && (
            <span className={`${textClass('label2')} qs-muted`}>
              Agent가 확정하지 못했습니다. 스텝 타임라인과 검증 포인트 증거를 보고 판정하세요.
            </span>
          )}
          <div className="qs-stack" style={{ gap: token('space-6') }}>
            <span id={`${id}-v`} className={`${textClass('label2', 'medium')} qs-faint`}>
              판정
            </span>
            <div role="group" aria-labelledby={`${id}-v`} className="qs-scroll-x">
              <SegmentedControl
                size="small"
                value={verdict}
                onValueChange={(v) => setVerdict(v as Verdict)}
                name={`${id}-verdict`}
              >
                {CHOICES.map((v) => (
                  <SegmentedControlItem key={v} value={v}>
                    {VERDICT_LABEL[v]}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
          </div>
          <div className="qs-stack" style={{ gap: token('space-6') }}>
            <label htmlFor={`${id}-actual`} className={`${textClass('label2', 'medium')} qs-faint`}>
              실제 결과 한 줄 요약{needActual ? ' (필수)' : ''}
            </label>
            <TextArea
              id={`${id}-actual`}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              minRows={2}
              maxRows={5}
              maxLength={200}
              size="medium"
              width="100%"
              placeholder="QA 시트 Fail·확인필요 셀에 보이는 문장"
            />
          </div>
          <div className="qs-stack" style={{ gap: token('space-6') }}>
            <label htmlFor={`${id}-note`} className={`${textClass('label2', 'medium')} qs-faint`}>
              메모 (판정 이력에 남음)
            </label>
            <TextArea
              id={`${id}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minRows={2}
              maxRows={5}
              size="medium"
              width="100%"
              placeholder="판정 근거"
            />
          </div>
          {manual && (
            <span className={`${textClass('caption1')} qs-faint`}>스크린샷 첨부는 저장소 연결 후 지원합니다.</span>
          )}
          <div className="qs-row" style={{ justifyContent: 'space-between' }}>
            <span className={`${textClass('caption1')} qs-muted`}>판정자 {api.currentUser} · 시각은 서버 기준</span>
            <span className="qs-row">
              {!needsHuman && !(manual && result.verdict === 'nt') && (
                <Button type="button" size="small" variant="outlined" color="assistive" onClick={() => setOpen(false)}>
                  취소
                </Button>
              )}
              <Button
                type="submit"
                size="small"
                variant="solid"
                color="primary"
                disabled={!canSubmit}
                loading={confirm.isPending}
              >
                {manual && result.verdict === 'nt' ? '결과 저장' : '판정 확정'}
              </Button>
            </span>
          </div>
        </form>
      )}
    </Card>
  );
}
