#!/usr/bin/env bash
# main에 들어가는 변경으로 운영 배포 대상과 새로 달 태그를 정한다. deploy.yml이 쓴다(docs/dev/ci.md).
#
#   scripts/release-plan.sh <모드> <서비스 기준 커밋|*>
#
#   push     배포 대상(only)·서비스 태그(service_tag)·호스트 태그(host_tag)를 GITHUB_OUTPUT에 쓴다
#   pr       main으로 가는 PR에서 버전을 올렸는지만 검사한다
#   dispatch 배포 대상만 정한다(태그·npm 배포 없음)
#   plan     릴리스를 시작할 때 서비스·호스트 중 어느 쪽이 바뀌었는지만 정한다(only·host). start-release.yml이 쓴다
#
# 바뀐 쪽의 version이 이미 태그돼 있으면(버전을 안 올렸으면) push·pr은 실패한다.
set -euo pipefail

mode=$1
base=$2
out=${GITHUB_OUTPUT:-/dev/stdout}
head=$(git rev-parse HEAD)

# 기준과 HEAD의 공통 조상 이후 HEAD 쪽 변경 (develop처럼 기준 태그가 조상이 아닌 브랜치에서도 맞게)
changed_since() { if [ "$1" = '*' ]; then echo '*'; else git diff --name-only "$1...$head"; fi; }
has() { [ "$1" = '*' ] || echo "$1" | grep -Eq "$2"; }
tag_at() { git rev-parse -q --verify "refs/tags/$1^{commit}" || true; }
version() { node -p "require('./$1').version"; }

# 각 앱이 (간접으로라도) 의존하는 워크스페이스 패키지. 의존을 바꾸면 여기도 바꾼다
web_pkgs='apk|data|device|fixtures|shared|spec|ui'
functions_pkgs='apk|data|device|fixtures|shared|spec'
host_pkgs='agent|apk|data|device|fixtures|llm|qadoc|reporter|shared|spec'

# 서비스(웹·Functions·규칙): 기준 커밋 이후. 테스트·문서만 바뀌면 배포하지 않는다
changed=$(changed_since "$base")
t=()
has "$changed" "^(apps/web/(src/|public/|index.html|vite.config.ts|package.json)|packages/($web_pkgs)/(src/|package.json)|pnpm-lock.yaml)" && t+=(hosting)
has "$changed" "^(apps/functions/(src/|package.json)|packages/($functions_pkgs)/(src/|package.json)|pnpm-lock.yaml)" && t+=(functions)
has "$changed" '^firebase/firestore' && t+=(firestore)
has "$changed" '^firebase/storage' && t+=(storage)
only=$(IFS=,; echo "${t[*]}")

# 호스트: 마지막 host-v 태그 이후. 로컬 콘솔에 들어가는 웹만 바뀐 건 다음 호스트 릴리스 때 함께 나간다
host_base=$(git tag -l 'host-v*' --sort=-v:refname | head -1)
host_changed=$(changed_since "${host_base:-*}")
host=
has "$host_changed" "^(apps/host-agent/(src/|scripts/|package.json|README.npm.md)|packages/($host_pkgs)/(src/|package.json))" && host=1

service_tag=
host_tag=
fail=
if [ "$mode" = push ] || [ "$mode" = pr ]; then
  service_ver=$(version package.json)
  host_ver=$(version apps/host-agent/package.json)

  if [ -n "$only" ]; then
    at=$(tag_at "v$service_ver")
    if [ -z "$at" ]; then
      service_tag="v$service_ver"
    elif [ "$at" != "$head" ]; then
      echo "::error::서비스($only)가 바뀌었는데 package.json version ${service_ver}는 이미 태그돼 있습니다. 버전을 올리세요."
      fail=1
    fi
  fi

  host_at=$(tag_at "host-v$host_ver")
  if [ -n "$host" ]; then
    if [ -z "$host_at" ]; then
      host_tag="host-v$host_ver"
    else
      echo "::error::호스트가 ${host_base} 이후 바뀌었는데 apps/host-agent/package.json version ${host_ver}는 이미 태그돼 있습니다. 버전을 올리세요."
      fail=1
    fi
  elif [ "$mode" = push ] && [ "$host_at" = "$head" ] && [ -z "$(npm view "@qcard/host@$host_ver" version 2>/dev/null)" ]; then
    # 태그는 달았는데 npm 배포가 실패했던 실행을 다시 돌릴 때
    host_tag="host-v$host_ver"
  fi
fi

echo "서비스 배포: ${only:-없음} / 호스트 바뀜: ${host:-아니오} / 서비스 태그: ${service_tag:-없음} / 호스트 태그: ${host_tag:-없음} (기준 $base, 호스트 기준 ${host_base:-없음})" >&2
if [ "$mode" != pr ]; then
  {
    echo "only=$only"
    echo "host=$host"
    echo "service_tag=$service_tag"
    echo "host_tag=$host_tag"
  } >>"$out"
fi
[ -z "$fail" ]
