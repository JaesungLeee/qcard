import { Checkbox } from '@qcard/ui';
import { useId, type CSSProperties, type ReactNode } from 'react';

/**
 * 체크박스 + 글자. Montage Checkbox는 `<label>`로 감싸도 글자를 눌렀을 때 켜지지 않으므로
 * 글자 클릭을 직접 연결하고, 글자를 체크박스의 접근성 이름으로 쓴다.
 */
export function CheckLabel({
  checked,
  onCheckedChange,
  children,
  className,
  style,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId();
  return (
    <span className={className} style={style}>
      <Checkbox size="small" checked={checked} onCheckedChange={onCheckedChange} aria-labelledby={id} />
      <span id={id} onClick={() => onCheckedChange(!checked)} style={{ cursor: 'pointer' }}>
        {children}
      </span>
    </span>
  );
}
