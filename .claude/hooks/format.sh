#!/usr/bin/env bash
# PostToolUse(Edit|Write): 편집한 파일을 prettier로 정리한다. 실패해도 작업은 막지 않는다.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -x node_modules/.bin/prettier ] || exit 0
node_modules/.bin/prettier --write --ignore-unknown --log-level warn "$f"
