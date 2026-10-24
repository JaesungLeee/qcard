# CI·자동 배포 (GitHub Actions)

| 워크플로                             | 언제                         | 하는 일                                                                                    |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `.github/workflows/deploy.yml`       | `main` 푸시 · PR · 수동 실행 | `pnpm verify` → (`main`만) 바뀐 대상만 운영 배포. 수동 실행에서 "모두 배포"를 고를 수 있다 |
| `.github/workflows/publish-host.yml` | 태그 `host-v<버전>` 푸시     | 버전 확인 → `pnpm verify` → `bundle` → `npm publish`                                       |

배포 대상은 마지막으로 성공한 deploy 실행 이후 바뀐 것으로 고른다(실패한 실행의 변경도 다음 성공 때 함께 나간다): 웹·패키지 소스 → `hosting`, Functions·그 의존 패키지 소스 → `functions`, `firebase/firestore*` → `firestore`, `firebase/storage*` → `storage`. 테스트·문서만 바뀌면 배포하지 않는다.

인증 정보(키·토큰)는 저장소에 없다. Google Cloud는 Workload Identity Federation, npm은 Trusted Publishing으로 GitHub Actions의 OIDC 토큰만 믿는다.

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

## 쓰는 법

- 웹·규칙·Functions 배포: `main`에 푸시하면 끝. Actions 탭에서 진행을 본다. 다시 배포하려면 Actions → deploy → **Run workflow**(필요하면 "모두 배포").
- 호스트 에이전트 새 버전: `apps/host-agent/package.json`의 `version`을 올려 커밋·푸시한 뒤

  ```sh
  git tag host-v0.1.4 && git push origin host-v0.1.4
  ```

## 실패할 때

- `Permission 'iam.serviceAccounts.getAccessToken' denied`: 1단계 마지막 `workloadIdentityUser` 바인딩이 없거나 저장소 이름이 다르다.
- `does not match the attribute condition`: `main`이 아닌 브랜치에서 deploy 잡이 돌았다(PR은 검증만 한다).
- Functions 배포 중 권한 오류: 오류에 나온 역할을 1단계 서비스 계정에 더한다.
- npm `404`/`ENEEDAUTH`: 2단계 Trusted Publisher의 저장소·워크플로 파일·Environment 이름이 다르다.
