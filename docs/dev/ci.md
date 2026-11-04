# CI·자동 배포 (GitHub Actions)

| 워크플로                                | 언제                                    | 하는 일                                                                                            |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml`          | `main`·`develop` 푸시 · PR · 수동 실행  | `pnpm verify` → (`main` 푸시만) 바뀐 쪽만 배포하고 태그. `main`으로 가는 PR은 버전을 올렸는지 검사 |
| `.github/workflows/publish-host.yml`    | deploy.yml이 띄움 · 태그 `host-v*` 푸시 | 버전 확인 → `pnpm verify` → `bundle` → `npm publish`                                               |
| `.github/workflows/start-release.yml`   | 수동 실행                               | 다음 버전을 정해 `release/*`(develop에서) 또는 `hotfix/*`(main에서) 브랜치를 만든다                |
| `.github/workflows/prepare-release.yml` | `release/*`·`hotfix/*` 푸시             | 바뀐 쪽 버전 올리기 · `CHANGELOG.md` 초안 · `main` PR 열기                                         |

`main`에 푸시하면 `scripts/release-plan.sh`가 무엇을 내보낼지 정하고, 이 순서로 진행한다.

1. **호스트**(`apps/host-agent`와 그 의존 패키지의 소스)가 마지막 `host-v*` 태그 이후 바뀌었으면 `host-v<apps/host-agent 버전>` 태그를 달고 그 태그로 `publish-host.yml`을 띄워 끝날 때까지 기다린다. `GITHUB_TOKEN`으로 푸시한 태그는 push 트리거를 띄우지 않아서 `workflow_dispatch`로 띄운다. 로컬 콘솔에 들어가는 웹만 바뀐 건 호스트를 다시 올리지 않고 다음 호스트 릴리스 때 함께 나간다.
2. **서비스**: 마지막으로 성공한 deploy 실행 이후 바뀐 것으로 대상을 고른다(실패한 실행의 변경도 다음 성공 때 함께 나간다): 웹·그 의존 패키지 소스 → `hosting`, Functions·그 의존 패키지 소스 → `functions`, `firebase/firestore*` → `firestore`, `firebase/storage*` → `storage`. 테스트·문서만 바뀌면 배포하지 않는다. 배포한 뒤 `v<루트 버전>` 태그를 달고 `CHANGELOG.md`의 그 버전 항목으로 GitHub Release를 만든다.

호스트를 먼저 올리는 건 `MIN_HOST_VERSION`을 올린 릴리스에서 웹이 아직 npm에 없는 호스트로 업데이트하라고 안내하지 않게 하려는 것이다. npm 배포가 실패하면 서비스도 배포하지 않는다.

앱마다 의존하는 패키지(간접 포함)는 `release-plan.sh`의 `web_pkgs`·`functions_pkgs`·`host_pkgs`에 적혀 있고 `pnpm verify`가 실제 의존과 같은지 검사한다. 호스트만 쓰는 `agent`·`llm`·`qadoc`이나 `apps/host-agent`만 바뀐 릴리스는 서비스 배포 없이 npm만 나간다. 웹은 `fixtures`를 통해 `device`도 쓴다.

버전은 `prepare-release`가 올린다([릴리스 자동화](#릴리스-자동화)). 바뀐 쪽의 버전이 이미 태그돼 있으면(버전을 안 올렸으면) `main`으로 가는 PR의 `release-check` 잡이 실패하고, 그래도 머지되면 deploy 잡이 배포 전에 실패한다. 같은 실행을 다시 돌리면 이미 있는 태그·Release는 건너뛰고, 태그만 달고 npm 배포가 실패했던 호스트 버전은 다시 올린다. 손으로 띄운 실행(Run workflow)은 서비스를 다시 배포만 하고 태그·npm 배포는 하지 않는다.

배포가 끝나면 release·hotfix를 머지한 푸시인 경우 `main` → `develop` back-merge PR을 연다.

인증 정보(키·토큰)는 저장소에 없다. Google Cloud는 Workload Identity Federation, npm은 Trusted Publishing으로 GitHub Actions의 OIDC 토큰만 믿는다. 예외는 릴리스 자동화용 PAT `RELEASE_TOKEN`(아래 4단계) 하나다.

## 릴리스 자동화

`start-release` → `prepare-release` → (PR 머지) → `deploy` 흐름은 [branching.md](branching.md#릴리스). 판정은 deploy와 같은 `scripts/release-plan.sh`(`plan` 모드)가 하고, 버전·CHANGELOG는 `scripts/release-prepare.mjs`가 고친다. 둘 다 이미 맞으면 아무것도 하지 않아서, 자기가 푸시한 커밋으로 다시 돌아도 멈춘다.

`GITHUB_TOKEN`으로 만든 커밋·브랜치·PR은 다른 워크플로를 띄우지 않는다. 그러면 자동으로 연 PR에 `verify`·`release-check`가 돌지 않으므로, 브랜치 만들기·커밋 푸시·PR 열기(back-merge 포함)는 `RELEASE_TOKEN`으로 한다.

## 처음 한 번 설정

### 1. Google Cloud: 배포용 서비스 계정 + Workload Identity

[Cloud Shell](https://shell.cloud.google.com/?project=qcard-d2ade)(브라우저 터미널, `gcloud`가 들어 있음)에서 그대로 실행한다.

```sh
PROJECT_ID=qcard-d2ade
PROJECT_NUMBER=692024432834
REPO=JaesungLeee/qcard
SA=github-deploy@$PROJECT_ID.iam.gserviceaccount.com

gcloud config set project $PROJECT_ID
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

# GitHub OIDC를 믿는 풀·공급자. 이 저장소의 main 브랜치만 받는다
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc qcard \
  --location=global --workload-identity-pool=github --display-name="qcard" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"

# 배포용 서비스 계정과 권한 (Hosting·규칙·Functions v2·예약 함수)
gcloud iam service-accounts create github-deploy --display-name="GitHub Actions deploy"
for role in roles/firebase.admin roles/cloudfunctions.admin roles/run.admin roles/cloudscheduler.admin \
            roles/artifactregistry.admin roles/iam.serviceAccountUser roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA" --role=$role --condition=None
done

# GitHub(이 저장소)가 그 서비스 계정으로 동작하도록 허용
gcloud iam service-accounts add-iam-policy-binding $SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

풀·공급자·서비스 계정 이름은 `deploy.yml`의 `workload_identity_provider`·`service_account`와 같아야 한다.

### 2. npm: Trusted Publishing

1. [npmjs.com/package/@qcard/host/access](https://www.npmjs.com/package/@qcard/host/access) → **Trusted Publisher** → **GitHub Actions**
2. Organization or user `JaesungLeee`, Repository `qcard`, Workflow filename `publish-host.yml`, Environment `npm`
3. 저장. 확인되면 같은 화면의 **Publishing access**를 "Require two-factor authentication and disallow tokens"로 바꾼다(토큰으로 올리는 길을 막는다).

### 3. GitHub: Environments

저장소 → Settings → **Environments**

- `production`: 배포 전에 승인을 받고 싶으면 **Required reviewers**에 본인을 넣는다. 넣지 않으면 푸시하자마자 배포된다. **Deployment branches**를 `main`만으로 제한한다.
- `npm`: **Deployment branches and tags**에 태그 규칙 `host-v*`만 허용한다.

### 4. GitHub: 릴리스 자동화용 PAT

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token
2. Repository access: Only select repositories → `qcard`. 만료는 최대 1년(만료 전에 다시 만든다)
3. Repository permissions: **Contents** Read and write, **Pull requests** Read and write, **Workflows** Read and write(워크플로 파일이 바뀐 브랜치를 푸시할 때 필요)
4. 저장소 → Settings → Secrets and variables → Actions → New repository secret: 이름 `RELEASE_TOKEN`

## 쓰는 법

브랜치·릴리스 흐름은 [branching.md](branching.md).

- Actions → start-release → Run workflow → 열린 PR에서 CHANGELOG 다듬기 → 머지 → back-merge PR 머지. 버전·배포·태그·GitHub Release·npm 배포는 모두 자동이다. Actions 탭에서 진행을 본다.
- 서비스를 다시 배포하려면 Actions → deploy → **Run workflow**에서 브랜치 `main`을 고른다(필요하면 "모두 배포"). 다른 브랜치에서 실행하면 검증만 한다.
- 호스트 npm 배포만 다시 하려면 Actions → publish-host → **Run workflow**에서 태그 `host-v<버전>`을 고르거나, 사람이 그 태그를 푸시한다.

## 실패할 때

- `Permission 'iam.serviceAccounts.getAccessToken' denied`: 1단계 마지막 `workloadIdentityUser` 바인딩이 없거나 저장소 이름이 다르다.
- `does not match the attribute condition`: `main`이 아닌 브랜치에서 deploy 잡이 돌았다(PR은 검증만 한다).
- Functions 배포 중 권한 오류: 오류에 나온 역할을 1단계 서비스 계정에 더한다.
- npm `404`/`ENEEDAUTH`: 2단계 Trusted Publisher의 저장소·워크플로 파일·Environment 이름이 다르다.
- `release-check`나 "배포할 대상·태그 고르기"의 `이미 태그돼 있습니다`: 바뀐 쪽의 `version`이 안 올라갔다. 보통 `prepare-release`가 실패했거나 아직 돌고 있다. 그 실행을 확인하거나 브랜치에 다시 푸시한다.
- `release-check`의 `초안 표시 줄을 지우세요`: `CHANGELOG.md`를 다듬고 `<!-- 초안: … -->` 줄을 지운다.
- start-release·prepare-release의 `Bad credentials`·`403`·`Input required and not supplied: token`: `RELEASE_TOKEN`이 없거나 만료됐거나 권한이 모자라다(4단계).
- "호스트 태그·npm 배포"의 `publish-host 실행을 찾지 못했습니다`: `workflow_dispatch`는 기본 브랜치(`develop`)에 있는 워크플로 파일을 본다. `publish-host.yml`에 `workflow_dispatch`가 `develop`에 들어가 있어야 한다.
- 태그 푸시가 `403`: deploy 잡의 `permissions`에 `contents: write`가 없거나, 저장소 설정 → Actions → General → Workflow permissions가 읽기 전용이다.
