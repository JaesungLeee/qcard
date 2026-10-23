# Firebase 에뮬레이터

**Java 21 이상 필요**(`brew install openjdk@21`). `apps/functions/scripts/emulators.mjs`가 찾아 쓴다. `pnpm verify`의 Functions·보안 규칙·호스트 에이전트 테스트도 에뮬레이터를 띄워 돈다.

## 개발용 — pnpm emu

```sh
pnpm emu
```

- 함수를 번들해 Auth·Firestore·Functions·Storage 에뮬레이터를 띄우고 fixture를 시드한다. Ctrl+C로 종료.
- 프로젝트 `demo-qcard` — 실제 Firebase와 연결되지 않는다.
- 시드 사용자 비밀번호 `qcard-dev`.
- `QCARD_EMU_DEBUG=1 pnpm emu`면 CLI 디버그 로그.
- 웹을 이 에뮬레이터에 붙이려면 `pnpm dev:firebase`(`VITE_DATA=firebase`). 로그인 화면에서 시드 사용자를 고른다. `pnpm dev`·`ui:snap`은 계속 메모리 구현을 쓴다.

## 테스트용

`firebase.test.json`(프로젝트 `demo-qcard-test`, 개발용과 다른 포트)으로 Firestore·Storage만 띄운다.

## 임시 폴더 분리

에뮬레이터마다 임시 폴더를 따로 쓴다(`emulators.mjs`의 `TMPDIR`). 같은 폴더를 쓰면 `pnpm verify`의 테스트 에뮬레이터가 끝날 때 개발용 Storage 폴더까지 지워져, 다음 업로드에서 개발용 에뮬레이터가 통째로 죽었다.
