import { Option, Select, textClass, token } from '@qcard/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../data/hooks';
import { isMemoryApi } from '../data/memory';

/**
 * 로그인한 사용자 이름. 메모리 구현(로그인 없음)에서는 개발용으로 사용자를 바꿀 수 있다 —
 * 초대 수락·Viewer 권한 화면을 확인하기 위한 것이고, Firestore 구현에서는 GitHub 로그인 사용자로 고정된다.
 */
export function CurrentUser() {
  const api = useApi();
  const qc = useQueryClient();
  const [user, setUser] = useState(api.currentUser);
  if (!isMemoryApi(api)) {
    return (
      <div className={textClass('label2')} style={{ color: token('foreground-neutral-secondary') }}>
        {user}
      </div>
    );
  }
  return (
    <Select
      aria-label="개발용: 사용자 전환"
      value={user}
      onChange={(v) => {
        api.switchUser(String(v));
        setUser(String(v));
        qc.clear();
      }}
    >
      {api.users.map((u) => (
        <Option key={u} value={u}>
          {u}
        </Option>
      ))}
    </Select>
  );
}
