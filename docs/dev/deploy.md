# 실제 Firebase 프로젝트와 배포

운영 프로젝트는 `qcard-d2ade`(`.firebaserc`의 `prod`)다. 지역은 Firestore·Storage·Functions 모두 `asia-northeast3`. 기본 별칭 `default`는 에뮬레이터용 `demo-qcard`라서 `--project prod` 없이 배포하면 실패한다.

평소 배포는 GitHub Actions가 한다: `main`에 푸시하면 바뀐 대상만 배포하고, 태그 `host-v<버전>`이면 npm에 올린다([ci.md](ci.md)). 아래 명령은 손으로 배포할 때이며, 에이전트는 실행하지 않는다(`guard-bash.sh`가 막는다).

## 콘솔에서 한 번 할 일

- Blaze 요금제, Firestore `(default)`·Storage(`qcard-d2ade.firebasestorage.app`)를 `asia-northeast3`에 만든다.
- Authentication → GitHub 공급자. GitHub OAuth App의 callback은 `https://qcard-d2ade.firebaseapp.com/__/auth/handler`.
- Authentication → 설정 → 승인된 도메인에 `qcard.dev`(커스텀 도메인은 자동으로 들어가지 않는다).
- 첫 Functions 배포 뒤 IAM에서 `<프로젝트번호>-compute@developer.gserviceaccount.com`에 **서비스 계정 토큰 생성자** 역할(`hostToken`이 커스텀 토큰을 만든다).

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

## 호스트 에이전트 (npm `@qcard/host`)

운영 설정은 `apps/host-agent/src/connect.ts`의 `PROD_TARGET`에 들어 있다. 웹 주소·Firebase 프로젝트를 바꾸면 여기도 바꾸고 새 버전을 올린다.

```sh
pnpm --filter @qcard/host bundle                 # apps/host-agent/pkg/ (운영 웹 빌드 포함)
npm publish apps/host-agent/pkg --access public  # npm 조직 qcard, 사람이 직접
```

자세한 내용은 [host-agent.md](host-agent.md#배포-패키지-qcardhost).
