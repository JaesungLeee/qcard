# 호스트 에이전트

호스트 에이전트(`apps/host-agent`)는 사이클 케이스를 실기기에서 `runCase`로 실행하고 Run 진행·결과를 Firestore에, 스크린샷을 Storage에 올린다(`runCycle`·`firestoreSink`). 웹에서 요청한 QA 문서 생성 작업도 받아 처리한다(`jobs.ts`·`serve`). 플랜 한도·로그인 문제·디바이스 잠김이면 일시정지한다.

두 명령 모두 `pnpm emu`가 떠 있어야 한다([emulators.md](emulators.md)).

## serve — 상주 모드 (실행자가 쓰는 경로)

```sh
pnpm --filter @qcard/host-agent serve --user jaesung-lee
```

- **로컬 콘솔**을 띄워 두고 한 번만 쓸 수 있는 주소를 출력한다. 열면 [로컬 콘솔 열기] 버튼이 나온다 — 링크 미리보기가 먼저 열어도 토큰이 남는다. 터미널에서 Enter = 새 주소.
- 콘솔 홈에서 연결된 폰 화면을 실시간으로 보고, 이 폰이 대상인 사이클을 골라(케이스 선택 가능) Run을 시작하거나 일시정지된 Run을 이어서 실행한다.
- 폰 화면 꺼짐·잠김은 5초마다 확인한다.
- 30초마다 연결 신호(연결된 디바이스 포함 — 웹이 사이클 대상을 고를 때 쓴다)를 보낸다.
- 웹에서 요청한 내 QA 문서 생성 작업을 받아 이 PC의 Claude Code로 처리한다(플랜 사용량 차감). 작업별 호출 녹화는 `~/.qcard/jobs/` — 일시정지 후 다시 시도하면 끝난 호출은 재생한다.

## run-cycle — 개발·자동화용

같은 일을 `serve`의 로컬 콘솔에서 한다.

```sh
pnpm --filter @qcard/host-agent run-cycle --project haru --cycle cycle-130-device --user jaesung-lee [TC-ID…] [--package com.example.harukong.qa]
```

연결된 실기기에서 사이클 케이스를 실행해 에뮬레이터에 올린다(웹 QA 시트에 바로 보임, 플랜 사용량 차감).

- **대상 디바이스**: 디바이스가 사이클 대상(모델 + OS 메이저)이어야 한다. 개발 시드의 `cycle-130-device`는 SM-S711N 대상.
- **빌드 설치**: 사이클 빌드(APK)가 디바이스의 앱과 다른 버전이면 내려받아(해시 확인, `~/.qcard/builds`) `install -r`로 설치한다. 낮은 버전·다른 서명은 앱 데이터가 지워져야 해서 자동으로 하지 않고 멈춘다.
- **업로드 큐**: 결과·증거는 `~/.qcard/upload-queue`를 거쳐 끊겨도 다음 실행 때 이어 보낸다.
- **일시정지·재개**: `--resume <run id>`. 케이스마다 폰 화면이 꺼졌거나 잠겼으면 LLM을 부르기 전에 일시정지한다(연결이 끊겨도 일시정지).
- **화면 켜짐 유지**: Run 동안 폰의 "충전 중 화면 켜짐 유지"(`stay_on_while_plugged_in`)를 켜서 도중에 잠기지 않게 하고 끝나면 되돌린다. 못 되돌렸으면 `~/.qcard/stay-awake`에 남겨 다음 시작 때 복구한다. 잠긴 폰을 adb로 풀지는 않는다 — 시작할 때는 잠금이 풀려 있어야 한다.
- **로컬 콘솔**: 함께 띄우고(127.0.0.1:4801, `QCARD_CONSOLE_PORT`) 한 번만 열 수 있는 주소를 출력한다. `--headless`면 콘솔 없이.

## 로컬 콘솔

코드는 `apps/host-agent/src/console/`(서버)와 `apps/web/src/features/console/`(화면).

- 127.0.0.1 서버. 일회용 토큰 → 쿠키, Host/Origin 검사.
- 실행 상태 허브와 제어: 실시간 화면·사고 로그·일시정지·Take over·건너뛰기·중단·수동 스텝 [완료].
- 실시간 화면은 scrcpy 중계(`brew install scrcpy`). 서버 파일을 폰 `/data/local/tmp`에 올렸다가 지운다.
- `pnpm dev`가 떠 있으면 그 주소(`/console/live`, Vite가 `/console-api`를 넘김)를 쓴다.
- 웹의 `/console`은 fixture 재생, `/console/live?demo=<상태>`는 서버 없이 상태별 화면을 본다(ui:snap용).
