# 실제 Firebase 프로젝트와 배포

운영 프로젝트는 `qcard-d2ade`(`.firebaserc`의 `prod`)다. 지역은 Firestore·Storage·Functions 모두 `asia-northeast3`. 기본 별칭 `default`는 에뮬레이터용 `demo-qcard`라서 `--project prod` 없이 배포하면 실패한다.

평소 배포는 GitHub Actions가 한다: `main`에 푸시하면 바뀐 대상만 배포하고, 태그 `host-v<버전>`이면 npm에 올린다([ci.md](ci.md)). 아래 명령은 손으로 배포할 때이며, 에이전트는 실행하지 않는다(`guard-bash.sh`가 막는다).

## 콘솔에서 한 번 할 일

- Blaze 요금제, Firestore `(default)`·Storage(`qcard-d2ade.firebasestorage.app`)를 `asia-northeast3`에 만든다.
- Authentication → GitHub 공급자. GitHub OAuth App의 callback은 `https://qcard-d2ade.firebaseapp.com/__/auth/handler`.
- Authentication → 설정 → 승인된 도메인에 `qcard.dev`(커스텀 도메인은 자동으로 들어가지 않는다).
- 첫 Functions 배포 뒤 IAM에서 `<프로젝트번호>-compute@developer.gserviceaccount.com`에 **서비스 계정 토큰 생성자** 역할(`hostToken`이 커스텀 토큰을 만든다).
- 테스트 계정 비밀값(F-EX-09)을 봉인할 Cloud KMS 키. 이름은 `apps/functions/src/index.ts`의 상수 `ACCOUNT_KMS_KEY`와 같아야 한다(배포 파라미터로 받지 않는다 — CI의 비대화형 배포가 값을 요구하며 멈춘다). 키가 없으면 계정 등록·배정 함수만 실패하고 나머지는 그대로 돈다.

  ```sh
  gcloud services enable cloudkms.googleapis.com --project qcard-d2ade
  gcloud kms keyrings create qcard --location asia-northeast3 --project qcard-d2ade
  gcloud kms keys create test-accounts --keyring qcard --location asia-northeast3 --purpose encryption --project qcard-d2ade
  gcloud kms keys add-iam-policy-binding test-accounts --keyring qcard --location asia-northeast3 --project qcard-d2ade \
    --member serviceAccount:<프로젝트번호>-compute@developer.gserviceaccount.com --role roles/cloudkms.cryptoKeyEncrypterDecrypter
  ```

- 프로젝트 영구 삭제(F-TM-12, 예약 함수 `purgeDeletedProjects`, 매일 04:00)는 Storage `projects/<id>/` 아래 파일도 지운다. 함수의 서비스 계정에 `storage.objects.delete`가 있어야 한다(기본 compute 계정은 보통 `roles/editor`로 갖고 있다). 확인:

  ```sh
  gcloud functions describe purgeDeletedProjects --region=asia-northeast3 --project=qcard-d2ade \
    --format="value(serviceConfig.serviceAccountEmail)"
  gcloud policy-intelligence troubleshoot-policy iam \
    //storage.googleapis.com/projects/_/buckets/qcard-d2ade.firebasestorage.app \
    --principal-email=<위 결과> --permission=storage.objects.delete
  ```

  버킷의 소프트 삭제 보관 기간은 7일(2026-10-26 확인, `gcloud storage buckets describe gs://qcard-d2ade.firebasestorage.app --format="default(soft_delete_policy)"`)이라 지운 파일은 7일 동안 복구할 수 있는 상태로 남는다. 개인정보처리방침의 삭제 안내와 맞춘다.

## 웹

`apps/web/.env.example`을 `apps/web/.env.production`으로 복사해 `apiKey`·`appId`를 채운다(공개값, gitignore).

```sh
pnpm --filter @qcard/web build
pnpm --filter @qcard/functions build
npx firebase deploy --project prod --only firestore,storage,functions,hosting
```

Functions는 빌드가 만든 `apps/functions/dist/`(번들 + `workspace:*` 없는 package.json)를 올린다. Cloud Build의 npm은 `workspace:*`를 읽지 못한다.

callable 함수의 공개 호출 권한(Cloud Run Invoker `allUsers`)은 CLI가 **처음 만들 때만** 붙인다. 첫 배포가 중간에 실패해 함수가 403을 돌려주면, Cloud Run 서비스 목록에서 함수를 모두 골라 권한 → `allUsers`에 Cloud Run 호출자 역할을 준다.

웹 주소는 `https://qcard.dev`(Hosting 커스텀 도메인, 가비아 DNS). 기본 주소 `qcard-d2ade.web.app`·`qcard-d2ade.firebaseapp.com`으로 들어오면 `apps/web/index.html`의 스크립트가 같은 경로의 `qcard.dev`로 보낸다(로그인 핸들러 `/__/auth/*`는 그대로). Hosting은 모든 경로를 `index.html`로 보낸다(SPA).

개인정보처리방침 `/privacy`·이용약관 `/terms`는 로그인 없이 열린다. 시행일은 2026-11-03(`apps/web/src/features/legal/policy.ts`의 `EFFECTIVE_DATE`, 비우면 두 문서가 "초안"으로 보인다). 내용을 바꾸면 시행일도 새로 정하고 변경 공지 기간을 지킨다. 데이터 처리 방식(수집 항목·보관 위치·삭제)을 바꾸면 `PrivacyPage.tsx`도 함께 고친다.

시작 가이드 `/guide`·스펙 작성 규칙 `/guide/spec`(`apps/web/src/features/guide/`)도 로그인 없이 열린다. 화면 흐름·버튼 이름을 바꾸면 가이드 문구와 스크린샷을 함께 고친다: `pnpm --filter @qcard/web guide:shots`가 `public/guide/*.jpg`를 다시 찍고(공개 화면이라 테스트 데이터의 운영자 실명은 가상 이름으로 바꿔 찍는다), 스펙 파서 형식을 바꾸면 `/guide/spec`을, 하루콩 스펙을 바꾸면 `guide:example`로 예시 ZIP을 다시 만든다.

## 데이터 옮기기

### 준비 플로우를 QA 문서 버전별로 (PRD v0.17)

준비 플로우가 `projects/{p}/prepFlows`에서 `projects/{p}/qaDocs/{d}/prepFlows`로 옮겨 갔다. 새 보안 규칙은 옛 위치를 막으므로, 이 변경이 `main`에 들어가 배포되기 **전에** 사본을 만들고 배포 **뒤에** 옛 위치를 지운다. 사람이 실행한다(`gcloud auth application-default login`).

```sh
pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade              # 미리 보기
pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade --apply      # 배포 전: 버전별 사본 만들기
pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade --delete-old # 배포 뒤: 사본 확인 후 옛 위치 지우기
```

버전마다 그 버전 케이스가 참조하는 플로우를, 어느 케이스도 참조하지 않는 플로우는 최신 버전에 복사한다. 이미 있는 사본은 덮어쓰지 않아 여러 번 실행해도 된다. 이 릴리스의 호스트보다 낮은 호스트는 옛 위치를 읽고 써서 동작하지 않으므로 `MIN_HOST_VERSION`을 올린다([branching.md](branching.md)).

## 호스트 에이전트 (npm `@qcard/host`)

운영 설정은 `apps/host-agent/src/connect.ts`의 `PROD_TARGET`에 들어 있다. 웹 주소·Firebase 프로젝트를 바꾸면 여기도 바꾸고 새 버전을 올린다.

```sh
pnpm --filter @qcard/host bundle                 # apps/host-agent/pkg/ (운영 웹 빌드 포함)
npm publish apps/host-agent/pkg --access public  # npm 조직 qcard, 사람이 직접
```

자세한 내용은 [host-agent.md](host-agent.md#배포-패키지-qcardhost).
