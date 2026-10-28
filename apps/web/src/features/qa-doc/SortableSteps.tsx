import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton, Icons, TextButton, TextField, textClass, token } from '@qcard/ui';
import { useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * 순서를 바꿀 수 있는 한 줄 텍스트 목록 (준비 플로우 수행 스텝). 손잡이를 끌거나(마우스·터치),
 * 손잡이에 포커스를 두고 스페이스 → 화살표 → 스페이스로 옮긴다. 끌지 않고 누르기만으로 옮기는 버튼은 두지 않는다
 * (2026-10-28 결정).
 */
export function SortableSteps({
  steps,
  onChange,
  label = '스텝',
}: {
  steps: string[];
  onChange: (steps: string[]) => void;
  label?: string;
}) {
  // 끄는 동안 줄을 구분할 키. 문자열은 겹칠 수 있어 따로 둔다 — 밖에서 목록을 통째로 바꾸면(최신 내용 보기) 새로 만든다
  const next = useRef(0);
  const keys = useRef<number[]>([]);
  if (keys.current.length !== steps.length) keys.current = steps.map(() => next.current++);
  const ids = keys.current;
  const change = (nextSteps: string[], nextKeys: number[]) => {
    keys.current = nextKeys;
    onChange(nextSteps);
  };
  const move = (from: number, to: number) => change(arrayMove(steps, from, to), arrayMove(ids, from, to));

  const sensors = useSensors(
    // 조금 움직여야 끌기가 시작된다 — 손잡이를 눌러 포커스만 줄 때 끌리지 않게
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
  };
  const name = (i: number) => `${label} ${i + 1}`;

  return (
    <div className="qd-stack" style={{ gap: token('space-8') }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        // 화면 끝 10% 안에서만 페이지를 스크롤한다 (기본 20%는 화면 아래쪽 스텝을 옮길 때 페이지가 먼저 흘러간다)
        autoScroll={{ threshold: { x: 0, y: 0.1 } }}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `${name(ids.indexOf(Number(active.id)))}을 집었습니다.`,
            onDragOver: ({ over }) => (over ? `${ids.indexOf(Number(over.id)) + 1}번째 자리입니다.` : ''),
            onDragEnd: ({ over }) => (over ? `${ids.indexOf(Number(over.id)) + 1}번째 자리로 옮겼습니다.` : ''),
            onDragCancel: () => '옮기기를 취소했습니다.',
          },
          screenReaderInstructions: {
            draggable: '스페이스로 집고, 위아래 화살표로 옮긴 뒤 스페이스로 놓습니다. Esc는 취소합니다.',
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {steps.map((s, i) => (
            <Row key={ids[i]} id={ids[i]!} name={name(i)} index={i}>
              <div className="qd-grow">
                <TextField
                  aria-label={name(i)}
                  value={s}
                  onChange={(e) =>
                    change(
                      steps.map((x, j) => (j === i ? e.target.value : x)),
                      ids,
                    )
                  }
                />
              </div>
              <IconButton
                type="button"
                aria-label={`${name(i)} 삭제`}
                onClick={() =>
                  change(
                    steps.filter((_, j) => j !== i),
                    ids.filter((_, j) => j !== i),
                  )
                }
              >
                <Icons.IconTrash />
              </IconButton>
            </Row>
          ))}
        </SortableContext>
      </DndContext>
      <div>
        <TextButton
          size="small"
          type="button"
          leadingContent={<Icons.IconPlus />}
          onClick={() => change([...steps, ''], [...ids, next.current++])}
        >
          {label} 추가
        </TextButton>
      </div>
    </div>
  );
}

function Row({ id, name, index, children }: { id: number; name: string; index: number; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className="qd-edit-line qd-sortable" data-dragging={isDragging || undefined}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="qd-drag-handle"
        aria-label={`${name} 옮기기`}
        {...attributes}
        {...listeners}
      >
        <Icons.IconHandle aria-hidden />
      </button>
      <span className={`${textClass('label2', 'medium')} qc-mono qd-faint`}>{index + 1}</span>
      {children}
    </div>
  );
}
