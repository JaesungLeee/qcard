import { Button, TextField, textClass } from '@qcard/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useCreateProject } from '../../data/hooks';
import { PlainShell } from '../../shell/PlainShell';
import { DataNotice, ErrorMessage, Field } from './parts';
import './projects.css';

/** 새 프로젝트: 누구나 만들 수 있고 만든 사람이 Admin. 만들면 멤버를 초대하러 설정으로 간다 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const create = useCreateProject();
  const [form, setForm] = useState({ name: '', appName: '', packageName: '', dataNoticeAck: false });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const ready = form.name.trim() && form.appName.trim() && form.packageName.trim() && form.dataNoticeAck;
  return (
    <PlainShell>
      <PageHeader
        title="새 프로젝트"
        crumbs={[{ label: '내 프로젝트', to: '/projects' }, { label: '새 프로젝트' }]}
        meta="앱 하나에 QA 대시보드 하나를 만듭니다. 만든 사람이 Admin이 되고, 다음 화면에서 멤버를 초대합니다."
      />
      <form
        className="qp-card qp-form-col"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form, { onSuccess: (p) => void navigate(`/p/${p.id}/settings`) });
        }}
      >
        <Field label="프로젝트 이름" hint="대시보드와 사이드바에 보이는 이름입니다.">
          <TextField value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 하루콩" />
        </Field>
        <Field label="앱 이름">
          <TextField value={form.appName} onChange={(e) => set({ appName: e.target.value })} placeholder="예: 하루콩" />
        </Field>
        <Field label="패키지명" hint="실행할 Android 앱의 applicationId입니다. 앱 데이터 초기화는 이 앱에만 합니다.">
          <TextField
            value={form.packageName}
            onChange={(e) => set({ packageName: e.target.value })}
            placeholder="com.example.app"
          />
        </Field>
        <DataNotice checked={form.dataNoticeAck} onChange={(v) => set({ dataNoticeAck: v })} />
        <ErrorMessage error={create.error} title="만들 수 없습니다" />
        <div className="qp-row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="outlined" color="assistive" onClick={() => void navigate('/projects')}>
            취소
          </Button>
          <Button type="submit" variant="solid" color="primary" disabled={!ready || create.isPending}>
            <span className={textClass('label1', 'bold')}>프로젝트 만들기</span>
          </Button>
        </div>
      </form>
    </PlainShell>
  );
}
