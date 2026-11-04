// 사이클 만들기: QA 문서 버전 + 빌드(APK) + 대상 디바이스(모델 + OS 메이저).
import { HOST_ONLINE_MS, type Build, type TestCycle } from '@qcard/shared';
import {
  Button,
  Chip,
  Icons,
  Option,
  Select,
  SectionMessage,
  TextButton,
  TextField,
  textClass,
  token,
} from '@qcard/ui';
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { fmtDateTime } from '../../components/format';
import {
  useBuilds,
  useCreateCycle,
  useMyHosts,
  useMyRole,
  useProject,
  useQaDoc,
  useQaDocs,
  useUploadBuild,
} from '../../data/hooks';
import { KV, Mono, SERVER_ENV_LABEL } from './parts';
import './qa-sheet.css';

type Target = { model: string; osMajor: number; resolution?: string };
const keyOf = (t: Target) => `${t.model}|${t.osMajor}`;

export function NewCyclePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const role = useMyRole(projectId);
  const project = useProject(projectId);
  const docs = useQaDocs(projectId);
  const builds = useBuilds(projectId);
  const hosts = useMyHosts();
  const create = useCreateCycle(projectId);

  const latestDocs = useMemo(
    () => [...(docs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [docs.data],
  );
  const [docChoice, setDocChoice] = useState<string>();
  const docId = docChoice ?? latestDocs[0]?.id ?? '';
  const doc = useQaDoc(projectId, docId);
  const [buildChoice, setBuildChoice] = useState<string>();
  const buildId = buildChoice ?? builds.data?.[0]?.id ?? '';
  const build = builds.data?.find((b) => b.id === buildId);
  const [targets, setTargets] = useState<Target[]>([]);
  const [serverEnv, setServerEnv] = useState<TestCycle['serverEnv']>('stage');
  const [name, setName] = useState<string>();

  const approved = (doc.data?.cases ?? []).filter((c) => c.change !== 'removed' && c.approval.status === 'approved');
  const notApproved = (doc.data?.cases ?? []).filter((c) => c.change !== 'removed').length - approved.length;
  const suggestedName = doc.data && build ? `${doc.data.appVersion} (${build.buildNumber}) 회귀` : '';
  const cycleName = name ?? suggestedName;
  const canEdit = role.data === 'admin' || role.data === 'qa';
  const ready = canEdit && cycleName.trim() && docId && buildId && targets.length > 0 && approved.length > 0;

  // 내 호스트에 지금 연결된 디바이스 → 대상 후보
  const connected = (hosts.data ?? [])
    .filter((h) => Date.now() - Date.parse(h.lastSeen) < HOST_ONLINE_MS)
    .flatMap((h) => h.devices ?? []);
  const toggle = (t: Target) =>
    setTargets((ts) => (ts.some((x) => keyOf(x) === keyOf(t)) ? ts.filter((x) => keyOf(x) !== keyOf(t)) : [...ts, t]));

  return (
    <div className="qc-page">
      <PageHeader
        title="사이클 만들기"
        crumbs={[{ label: '테스트 사이클', to: `/p/${projectId}/cycles` }, { label: '만들기' }]}
        meta="QA 문서의 승인된 케이스를 고정하고, 빌드와 대상 디바이스를 정합니다. 실행자는 각자의 디바이스로 남은 칸을 채웁니다."
      />
      {role.data === 'viewer' && (
        <SectionMessage variant="info" description="사이클은 Admin·QA만 만들 수 있습니다.">
          Viewer는 조회만 할 수 있습니다
        </SectionMessage>
      )}

      <section className="qc-card qs-stack" style={{ gap: token('space-12') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          1. QA 문서
        </h2>
        <Select aria-label="QA 문서" value={docId} onChange={(v) => setDocChoice(String(v))}>
          {latestDocs.map((d) => (
            <Option key={d.id} value={d.id}>
              QA 문서 {d.appVersion} · {fmtDateTime(d.createdAt)}
            </Option>
          ))}
        </Select>
        {doc.data &&
          (approved.length === 0 ? (
            <SectionMessage
              variant="cautionary"
              description="QA 문서에서 케이스를 승인한 뒤 사이클을 만드세요. 승인된 케이스만 실행됩니다."
            >
              승인된 케이스가 없습니다
            </SectionMessage>
          ) : (
            <span className={`${textClass('label2')} qs-muted`}>
              승인된 케이스 <span className="qd-num">{approved.length}</span>개를 고정합니다
              {notApproved > 0 &&
                ` · 미승인·보류 ${notApproved}개는 빠집니다 (나중에 승인해도 이 사이클에는 들어오지 않습니다)`}
            </span>
          ))}
      </section>

      <section className="qc-card qs-stack" style={{ gap: token('space-12') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          2. 빌드
        </h2>
        {builds.data && builds.data.length > 0 && (
          <Select aria-label="빌드" value={buildId} onChange={(v) => setBuildChoice(String(v))}>
            {builds.data.map((b) => (
              <Option key={b.id} value={b.id}>
                {b.version} ({b.buildNumber}) · {b.packageName} · {fmtDateTime(b.uploadedAt)}
              </Option>
            ))}
          </Select>
        )}
        {build && <BuildFacts build={build} projectPackage={project.data?.packageName} />}
        <BuildUpload projectId={projectId} disabled={!canEdit} onUploaded={(b) => setBuildChoice(b.id)} />
      </section>

      <section className="qc-card qs-stack" style={{ gap: token('space-12') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          3. 대상 디바이스
        </h2>
        <span className={`${textClass('label2')} qs-muted`}>
          모델과 OS 메이저 버전이 같으면 같은 대상으로 봅니다. 정확한 OS 빌드·보안 패치는 결과에 기록됩니다.
        </span>
        {connected.length > 0 && (
          <div className="qs-row" style={{ gap: token('space-8') }}>
            <span className={`${textClass('label2', 'medium')} qs-faint`}>내 호스트에 연결됨</span>
            {connected.map((d) => {
              const t = { model: d.model, osMajor: d.osMajor, resolution: d.resolution };
              return (
                <Chip key={d.serial} size="small" variant="outlined" active={targets.some((x) => keyOf(x) === keyOf(t))} onClick={() => toggle(t)}>
                  {d.model} · Android {d.osMajor}
                </Chip>
              );
            })}
          </div>
        )}
        <ManualTarget onAdd={(t) => !targets.some((x) => keyOf(x) === keyOf(t)) && setTargets((ts) => [...ts, t])} />
        {targets.length > 0 && (
          <ul className="qs-list" aria-label="대상 디바이스" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {targets.map((t) => (
              <li key={keyOf(t)} className="qs-row" style={{ justifyContent: 'space-between' }}>
                <span className={textClass('label1', 'medium')}>
                  {t.model} (Android {t.osMajor}){t.resolution && <span className="qs-faint"> · {t.resolution}</span>}
                </span>
                <TextButton size="small" color="assistive" onClick={() => toggle(t)} aria-label={`${t.model} 빼기`}>
                  빼기
                </TextButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="qc-card qs-stack" style={{ gap: token('space-12') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          4. 이름 · 서버 환경
        </h2>
        <div className="qs-form-grid">
          <label className="qs-field">
            <span className={`${textClass('label2', 'medium')} qs-faint`}>사이클 이름</span>
            <TextField
              value={cycleName}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 1.4.0 (140) 1차 회귀"
            />
          </label>
          <label className="qs-field">
            <span className={`${textClass('label2', 'medium')} qs-faint`}>서버 환경</span>
            <Select
              aria-label="서버 환경"
              value={serverEnv}
              onChange={(v) => setServerEnv(v as TestCycle['serverEnv'])}
            >
              {(['dev', 'stage', 'prod'] as const).map((e) => (
                <Option key={e} value={e}>
                  {SERVER_ENV_LABEL[e]}
                </Option>
              ))}
            </Select>
          </label>
        </div>
        {create.error && (
          <SectionMessage variant="negative" description={(create.error as Error).message}>
            만들 수 없습니다
          </SectionMessage>
        )}
        <div className="qs-row" style={{ justifyContent: 'space-between' }}>
          <span className={`${textClass('label2')} qs-muted`}>
            {targets.length > 0 && approved.length > 0
              ? `케이스 ${approved.length} × 대상 ${targets.length} = 칸 ${approved.length * targets.length}개`
              : ''}
          </span>
          <span className="qs-row" style={{ gap: token('space-8') }}>
            <Button variant="outlined" color="assistive" onClick={() => void navigate(`/p/${projectId}/cycles`)}>
              취소
            </Button>
            <Button
              variant="solid"
              color="primary"
              disabled={!ready || create.isPending}
              onClick={() =>
                create.mutate(
                  { name: cycleName, docId, buildId, targets, serverEnv },
                  { onSuccess: (c) => void navigate(`/p/${projectId}/cycles/${c.id}`) },
                )
              }
            >
              <span className={textClass('label1', 'bold')}>사이클 만들기</span>
            </Button>
          </span>
        </div>
      </section>
    </div>
  );
}

function BuildFacts({ build, projectPackage }: { build: Build; projectPackage?: string }) {
  const items: [ReactNode, ReactNode][] = [
    [
      '패키지',
      <>
        <Mono>{build.packageName}</Mono>
        {projectPackage && build.packageName !== projectPackage && (
          <span className="qs-faint"> · 프로젝트 패키지({projectPackage})와 다릅니다 (QA용 빌드면 괜찮습니다)</span>
        )}
      </>,
    ],
    [
      '버전',
      <>
        {build.version} ({build.buildNumber})
        {build.minSdk !== undefined && <span className="qs-faint"> · minSdk {build.minSdk}</span>}
      </>,
    ],
    [
      '서명 SHA-1',
      <>
        {/* 바이트 중간이 아니라 콜론 뒤에서만 줄을 바꾼다 */}
        <Mono className="qs-sha">
          {build.signingSha1.split(':').map((b, i) => (
            <Fragment key={i}>
              {i > 0 && ':'}
              {i > 0 && <wbr />}
              {b}
            </Fragment>
          ))}
        </Mono>
        {build.signingSchemes && <span className="qs-faint"> · {build.signingSchemes.join('·')}</span>}
      </>,
    ],
  ];
  if (build.uploadedBy) items.push(['올린 사람', `${build.uploadedBy} · ${fmtDateTime(build.uploadedAt)}`]);
  return <KV items={items} />;
}

/** APK 올리기: 서명·패키지·버전은 파일에서 읽는다 */
function BuildUpload({
  projectId,
  disabled,
  onUploaded,
}: {
  projectId: string;
  disabled: boolean;
  onUploaded: (b: Build) => void;
}) {
  const upload = useUploadBuild(projectId);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="qs-stack" style={{ gap: token('space-8') }}>
      <div className="qs-row" style={{ gap: token('space-8') }}>
        <Button
          variant="outlined"
          color="assistive"
          leadingContent={<Icons.IconUpload />}
          disabled={disabled || upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? 'APK 올리는 중…' : 'APK 올리기'}
        </Button>
        <span className={`${textClass('label2')} qs-faint`}>
          배포와 같은 키로 서명된 APK만 받습니다. qcard는 재서명하지 않고 그대로 설치합니다.
        </span>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".apk,application/vnd.android.package-archive"
        aria-label="APK 파일"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          upload.mutate(
            { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
            { onSuccess: onUploaded },
          );
        }}
      />
      {upload.error && (
        <SectionMessage variant="negative" description={(upload.error as Error).message}>
          올릴 수 없습니다
        </SectionMessage>
      )}
    </div>
  );
}

/** 직접 추가: 모델 + OS 메이저 */
function ManualTarget({ onAdd }: { onAdd: (t: Target) => void }) {
  const [model, setModel] = useState('');
  const [os, setOs] = useState('');
  const osMajor = Number(os);
  const ok = model.trim() && Number.isInteger(osMajor) && osMajor > 0;
  return (
    <div className="qs-form-grid" style={{ alignItems: 'end' }}>
      <label className="qs-field">
        <span className={`${textClass('label2', 'medium')} qs-faint`}>모델</span>
        <TextField value={model} onChange={(e) => setModel(e.target.value)} placeholder="예: SM-S711N, Pixel 8" />
      </label>
      <label className="qs-field">
        <span className={`${textClass('label2', 'medium')} qs-faint`}>OS 메이저 버전</span>
        <span className="qs-row" style={{ gap: token('space-8'), flexWrap: 'nowrap' }}>
          <TextField value={os} onChange={(e) => setOs(e.target.value.replace(/\D/g, ''))} placeholder="예: 16" />
          <Button
            variant="outlined"
            color="assistive"
            disabled={!ok}
            onClick={() => {
              onAdd({ model: model.trim(), osMajor });
              setModel('');
              setOs('');
            }}
          >
            추가
          </Button>
        </span>
      </label>
    </div>
  );
}
