# 브랜치 전략 (git flow)

| 브랜치           | 어디서 갈라져 | 어디로 합치나           | 푸시하면                        |
| ---------------- | ------------- | ----------------------- | ------------------------------- |
| `main`           | —             | —                       | 검증 → 운영(`qcard-d2ade`) 배포 |
| `develop`        | `main`        | —                       | 검증만                          |
| `feature/<이름>` | `develop`     | `develop` (PR)          | PR을 열면 검증                  |
| `release/<버전>` | `develop`     | `main` (PR) → `develop` | PR을 열면 검증                  |
| `hotfix/<버전>`  | `main`        | `main` (PR) → `develop` | PR을 열면 검증                  |

- GitHub 기본 브랜치는 `develop`이다. PR은 기본으로 `develop`을 향한다.
- 합치기는 GitHub PR로 한다. CI(`deploy.yml`의 verify)가 통과한 뒤 머지한다. `main`·`develop`은 머지 커밋(Create a merge commit)으로 합쳐 브랜치 흐름을 남긴다.
- `main`에는 release·hotfix PR로만 들어간다. Claude는 `main`에 직접 push할 수 없다(`guard-bash.sh`). 비공개 저장소 + GitHub Free라 서버 쪽 브랜치 보호는 없으니 사람도 같은 규칙을 지킨다.
- 브랜치 이름의 `<이름>`은 kebab-case 영어(`feature/test-account-pool`). Claude Code 워크트리(`worktree.md`)도 같은 이름 규칙을 쓴다.

## 버전과 태그

| 태그           | 무엇의 버전                                                  | 어디서                              |
| -------------- | ------------------------------------------------------------ | ----------------------------------- |
| `v<버전>`      | 서비스(웹·Functions·규칙) — 루트 `package.json`의 `version`  | release·hotfix 머지 후 `main`       |
| `host-v<버전>` | 호스트 에이전트 — `apps/host-agent/package.json`의 `version` | 같음. 푸시하면 npm publish(`ci.md`) |

SemVer를 따른다. 기능을 모은 release는 minor, hotfix는 patch를 올린다. 호스트 에이전트는 바뀐 릴리스에서만 버전을 올리고 `host-v*` 태그를 함께 단다.

웹·Functions·보안 규칙이 이전 호스트와 호환되지 않게 바뀌면 `packages/shared`의 `MIN_HOST_VERSION`을 새 호스트 버전으로 올린다. 호스트는 연결 신호에 버전을 보내고, 웹은 그보다 낮은 호스트로 Run을 시작하지 않고 업데이트를 안내한다(연결된 PC 화면에도 표시). 그런 릴리스는 CHANGELOG 항목 맨 위에 `> ⚠ **호스트 업데이트가 필요합니다.**`로 알린다.

## 흐름

### 기능

```sh
git switch develop && git pull
git switch -c feature/<이름>
# 작업·커밋
git push -u origin feature/<이름>
gh pr create --base develop
```

### 릴리스

```sh
git switch develop && git pull
git switch -c release/0.2.0
# 루트 package.json version → 0.2.0 (호스트가 바뀌었으면 apps/host-agent도), 릴리스 전 수정만
# CHANGELOG.md에 0.2.0 항목 추가 (아래)
git add -A && git commit -m "chore: release 0.2.0"
git push -u origin release/0.2.0
gh pr create --base main --title "release 0.2.0"
```

PR을 머지하면 운영 배포가 돈다. 그다음:

```sh
git switch main && git pull
git tag v0.2.0 && git push origin v0.2.0
git tag host-v0.1.6 && git push origin host-v0.1.6   # 호스트 버전을 올렸을 때만
gh release create v0.2.0 --title "qcard 0.2.0" --notes "$(awk '/^## \[?0.2.0[] ]/{f=1;next} /^## /{f=0} f' CHANGELOG.md)"
# release 브랜치의 변경을 develop에도
gh pr create --base develop --head release/0.2.0 --title "back-merge release 0.2.0"
```

back-merge PR까지 머지하면 `release/0.2.0`을 지운다.

#### CHANGELOG

루트 `CHANGELOG.md`에 새 버전 항목을 맨 위에 더하고 release 브랜치에 함께 커밋한다. 태그를 단 뒤 그 항목으로 GitHub Release를 만든다(위 `gh release create`).

- 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따른다: `## [버전](비교 링크) - 날짜` 아래 `### Added`·`### Changed`·`### Removed`·`### Fixed`를 이 순서로 두고, 빈 섹션은 뺀다.
- 읽는 사람은 qcard 사용자다. 커밋 메시지를 옮기지 말고 화면과 동작에서 달라진 점을 "~합니다"체로 쓴다. 경로·함수·보안 규칙 같은 구현, PRD 기능 ID, 커밋 해시는 쓰지 않고 항목 끝에 PR 링크 `([#PR](링크))`만 붙인다. 같은 기능의 커밋은 한 항목으로 묶는다.
- 범위는 직전 태그 이후 커밋이다(`git log --no-merges <직전 태그>..release/<버전>`). `feat`·`fix`를 보고 `docs`·`chore`·`test`는 뺀다. 사용자가 느끼지 못하는 변경은 빼거나 효과만 한 줄로 쓴다.
- 호스트 버전을 올렸으면 항목 맨 위 인용문(`>`)에 새 호스트 버전과 업데이트 방법(`npm i -g @qcard/host` → `qcard serve` 재시작)을 쓴다.
- 데이터 이전처럼 운영자만 하는 작업은 CHANGELOG가 아니라 [deploy.md](deploy.md)에 쓴다.
- 핫픽스도 같은 파일에 patch 버전 항목으로 더한다.

### 핫픽스

릴리스와 같고, `main`에서 `hotfix/0.2.1`을 만들어 patch 버전을 올린다. `main` PR 머지 → 태그 → `develop` back-merge PR.
