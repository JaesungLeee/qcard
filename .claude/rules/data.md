---
paths:
  - 'packages/data/**'
  - 'apps/functions/**'
  - 'apps/web/src/data/**'
  - 'firebase/**'
  - 'firebase*.json'
---

# 데이터·Firebase 규칙

- 화면은 `QcardApi`(`packages/data/src/api.ts`)만 알고, 구현은 둘이다: 메모리(`apps/web/src/data/memory.ts`, fixture)와 Firestore(`@qcard/data/firebase`, 읽기는 Firestore·프로젝트/멤버/초대 쓰기는 callable 함수).
- 웹 쪽 `apps/web/src/data/`: 메모리 구현(`memory.ts`), 브라우저 Firebase 연결(`firebaseClient.ts`), 훅(`hooks.ts`). `api.ts`는 `@qcard/data` 재수출. `@qcard/data`는 웹·호스트 에이전트·테스트가 함께 쓴다.
- 두 구현이 함께 쓰는 계산은 `packages/data/src/logic.ts`, 프로젝트·멤버·초대 규칙은 `@qcard/shared` membership. 한쪽에만 로직을 넣지 않는다.
- Functions는 membership 규칙을 트랜잭션에서 강제한다. LLM은 부르지 않는다.
- Firestore 구현은 `apps/functions/test/web-api.test.ts`가 에뮬레이터에서 메모리 구현과 결과를 비교한다. `QcardApi`를 바꾸면 이 테스트도 함께 맞춘다.
- 보안 규칙은 `firebase/firestore.rules`·`storage.rules`, 테스트는 에뮬레이터(`firebase.test.json`, 포트는 실행마다 빈 포트로 바뀐다 — 테스트에 포트를 적지 않는다).
- 에뮬레이터마다 임시 폴더를 따로 쓴다(`apps/functions/scripts/emulators.mjs`의 `TMPDIR`). 같은 폴더를 쓰면 `pnpm verify`의 테스트 에뮬레이터가 끝날 때 개발용 Storage 폴더까지 지워진다. 이 분리를 없애지 않는다.

에뮬레이터 실행·시드는 [docs/dev/emulators.md](../../docs/dev/emulators.md).
