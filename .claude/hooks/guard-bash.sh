#!/usr/bin/env bash
# PreToolUse(Bash): 되돌리기 어려운 명령은 에이전트가 직접 실행하지 않는다. 필요하면 사람이 직접 실행한다.
cmd=$(jq -r '.tool_input.command // empty')
deny() { echo "차단됨: $1 — 사람이 직접 실행해야 하는 명령입니다 (CLAUDE.md '하지 말 것')." >&2; exit 2; }

echo "$cmd" | grep -Eq 'firebase[a-z-]*[[:space:]].*deploy' && deny "firebase deploy"
echo "$cmd" | grep -Eq 'gcloud[[:space:]].*deploy' && deny "gcloud deploy"
echo "$cmd" | grep -Eq 'git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$))' && deny "git push --force"
echo "$cmd" | grep -Eq 'secrets?[[:space:]]+(versions[[:space:]]+)?access|functions:secrets:access' && deny "비밀값 조회"
exit 0
