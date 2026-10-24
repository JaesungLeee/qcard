# 실제 Firebase 프로젝트와 배포

운영 프로젝트는 `qcard-d2ade`(`.firebaserc`의 `prod`)다. 지역은 Firestore·Storage·Functions 모두 `asia-northeast3`. 기본 별칭 `default`는 에뮬레이터용 `demo-qcard`라서 `--project prod` 없이 배포하면 실패한다.

배포는 사람이 직접 실행한다(`guard-bash.sh`가 막는다).

## 콘솔에서 한 번 할 일

- Blaze 요금제, Firestore `(default)`·Storage(`qcard-d2ade.firebasestorage.app`)를 `asia-northeast3`에 만든다.
- Authentication → GitHub 공급자. GitHub OAuth App의 callback은 `https://qcard-d2ade.firebaseapp.com/__/auth/handler`.
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

웹 주소는 `https://qcard-d2ade.web.app`. Hosting은 모든 경로를 `index.html`로 보낸다(SPA).

## 호스트 에이전트

실제 프로젝트에 붙이려면 웹 설정과 웹 주소를 환경변수로 준다(없으면 에뮬레이터). 패키징하면 기본값으로 넣는다.

```sh
QCARD_FIREBASE_CONFIG='{"apiKey":"…","authDomain":"qcard-d2ade.firebaseapp.com","projectId":"qcard-d2ade","storageBucket":"qcard-d2ade.firebasestorage.app","appId":"…"}' \
QCARD_WEB_URL=https://qcard-d2ade.web.app \
pnpm --filter @qcard/host-agent connect
```
