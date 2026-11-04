// 수동 결과의 첨부 스크린샷 (선택): 입력 패널의 첨부 칸과 판정 추적 뷰의 첨부 목록
import type { Screenshot } from '@qcard/shared';
import { Button, IconButton, Icons, textClass, token } from '@qcard/ui';
import { useRef } from 'react';
import { MAX_ATTACHMENTS, type AttachmentFile } from '../../data/api';
import { MockScreen } from '../../mock/MockScreen';

/** 아직 올리지 않은 파일. preview는 미리 보기용 object URL */
export type PendingAttachment = { file: AttachmentFile; preview: string };

const ACCEPT = 'image/png,image/jpeg,image/webp';

/** 고른·붙여넣은 이미지 파일 → 올릴 첨부. 이미지 크기는 화면 비율용으로 읽는다 */
export async function toPending(files: File[]): Promise<PendingAttachment[]> {
  return Promise.all(
    files.map(async (f) => {
      const size = await createImageBitmap(f).then(
        (b) => {
          const s = { w: b.width, h: b.height };
          b.close();
          return s;
        },
        () => undefined,
      );
      return {
        file: { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()), ...size },
        preview: URL.createObjectURL(f),
      };
    }),
  );
}

/** 클립보드에 든 이미지 파일 */
export const pastedImages = (data: DataTransfer | null) =>
  [...(data?.files ?? [])].filter((f) => ACCEPT.split(',').includes(f.type));

export function AttachmentField({
  keep,
  add,
  onKeep,
  onAdd,
  hint,
  disabled,
}: {
  keep: Screenshot[];
  add: PendingAttachment[];
  onKeep: (next: Screenshot[]) => void;
  onAdd: (next: PendingAttachment[]) => void;
  /** 첨부가 없을 때 보일 권유 문구 (Fail·Blocked) */
  hint?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const count = keep.length + add.length;
  const full = count >= MAX_ATTACHMENTS;
  return (
    <div className="qs-stack" style={{ gap: token('space-6') }}>
      <span className={`${textClass('label2', 'medium')} qs-faint`}>
        스크린샷 (선택{count > 0 ? ` · ${count}/${MAX_ATTACHMENTS}` : ''})
      </span>
      {count > 0 && (
        <ul className="qs-thumbs" aria-label="첨부할 스크린샷">
          {keep.map((s, i) => (
            <Thumb
              key={`keep-${i}`}
              shot={s}
              label={`첨부 ${i + 1}`}
              onRemove={() => onKeep(keep.filter((x) => x !== s))}
            />
          ))}
          {add.map((p, i) => (
            <Thumb
              key={p.preview}
              shot={{ kind: 'url', url: p.preview, w: p.file.w, h: p.file.h }}
              label={p.file.name}
              onRemove={() => {
                URL.revokeObjectURL(p.preview);
                onAdd(add.filter((_, j) => j !== i));
              }}
            />
          ))}
        </ul>
      )}
      <div className="qs-row" style={{ gap: token('space-8') }}>
        <Button
          type="button"
          size="small"
          variant="outlined"
          color="assistive"
          leadingContent={<Icons.IconPlus />}
          disabled={disabled || full}
          onClick={() => input.current?.click()}
        >
          스크린샷 추가
        </Button>
        <span className={`${textClass('caption1')} qs-faint`}>
          {full ? `${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다` : 'PNG·JPEG·WebP, 한 장 10MB까지. 붙여넣기도 됩니다'}
        </span>
      </div>
      {hint && count === 0 && <span className={`${textClass('caption1')} qs-muted`}>{hint}</span>}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        aria-label="스크린샷 파일"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, MAX_ATTACHMENTS - count);
          e.target.value = '';
          if (files.length) onAdd([...add, ...(await toPending(files))]);
        }}
      />
    </div>
  );
}

function Thumb({ shot, label, onRemove }: { shot: Screenshot; label: string; onRemove: () => void }) {
  return (
    <li className="qs-thumb">
      <MockScreen screenshot={shot} width={64} label={label} />
      <IconButton type="button" aria-label={`${label} 빼기`} size="small" variant="outlined" onClick={onRemove}>
        <Icons.IconClose />
      </IconButton>
    </li>
  );
}

/** 판정 추적 뷰의 첨부 목록 */
export function AttachmentList({ shots }: { shots: Screenshot[] }) {
  return (
    <ul className="qs-thumbs" aria-label="첨부 스크린샷">
      {shots.map((s, i) => (
        <li key={i}>
          <MockScreen screenshot={s} width={140} label={`첨부 스크린샷 ${i + 1}`} />
        </li>
      ))}
    </ul>
  );
}
