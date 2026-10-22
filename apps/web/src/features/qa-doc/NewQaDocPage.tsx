import { matchVersions, readBundle, type BundleFile, type SpecBundle } from '@qcard/spec';
import {
  Button,
  Icons,
  Option,
  Select,
  SectionMessage,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TextField,
  textClass,
  token,
} from '@qcard/ui';
import { unzipSync } from 'fflate';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { useMyRole, useQaDoc, useQaDocs, useRequestQaDoc } from '../../data/hooks';
import { HostStatus } from './Jobs';
import './qa-doc.css';

/*
 * 스펙 업로드 → QA 문서 생성 요청 (PRD §5.2, F-IN-03·08, F-QD-08).
 * 폴더·ZIP을 브라우저에서 읽어 `<스펙>/spec.md`만 파싱하고, 이전 버전과의 매칭(동일·변경·신규·삭제)을
 * LLM 없이 미리 보여 준다. 요청하면 스펙 묶음을 올리고 작업을 만든다 — 생성은 내 호스트 에이전트가 한다.
 */

/** 폴더 선택: 상대 경로를 보존하고 spec.md만 내용을 읽는다 (나머지는 개수만) */
async function readFolder(files: FileList): Promise<BundleFile[]> {
  return Promise.all(
    [...files].map(async (f) => {
      const path = f.webkitRelativePath || f.name;
      return { path, content: path.endsWith('spec.md') ? await f.text() : '' };
    }),
  );
}

/** ZIP: 디렉터리 항목은 빼고, spec.md만 풀어서 읽는다 */
async function readZip(file: File): Promise<BundleFile[]> {
  const names: string[] = [];
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/')) return false;
      names.push(f.name);
      return f.name.endsWith('spec.md');
    },
  });
  const decoder = new TextDecoder();
  return names.map((path) => ({ path, content: entries[path] ? decoder.decode(entries[path]) : '' }));
}

type Picked = { label: string; files: BundleFile[]; bundle: SpecBundle };

export function NewQaDocPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const role = useMyRole(projectId);
  const docs = useQaDocs(projectId);
  const request = useRequestQaDoc(projectId);
  const [picked, setPicked] = useState<Picked>();
  const [readError, setReadError] = useState<string>();
  const [appVersion, setAppVersion] = useState('');
  const [prevChoice, setPrevChoice] = useState<string>();
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const latest = useMemo(
    () => [...(docs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [docs.data],
  );
  // 기본은 가장 최근 QA 문서와 비교한다
  const prevDocId = prevChoice ?? latest[0]?.id ?? '';
  const prev = useQaDoc(projectId, prevDocId);
  const plan = useMemo(
    () => (picked ? matchVersions(picked.bundle, prevDocId ? prev.data : undefined) : undefined),
    [picked, prevDocId, prev.data],
  );

  const pick = async (label: string, read: () => Promise<BundleFile[]>) => {
    setReadError(undefined);
    try {
      const files = await read();
      setPicked({ label, files, bundle: readBundle(files) });
    } catch (e) {
      setPicked(undefined);
      setReadError(`파일을 읽지 못했습니다: ${(e as Error).message}`);
    }
  };

  const canEdit = role.data === 'admin' || role.data === 'qa';
  const specCount = picked?.bundle.specs.length ?? 0;
  const targets = plan ? plan.counts.changed + plan.counts.new : 0;
  const ready = canEdit && specCount > 0 && appVersion.trim() && (!prevDocId || prev.data) && !request.isPending;

  return (
    <div className="qc-page">
      <PageHeader
        title="QA 문서 생성"
        crumbs={[{ label: 'QA 문서', to: `/p/${projectId}/docs` }, { label: '생성' }]}
        meta="앱 버전의 스펙 폴더 전체를 올립니다. 이전 버전과 출처 ID로 비교해 바뀐 행만 내 Claude 플랜으로 새로 만듭니다."
      />

      {role.data === 'viewer' && (
        <SectionMessage variant="info" description="QA 문서 생성은 Admin·QA만 요청할 수 있습니다.">
          Viewer는 조회만 할 수 있습니다
        </SectionMessage>
      )}

      <section className="qc-card qd-stack" style={{ gap: token('space-16') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          1. 스펙 폴더
        </h2>
        <p className={`${textClass('label2')} qd-muted`} style={{ margin: 0 }}>
          docs/specs 폴더나 그 폴더를 묶은 ZIP을 고르세요. 각 스펙 폴더의 <code className="qd-code">spec.md</code>만
          입력으로 씁니다(plan·tasks 등은 무시). 일부 기능만 올리면 빠진 스펙의 케이스는 삭제로 판정됩니다.
        </p>
        <div className="qd-row" style={{ gap: token('space-8') }}>
          <Button
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconFolder />}
            onClick={() => folderInput.current?.click()}
          >
            폴더 선택
          </Button>
          <Button
            variant="outlined"
            color="assistive"
            leadingContent={<Icons.IconUpload />}
            onClick={() => zipInput.current?.click()}
          >
            ZIP 선택
          </Button>
          {picked && <span className={`${textClass('label2')} qd-muted`}>{picked.label}</span>}
          <input
            ref={folderInput}
            type="file"
            hidden
            // 폴더 선택 (표준 속성이 아니라 타입에 없다)
            {...{ webkitdirectory: '', directory: '' }}
            multiple
            aria-label="스펙 폴더"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void pick(`폴더 · 파일 ${files.length}개`, () => readFolder(files));
            }}
          />
          <input
            ref={zipInput}
            type="file"
            hidden
            accept=".zip,application/zip"
            aria-label="스펙 ZIP"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file.name, () => readZip(file));
            }}
          />
        </div>
        {readError && (
          <SectionMessage variant="negative" description={readError}>
            읽을 수 없습니다
          </SectionMessage>
        )}
        {picked && <BundlePreview bundle={picked.bundle} />}
      </section>

      <section className="qc-card qd-stack" style={{ gap: token('space-16') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          2. 버전
        </h2>
        <div className="qd-form-grid">
          <label className="qd-form-field">
            <span className={`${textClass('label2', 'medium')} qd-form-label`}>앱 버전</span>
            <TextField value={appVersion} onChange={(e) => setAppVersion(e.target.value)} placeholder="예: 1.4.0" />
          </label>
          <label className="qd-form-field">
            <span className={`${textClass('label2', 'medium')} qd-form-label`}>비교할 이전 QA 문서</span>
            <Select
              aria-label="비교할 이전 QA 문서"
              value={prevDocId || 'none'}
              onChange={(v) => setPrevChoice(v === 'none' ? '' : String(v))}
            >
              {latest.map((d) => (
                <Option key={d.id} value={d.id}>
                  QA 문서 {d.appVersion}
                </Option>
              ))}
              <Option value="none">없음 (최초 버전)</Option>
            </Select>
          </label>
        </div>
        {plan && (
          <div className="qd-stack" style={{ gap: token('space-8') }}>
            <div className={`${textClass('label1')} qd-row`} style={{ gap: token('space-16') }}>
              <span>
                <span className="qd-faint">동일(복사)</span> <span className="qd-num">{plan.counts.same}</span>
              </span>
              <span>
                <span className="qd-faint">변경</span>{' '}
                <span className="qd-num" style={{ fontWeight: 600 }}>
                  {plan.counts.changed}
                </span>
              </span>
              <span>
                <span className="qd-faint">신규</span>{' '}
                <span className="qd-num" style={{ fontWeight: 600 }}>
                  {plan.counts.new}
                </span>
              </span>
              <span>
                <span className="qd-faint">삭제</span> <span className="qd-num">{plan.counts.removed}</span>
              </span>
            </div>
            <span className={`${textClass('label2')} qd-muted`}>
              {targets === 0
                ? '바뀐 행이 없어 이전 케이스를 그대로 복사합니다. Claude를 부르지 않습니다.'
                : `바뀐 ${fmt(targets)}행만 내 Claude 플랜(Opus)으로 케이스를 만듭니다. 동일한 행은 사람의 수정·승인을 그대로 이어받습니다. 예상 호출 약 ${fmt(estimateCalls(plan, picked!.bundle))}번.`}
            </span>
          </div>
        )}
      </section>

      <section className="qc-card qd-stack" style={{ gap: token('space-12') }}>
        <h2 className={textClass('headline2', 'bold')} style={{ margin: 0 }}>
          3. 생성
        </h2>
        <HostStatus />
        <span className={`${textClass('label2')} qd-muted`}>
          스펙 원문은 내 Claude 계정으로 Anthropic에 전송됩니다. 결과는 이 프로젝트 멤버 모두에게 보입니다.
        </span>
        {request.error && (
          <SectionMessage variant="negative" description={(request.error as Error).message}>
            요청할 수 없습니다
          </SectionMessage>
        )}
        <div className="qd-row" style={{ justifyContent: 'flex-end', gap: token('space-8') }}>
          <Button variant="outlined" color="assistive" onClick={() => void navigate(`/p/${projectId}/docs`)}>
            취소
          </Button>
          <Button
            variant="solid"
            color="primary"
            disabled={!ready}
            onClick={() =>
              request.mutate(
                { appVersion, files: picked!.files, ...(prevDocId ? { prevDocId } : {}) },
                { onSuccess: () => void navigate(`/p/${projectId}/docs`) },
              )
            }
          >
            <span className={textClass('label1', 'bold')}>내 Claude 플랜으로 생성 요청</span>
          </Button>
        </div>
      </section>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 스펙 계획(바뀐 행이 있는 스펙마다 1번) + 케이스 변환(8행씩) */
function estimateCalls(plan: ReturnType<typeof matchVersions>, bundle: SpecBundle) {
  const rows = plan.rows.filter((r) => r.decision !== 'same');
  return bundle.specs.reduce((n, s) => {
    const k = rows.filter((r) => r.spec === s).length;
    return n + (k ? 1 + Math.ceil(k / 8) : 0);
  }, 0);
}

function BundlePreview({ bundle }: { bundle: SpecBundle }) {
  if (!bundle.specs.length) {
    return (
      <SectionMessage
        variant="negative"
        description="`<스펙 이름>/spec.md` 파일을 찾지 못했습니다. docs/specs 폴더(또는 그 ZIP)를 골랐는지 확인하세요."
      >
        스펙이 없습니다
      </SectionMessage>
    );
  }
  const count = (kind: 'TS' | 'EC') =>
    bundle.specs.reduce((n, s) => n + s.rows.filter((r) => r.kind === kind).length, 0);
  const warnings = Object.values(bundle.warnings).flat().length;
  return (
    <div className="qd-stack" style={{ gap: token('space-8') }}>
      <span className={textClass('label1')}>
        스펙 <span className="qd-num">{bundle.specs.length}</span>개 · TS <span className="qd-num">{count('TS')}</span>{' '}
        · EC <span className="qd-num">{count('EC')}</span>
        {bundle.ignored > 0 && <span className="qd-faint"> · 입력 아닌 파일 {bundle.ignored}개</span>}
        {warnings > 0 && <span> · 경고 {warnings}</span>}
      </span>
      <div className="qd-table-wrap">
        <Table sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableHeadCell>스펙</TableHeadCell>
              <TableHeadCell>제목</TableHeadCell>
              <TableHeadCell>버전</TableHeadCell>
              <TableHeadCell>TS</TableHeadCell>
              <TableHeadCell>EC</TableHeadCell>
              <TableHeadCell>경고</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bundle.specs.map((s) => (
              <TableRow key={s.name}>
                <TableCell>
                  <span className="qc-mono">{s.name}</span>
                </TableCell>
                <TableCell>{s.title}</TableCell>
                <TableCell>
                  <span className="qd-num">{s.version ?? '—'}</span>
                </TableCell>
                <TableCell>
                  <span className="qd-num">{s.rows.filter((r) => r.kind === 'TS').length}</span>
                </TableCell>
                <TableCell>
                  <span className="qd-num">{s.rows.filter((r) => r.kind === 'EC').length}</span>
                </TableCell>
                <TableCell>
                  {bundle.warnings[s.name]?.length ? (
                    <span title={bundle.warnings[s.name]!.join('\n')}>{bundle.warnings[s.name]!.length}</span>
                  ) : (
                    <span className="qd-faint">없음</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
