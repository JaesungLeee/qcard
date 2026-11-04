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

| 태그           | 무엇의 버전                                                  | 어디서                                             |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `v<버전>`      | 서비스(웹·Functions·규칙) — 루트 `package.json`의 `version`  | `main` 배포 뒤 deploy가 단다(서비스가 바뀌었을 때) |
| `host-v<버전>` | 호스트 에이전트 — `apps/host-agent/package.json`의 `version` | deploy가 달고 npm publish(호스트가 바뀌었을 때)    |

SemVer를 따른다. 기능을 모은 release는 minor, hotfix는 patch를 올린다. 호스트 에이전트는 호스트 코드나 그 의존 패키지(`shared` 등)가 바뀐 릴리스에서만 버전을 올린다 — 그런 릴리스에서 안 올리면 CI가 실패한다. 태그는 CI가 단다.

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

GitHub Actions → **start-release** → Run workflow(`release`)로 시작한다. 사람은 시작하기, CHANGELOG 다듬기, 머지만 한다([ci.md](ci.md#릴리스-자동화)).

1. `start-release`가 직전 태그(`v*`·`host-v*` 중 높은 것)의 minor를 올린 버전으로 `develop`에서 `release/<버전>`을 만든다. 버전을 직접 정하려면 입력칸에 쓴다(major를 올릴 때).
2. 브랜치에 푸시될 때마다 `prepare-release`가 `main` 대비 바뀐 쪽(서비스·호스트)의 `version`을 브랜치 버전으로 올리고, `CHANGELOG.md` 초안 항목(직전 릴리스 이후 `develop`에 머지된 PR)을 만들어 커밋하고, `main`으로 가는 PR을 연다. release 브랜치에서 고친 수정이 호스트를 건드려도 다음 푸시 때 호스트 버전을 맞춘다.
3. PR에서 CHANGELOG 초안을 다듬고 초안 표시 줄을 지운다(아래 CHANGELOG 규칙). 이전 호스트로 실행할 수 없게 바뀌었으면 `MIN_HOST_VERSION`을 올린다. 두 가지는 사람이 판단한다.
4. PR을 머지하면 deploy가 호스트 npm 배포(`host-v*` 태그) → 서비스 배포(`v*` 태그) → GitHub Release 순으로 하고, `main` → `develop` back-merge PR을 연다. back-merge PR은 merge commit으로 머지한다.

release 브랜치는 머지 뒤 지워도 된다(back-merge는 `main`에서 한다).

#### CHANGELOG

`prepare-release`가 루트 `CHANGELOG.md` 맨 위에 새 버전 초안 항목을 만든다: release는 직전 릴리스 이후 `develop`에 머지된 PR, hotfix는 브랜치의 커밋을 `feat` → Added, `fix` → Fixed, 나머지 → Changed로 나누고 `docs`·`chore`·`test`·`ci`·`build`·`style`은 뺀다. 제목을 옮긴 것뿐이라 아래 규칙대로 다듬고 `<!-- 초안: … -->` 줄을 지운다(남아 있으면 `release-check`가 실패한다). 배포 뒤 CI가 그 항목으로 GitHub Release를 만든다.

- 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따른다: `## [버전](비교 링크) - 날짜` 아래 `### Added`·`### Changed`·`### Removed`·`### Fixed`를 이 순서로 두고, 빈 섹션은 뺀다.
- 읽는 사람은 qcard 사용자다. 커밋 메시지를 옮기지 말고 화면과 동작에서 달라진 점을 "~합니다"체로 쓴다. 경로·함수·보안 규칙 같은 구현, PRD 기능 ID, 커밋 해시는 쓰지 않고 항목 끝에 PR 링크 `([#PR](링크))`만 붙인다. 같은 기능의 커밋은 한 항목으로 묶는다.
- 사용자가 느끼지 못하는 변경은 빼거나 효과만 한 줄로 쓴다.
- 호스트 버전을 올렸으면 초안 맨 위 인용문(`>`)에 새 호스트 버전과 업데이트 방법이 들어간다. `MIN_HOST_VERSION`을 올렸으면 앞에 `⚠ **호스트 업데이트가 필요합니다.**`와 어느 버전 이하로는 안 되는지를 쓴다.
- 데이터 이전처럼 운영자만 하는 작업은 CHANGELOG가 아니라 [deploy.md](deploy.md)에 쓴다.
- 핫픽스도 같은 파일에 patch 버전 항목으로 더한다.

### 핫픽스

start-release를 `hotfix`로 실행하면 `main`에서 patch를 올린 `hotfix/<버전>`을 만든다. 그 브랜치에 수정을 커밋·푸시하면 `prepare-release`가 바뀐 쪽의 버전·CHANGELOG 초안·`main` PR을 맞춘다. 그다음은 릴리스와 같다.
