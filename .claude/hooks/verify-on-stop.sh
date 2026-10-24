#!/usr/bin/env bash
# Stop: 코드(apps/, packages/, scripts/)를 바꿨으면 `pnpm verify`가 통과해야 작업을 끝낼 수 있다.
input=$(cat)
# 이미 한 번 막혀서 다시 멈추는 중이면 통과시킨다(무한 반복 방지). 실패 내용은 앞에서 이미 전달됐다.
[ "$(echo "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -n "$(git status --porcelain -- apps packages scripts package.json pnpm-workspace.yaml 2>/dev/null)" ] || exit 0

if command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm); else PNPM=(npx -y pnpm@10.34.6); fi
# 새 워크트리는 의존성이 없다 (docs/dev/worktree.md)
[ -d node_modules ] || "${PNPM[@]}" install --frozen-lockfile >/dev/null 2>&1
if ! out=$("${PNPM[@]}" verify 2>&1); then
  echo "pnpm verify 실패 — 고친 뒤 끝내세요:" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
exit 0
