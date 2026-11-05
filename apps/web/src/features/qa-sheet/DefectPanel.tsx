// 결함: 판정 추적 뷰에서 Fail 칸의 결함을 등록하고, 연결된 결함을 보인다.
// 폼은 케이스·칸 내용으로 미리 채운다(defectDraft). 번호(D-1)는 사이클 안에서 매기고, 저장하면 칸의 결함 ID로 연결된다.
import { defectDraft } from '@qcard/data';
import { SEVERITY_LABEL, Severity, type CaseResult, type TestCase } from '@qcard/shared';
import {
  Button,
  ContentBadge,
  SectionMessage,
  SegmentedControl,
  SegmentedControlItem,
  TextArea,
  TextField,
  textClass,
  token,
} from '@qcard/ui';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { CycleDetail, DefectDraft } from '../../data/api';
import { useCreateDefect, useMyRole } from '../../data/hooks';
import { fmtDateTime } from '../../components/format';
import { IssueCell } from '../issues/IssueCell';
import { Card, KV, Mono } from './parts';
import { DEFECT_STATUS_LABEL } from './SummaryTab';

export function DefectPanel({
  d,
  r,
  tc,
  projectId,
}: {
  d: CycleDetail;
  r: CaseResult;
  tc: TestCase;
  projectId: string;
}) {
  const role = useMyRole(projectId);
  const canEdit = role.data === 'admin' || role.data === 'qa';
  const [form, setForm] = useState<DefectDraft | null>(null);
  const listUrl = `/p/${projectId}/cycles/${d.cycle.id}?tab=defects`;

  if (r.defectId) {
    const df = d.defects.find((x) => x.id === r.defectId);
    return (
      <Card
        title={
          <span className="qs-row" style={{ gap: token('space-8') }}>
            결함 <Mono>{r.defectId}</Mono>
          </span>
        }
        actions={
          df && (
            <span className="qs-row" style={{ gap: token('space-4') }}>
              <ContentBadge color="neutral" size="small" variant="outlined">
                {SEVERITY_LABEL[df.severity]}
              </ContentBadge>
              <ContentBadge color="neutral" size="small" variant="outlined">
                {DEFECT_STATUS_LABEL[df.status]}
              </ContentBadge>
            </span>
          )
        }
      >
        {df && <span className={textClass('label1', 'medium')}>{df.title}</span>}
        {df?.createdBy && (
          <span className={`${textClass('caption1')} qs-muted`}>
            {df.createdBy}
            {df.createdAt ? ` · ${fmtDateTime(df.createdAt)}` : ''} 등록
          </span>
        )}
        {df && (
          <IssueCell projectId={projectId} cycle={d.cycle} defect={df} cases={d.cases} canEdit={canEdit} />
        )}
        <Link to={listUrl} className={`qs-link ${textClass('label2', 'medium')}`}>
          ③ 결함 목록에서 보기
        </Link>
      </Card>
    );
  }

  if (r.verdict !== 'fail') return null;
  if (form && canEdit) return <DefectForm d={d} r={r} draft={form} onClose={() => setForm(null)} />;
  return (
    <Card title="결함">
      <span className={`${textClass('label1')} qs-muted`}>
        이 Fail 칸에 연결된 결함이 없습니다.
        {canEdit && ' 케이스·결과 내용으로 미리 채운 결함을 만들어 이 칸과 ③ 결함 목록에 연결합니다.'}
      </span>
      {canEdit && (
        <div>
          <Button size="small" variant="solid" color="primary" onClick={() => setForm(defectDraft(tc, r))}>
            결함 등록
          </Button>
        </div>
      )}
    </Card>
  );
}

function DefectForm({
  d,
  r,
  draft,
  onClose,
}: {
  d: CycleDetail;
  r: CaseResult;
  draft: DefectDraft;
  onClose: () => void;
}) {
  const id = useId();
  const create = useCreateDefect();
  const [title, setTitle] = useState(draft.title);
  const [severity, setSeverity] = useState(draft.severity);
  const [repro, setRepro] = useState(draft.repro.join('\n'));
  const [expected, setExpected] = useState(draft.expected);
  const [actual, setActual] = useState(draft.actual);
  const device = d.cycle.targets.find((t) => t.id === r.deviceId);
  const next = `D-${(d.cycle.defectSeq ?? 0) + 1}`;
  const steps = repro.split('\n').filter((s) => s.trim());
  const canSubmit = title.trim().length > 0 && steps.length > 0 && !create.isPending;
  const label = (htmlFor: string, text: string, hint?: string) => (
    <label htmlFor={htmlFor} className={`${textClass('label2', 'medium')} qs-faint`}>
      {text}
      {hint && <span className={`${textClass('caption1')} qs-faint`}> · {hint}</span>}
    </label>
  );

  return (
    <Card title="결함 등록" actions={<span className={`${textClass('caption1')} qs-muted`}>저장하면 {next}</span>}>
      <form
        className="qs-stack"
        style={{ gap: token('space-12') }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          create.mutate(
            {
              projectId: d.cycle.projectId,
              cycleId: d.cycle.id,
              tcId: r.tcId,
              deviceId: r.deviceId,
              title,
              severity,
              repro: steps,
              expected,
              actual,
            },
            { onSuccess: onClose },
          );
        }}
      >
        <div className="qs-stack" style={{ gap: token('space-6') }}>
          {label(`${id}-title`, '제목')}
          <TextField id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="qs-stack" style={{ gap: token('space-6') }}>
          <span id={`${id}-sev`} className={`${textClass('label2', 'medium')} qs-faint`}>
            심각도
          </span>
          <div role="group" aria-labelledby={`${id}-sev`} className="qs-scroll-x">
            <SegmentedControl
              size="small"
              value={severity}
              onValueChange={(v) => setSeverity(v as Severity)}
              name={`${id}-severity`}
            >
              {Severity.options.map((s) => (
                <SegmentedControlItem key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
        </div>
        <div className="qs-stack" style={{ gap: token('space-6') }}>
          {label(`${id}-repro`, '재현 절차', '한 줄에 한 단계')}
          <TextArea
            id={`${id}-repro`}
            value={repro}
            onChange={(e) => setRepro(e.target.value)}
            minRows={3}
            maxRows={8}
            size="medium"
            width="100%"
          />
        </div>
        <div className="qs-stack" style={{ gap: token('space-6') }}>
          {label(`${id}-expected`, '기대 결과')}
          <TextArea
            id={`${id}-expected`}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            minRows={2}
            maxRows={5}
            size="medium"
            width="100%"
          />
        </div>
        <div className="qs-stack" style={{ gap: token('space-6') }}>
          {label(`${id}-actual`, '실제 결과')}
          <TextArea
            id={`${id}-actual`}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            minRows={2}
            maxRows={5}
            size="medium"
            width="100%"
          />
        </div>
        <KV
          items={[
            ['관련 TC', <Mono>{r.tcId}</Mono>],
            ['디바이스 / OS', `${device?.label ?? r.deviceId}${r.osBuild ? ` · ${r.osBuild}` : ''}`],
            ['빌드', `${d.build.version} (${d.build.buildNumber})`],
            ['증거', '이 판정 추적 뷰 링크'],
          ]}
        />
        {create.error && (
          <SectionMessage variant="negative" description={create.error.message}>
            결함을 등록하지 못했습니다
          </SectionMessage>
        )}
        <div className="qs-row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" size="small" variant="outlined" color="assistive" onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            size="small"
            variant="solid"
            color="primary"
            disabled={!canSubmit}
            loading={create.isPending}
          >
            결함 등록
          </Button>
        </div>
      </form>
    </Card>
  );
}
