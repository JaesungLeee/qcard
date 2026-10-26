#!/usr/bin/env bash
# PreToolUse(Bash): 되돌리기 어려운 명령은 에이전트가 직접 실행하지 않는다. 필요하면 사람이 직접 실행한다.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')
deny() { echo "차단됨: $1 — 사람이 직접 실행해야 하는 명령입니다 (CLAUDE.md '하지 말 것')." >&2; exit 2; }

echo "$cmd" | grep -Eq 'firebase[a-z-]*[[:space:]].*deploy' && deny "firebase deploy"
echo "$cmd" | grep -Eq 'gcloud[[:space:]].*deploy' && deny "gcloud deploy"
echo "$cmd" | grep -Eq 'git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$))' && deny "git push --force"

# main 직접 push (main 푸시 = 운영 배포). main에는 release·hotfix PR로만 들어간다 — docs/dev/branching.md
# git push 하나 = `git push`부터 다음 ; & | 줄바꿈 전까지. 리모트 다음 인자가 refspec, 없으면 현재 브랜치를 올린다
while read -r seg; do
  [ -n "$seg" ] || continue
  set -f
  args=() && for a in ${seg#*push}; do case "$a" in --force* | -f | -[a-z]*f*) deny "git push --force" ;; --all | --mirror) deny "git push $a" ;; -*) ;; *) args+=("$(echo "$a" | tr -d "'\"")") ;; esac; done
  set +f
  if [ ${#args[@]} -le 1 ]; then
    [ "$(git -C "${cwd:-.}" branch --show-current 2>/dev/null)" = main ] && deny "main에서 git push (PR로 합치세요)"
  else
    for r in "${args[@]:1}"; do echo "$r" | grep -Eq '^\+?((.*:)?(refs/heads/)?main)$' && deny "main으로 git push (PR로 합치세요)"; done
  fi
done < <(echo "$cmd" | grep -oE 'git[[:space:]]+push([[:space:]][^;&|]*)?')
echo "$cmd" | grep -Eq 'secrets?[[:space:]]+(versions[[:space:]]+)?access|functions:secrets:access' && deny "비밀값 조회"

# 실기기(개인 폰) 대상 파괴적 ADB. adb 호출이 없는 명령은 보지 않는다.
# 앱 데이터 삭제를 허용할 QA 앱: 저장소 루트 qcard.local.json의 devApp (gitignore, packages/device/src/devApp.ts). 없으면 모두 막는다
QA_APP=$(jq -r '.devApp // empty' "${CLAUDE_PROJECT_DIR:-.}/qcard.local.json" 2>/dev/null)
# adb 호출 하나 = `adb `부터 다음 ; & | 줄바꿈 전까지(`adb.ts` 같은 파일 이름은 제외). 따옴표 안의 `&&`로 이어진 두 번째 명령은 놓칠 수 있다.
segs=$(echo "$cmd" | grep -oE "(^|[[:space:]/(\`'\"])adb[[:space:]][^;&|]*")
[ -n "$segs" ] || exit 0
set -f

echo "$segs" | grep -Eq "[[:space:]'\"]reboot([[:space:]'\"]|$)" && deny "adb 재부팅"
echo "$segs" | grep -Eq "[[:space:]'\"](uninstall|pm[[:space:]]+uninstall|cmd[[:space:]]+package[[:space:]]+uninstall)[[:space:]]" && deny "앱 삭제"
echo "$segs" | grep -Eq '(wipe|factory|recovery)' && deny "기기 초기화"

# 앱 데이터 삭제는 QA 앱만
while read -r pkg; do
  [ -z "$pkg" ] || { [ -n "$QA_APP" ] && [ "$pkg" = "$QA_APP" ]; } || deny "${pkg} 데이터 삭제(pm clear는 qcard.local.json의 devApp만: ${QA_APP:-없음})"
done < <(echo "$segs" | grep -oE "(pm|cmd[[:space:]]+package)[[:space:]]+clear([[:space:]]+--user[[:space:]]+[0-9]+)?[[:space:]]+[^[:space:]'\"]+" | awk '{print $NF}')

# 폰 안 파일 삭제는 /data/local/tmp 아래만
while read -r seg; do
  for t in $(echo "$seg" | tr -d "'\"" | grep -oE '[[:space:]]rm([[:space:]]+[^[:space:]]+)+' | sed -E 's/^[[:space:]]*rm//'); do
    case "$t" in -*) ;; /data/local/tmp/?*) ;; *) deny "폰 파일 삭제 $t(/data/local/tmp 아래만)" ;; esac
  done
done < <(echo "$segs" | grep -E '[[:space:]]shell[[:space:]]')
exit 0
