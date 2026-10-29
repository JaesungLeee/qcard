# 호스트 에이전트

호스트 에이전트(`apps/host-agent`)는 사이클 케이스를 실기기에서 `runCase`로 실행하고 Run 진행·결과를 Firestore에, 스크린샷을 Storage에 올린다(`runCycle`·`firestoreSink`). 웹에서 요청한 QA 문서 생성·케이스 수정안(F-QD-17) 작업도 받아 처리한다(`jobs.ts`·`serve`). 플랜 한도·로그인 문제·디바이스 잠김이면 일시정지한다.

저장소의 pnpm 스크립트는 개발용 에뮬레이터에 붙으므로 `pnpm emu`가 떠 있어야 한다([emulators.md](emulators.md)). 사용자에게 배포하는 `qcard` 명령(npm `@qcard/host`, 진입점 `src/main.ts`)은 같은 코드를 운영 서비스로 실행한다 — 아래 [배포 패키지](#배포-패키지-qcardhost).

## connect — 이 PC를 계정에 연결 (F-TM-14)

호스트는 GitHub로 따로 로그인하지 않는다. 웹에서 이 PC를 계정에 한 번 연결해 두면, 켤 때마다 그 자격으로 접속한다.

```sh
pnpm --filter @qcard/host connect      # 브라우저가 열리면 [이 PC 연결]
pnpm --filter @qcard/host connect --force   # 이미 연결돼 있어도 다시 연결 (다른 계정으로 바꿀 때)
pnpm --filter @qcard/host status       # 연결된 계정 확인
pnpm --filter @qcard/host disconnect   # 이 PC의 연결 해제
```

- `connect`는 127.0.0.1에 임시 서버를 열고 웹의 `/connect?port&nonce&name`을 연다. [이 PC 연결]을 누르면 Functions `pairHost`가 호스트 자격을 만들고, 웹이 그 자격을 임시 서버로 폼 POST한다(Origin·Host·nonce 확인). 자격은 macOS 키체인(`qcard-host`, 계정 = Firebase 프로젝트 id)에 둔다.
- `pairHost`는 누를 때마다 새 연결을 만든다. 그래서 `connect`는 먼저 보관한 자격으로 로그인해 보고, 연결돼 있으면 그대로 끝낸다(`connectHost`). 웹에서 해제된 자격은 지우고 새로 연결한다. `--force`면 새로 연결해 자격을 저장한 뒤 예전 연결을 `revokeHost`로 해제한다(실패하면 웹에서 해제하라고 안내).
- 켤 때마다 Functions `hostToken`으로 짧은 수명의 로그인 토큰(`host` 클레임)을 받는다. 보안 규칙은 `hostConnections/{hostId}`가 있을 때만 이 토큰을 통과시키므로, 웹의 [연결된 PC]에서 해제하면 바로 막힌다.
- 붙을 곳(`targetFromEnv`): `QCARD_FIREBASE_CONFIG`(웹 설정 JSON) + `QCARD_WEB_URL` > `QCARD_TARGET=prod`(운영 `qcard-d2ade`, `qcard` 명령의 기본값) > 개발용 에뮬레이터와 `http://localhost:5173`(`pnpm dev:firebase`).
- 운영에서 `hostToken`이 커스텀 토큰을 만들려면 Functions 서비스 계정에 "서비스 계정 토큰 생성자" 권한이 필요하다.

**개발 단축**: 에뮬레이터에서는 `serve`·`run-cycle`에 `--user <시드 GitHub 사용자명>`을 주면 브라우저 없이 그 사용자로 연결한다(자격은 키체인 계정 `demo-qcard:<사용자명>`에 두고, 에뮬레이터를 다시 띄워 연결이 없어지면 자동으로 다시 연결).

## serve — 상주 모드 (실행자가 쓰는 경로)

```sh
pnpm --filter @qcard/host serve                    # connect로 연결한 PC
pnpm --filter @qcard/host serve --user jaesung-lee # 개발: 에뮬레이터 시드 사용자
```

- **로컬 콘솔**을 띄워 두고 한 번만 쓸 수 있는 주소를 출력한다. 열면 [로컬 콘솔 열기] 버튼이 나온다 — 링크 미리보기가 먼저 열어도 토큰이 남는다. 터미널에서 Enter = 새 주소.
- 콘솔 홈에서 연결된 폰 화면을 실시간으로 보고, 이 폰이 대상인 사이클을 골라(케이스 선택 가능) Run을 시작하거나 일시정지된 Run을 이어서 실행한다.
- 폰 화면 꺼짐·잠김은 5초마다 확인한다.
- 30초마다 연결 신호(연결된 디바이스 포함 — 웹이 사이클 대상을 고를 때 쓴다)를 보낸다. 처리할 수 있는 작업 종류(`jobs`, `HOST_JOBS`)도 함께 보낸다 — 웹은 이 목록이 없는 옛 호스트에 새 종류의 작업을 맡기지 않고 업데이트를 안내한다. 작업 종류를 추가하면 `HOST_JOBS`에 넣는다.
- 웹에서 요청한 내 QA 문서 생성 작업을 받아 이 PC의 Claude Code로 처리한다(플랜 사용량 차감). 작업별 호출 녹화는 `~/.qcard/jobs/` — 일시정지 후 다시 시도하면 끝난 호출은 재생한다.
  생성하는 동안 작업 문서 아래 `specs`(생성 계획)·`drafts`(케이스 초안)·`events`(진행 기록)를 써서 웹의 작업 상세 화면(`/p/<프로젝트>/docs/jobs/<작업>`)에 보인다. 기록 id가 정해져 있어 다시 시도해도 같은 기록이 두 번 생기지 않는다.
- 케이스 수정안 작업(`case_revise`)은 QA 문서와 출처 스펙 묶음을 읽어 수정안을 작업 결과에만 쓴다. 케이스는 바꾸지 않고, 요청자가 웹 질문 탭에서 적용한다. 작업은 한 번에 하나씩이며, 하나가 끝날 때마다 대기열을 다시 읽어 수정안을 QA 문서 생성보다 먼저 가져간다(진행 중인 생성은 끊지 않는다).

## run-cycle — 개발·자동화용

같은 일을 `serve`의 로컬 콘솔에서 한다.

```sh
pnpm --filter @qcard/host run-cycle --project haru --cycle cycle-130-device --user jaesung-lee [TC-ID…] [--package <앱>]
```

연결된 실기기에서 사이클 케이스를 실행해 에뮬레이터에 올린다(웹 QA 시트에 바로 보임, 플랜 사용량 차감).

- **대상 디바이스**: 디바이스가 사이클 대상(모델 + OS 메이저)이어야 한다. 개발 시드의 `cycle-130-device`는 SM-S711N 대상.
- **완료된 사이클 (F-CY-09)**: 새 Run도, 일시정지된 Run 이어서 실행도 시작하지 않는다(`prepareCycleRun`). 콘솔 홈에도 보이지 않는다. 웹에서 다시 열면 실행할 수 있다. 실행 중에 완료된 Run은 끝까지 결과를 올린다(보안 규칙은 새 Run 문서만 막는다).
- **빌드 설치**: 사이클 빌드(APK)가 디바이스의 앱과 다른 버전이면 내려받아(해시 확인, `~/.qcard/builds`) `install -r`로 설치한다. 낮은 버전·다른 서명은 앱 데이터가 지워져야 해서 자동으로 하지 않고 멈춘다.
- **업로드 큐**: 결과·증거는 `~/.qcard/upload-queue/<프로젝트>/<사용자 uid>`를 거쳐 끊겨도 다음 실행 때 이어 보낸다. 보안 규칙이 거절한 작업(연결 해제된 PC, 예전 Run, 권한 없는 역할)은 `dropped/`로 빼고 다음 작업을 보낸다 — 이번 Run의 작업이 거절됐으면 그 Run은 멈춘다.
- **일시정지·재개**: `--resume <run id>`. 케이스마다 폰 화면이 꺼졌거나 잠겼으면 LLM을 부르기 전에 일시정지한다(연결이 끊겨도 일시정지).
- **화면 켜짐 유지**: Run 동안 폰의 "충전 중 화면 켜짐 유지"(`stay_on_while_plugged_in`)를 켜서 도중에 잠기지 않게 하고 끝나면 되돌린다. 못 되돌렸으면 `~/.qcard/stay-awake`에 남겨 다음 시작 때 복구한다. 잠긴 폰을 adb로 풀지는 않는다 — 시작할 때는 잠금이 풀려 있어야 한다.
- **로컬 콘솔**: 함께 띄우고(127.0.0.1:4801, `QCARD_CONSOLE_PORT`) 한 번만 열 수 있는 주소를 출력한다. `--headless`면 콘솔 없이.

## 로컬 콘솔

코드는 `apps/host-agent/src/console/`(서버)와 `apps/web/src/features/console/`(화면).

- 127.0.0.1 서버. 일회용 토큰 → 쿠키, Host/Origin 검사.
- 실행 상태 허브와 제어: 실시간 화면·사고 로그·일시정지·Take over·건너뛰기·중단·수동 스텝 [완료].
- **위험 액션 (F-EX-10)**: Executor가 멈추면 승인 카드가 뜬다. 승인 필요 = [승인](Agent가 그 액션 한 번만 실행) 또는 [직접 실행] → [Agent에 반환], 사람 전용(본인인증 등) = [직접 실행]만. 10분 안에 답이 없으면 그 케이스 Blocked, 직접 실행 중에는 시간을 재지 않는다. 기다리는 동안 Run 문서에 `waiting`을 남겨 웹에 "승인 대기"가 보인다(승인은 콘솔에서만). 판별은 `packages/agent/src/risk.ts`(코드 안전장치·등급·사전 승인)와 Agent의 `risk` 표시.
- **테스트 계정 (F-PF-04·08·09)**: 케이스에 계정 종류가 있으면 `RunAccounts`(`src/accounts.ts`)가 Functions `claimAccount`로 계정을 받아 비밀값을 Run의 `SecretVault`(메모리)에 넣는다. Agent에는 로그인 ID와 `{{secret.password}}`·`{{secret.totp}}` 플레이스홀더만 가고, TOTP 코드는 입력할 때 계산한다. 같은 종류면 이어 쓰고 종류가 바뀌거나 Run이 끝나면 `releaseAccount`로 반납한다. 로그인 준비 플로우가 실패하면 로그인 실패 표시, 원복 플로우가 실패하거나 원복 중에 멈추면 격리로 반납한다. 빈 계정이 없으면 LLM을 부르지 않고 Blocked("계정 없음"). 홈의 사이클 카드는 남은 케이스에 필요한데 배정할 계정이 없는 종류를 미리 알린다.
- **칸 자동 선점 (F-CY-06)**: 케이스마다 업로드 큐를 비운 뒤(앞 케이스 결과가 먼저 올라가게) Functions `claimCell`로 "케이스 × 대상 디바이스" 칸을 잡는다(`src/cells.ts`, `runCycle.ts`). 잠금은 Run 문서의 `currentTcId`이고 값은 Functions만 정한다 — 호스트는 지우기만 한다(보안 규칙). 같은 대상 디바이스의 다른 Run이 잡았거나 끝낸 칸은 결과 없이 건너뛰고 콘솔 큐에서 뺀다. 칸을 잡지 못할 만큼 네트워크가 끊기면 "네트워크 끊김"으로 일시정지. 연결 신호(하트비트)는 업로드 큐를 거치지 않고 바로 보내며(`UploadQueue.sendNow`), 케이스 도중 신호를 60초(`LEASE_LOST_MS`) 넘게 남기지 못했으면 — 네트워크 끊김·PC 절전 — 다른 Run이 칸을 가져갔을 수 있어 다음 턴에서 멈추고 결과를 버린 뒤 "호스트 연결 끊김"으로 일시정지한다.
- 실시간 화면은 scrcpy 중계(`brew install scrcpy`). 서버 파일을 폰 `/data/local/tmp`에 올렸다가 지운다. 콘솔에서 화면을 보는 동안만 띄우고, 마지막 화면을 닫고 30초 뒤 끈다(`OnDemandScreen`) — 폰을 꽂아 두기만 해서는 인코딩이 돌지 않는다.
- `pnpm dev`가 떠 있으면 그 주소(`/console/live`, Vite가 `/console-api`를 넘김)를 쓴다.
- 웹의 `/console`은 fixture 재생, `/console/live?demo=<상태>`는 서버 없이 상태별 화면을 본다(ui:snap용).

## 배포 패키지 `@qcard/host`

사용자는 저장소 없이 `npm i -g @qcard/host`로 설치하고 `qcard <명령>`으로 쓴다(macOS, Node 22+).

| 명령                                                    | 저장소 스크립트                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `qcard connect [--force]` · `status` · `disconnect`     | `pair.ts`                                                                   |
| `qcard serve [--serial] [--allow-network] [--headless]` | `serve.ts`                                                                  |
| `qcard doctor`                                          | adb·Claude Code·scrcpy 점검 (`serve`도 시작할 때 확인, adb가 없으면 멈춘다) |

- 저장소에서 같은 명령을 운영으로 돌려 보려면 `pnpm --filter @qcard/host qcard <명령>`.
- `qcard`(`QCARD_CLI`)는 개발 서버(5173)를 찾지 않고, `qcard.local.json`의 devApp도 쓰지 않는다. `run-cycle`·`--user`는 저장소 전용.
- 로컬 콘솔은 패키지에 넣은 운영 웹 빌드(`dist/web`)를 준다. `/console/live`는 웹 로그인 밖이라(일회용 주소·쿠키로 확인) 127.0.0.1에서도 열린다.
- 만들기: `pnpm --filter @qcard/host bundle` → `apps/host-agent/pkg/`. npm 페이지 README는 `apps/host-agent/README.npm.md`. 웹을 `apps/web/.env.production`으로 빌드한 뒤 esbuild로 내부 패키지까지 묶는다(설치할 의존성 없음). 운영 웹 빌드가 아니면 멈춘다.
- 시험: `npm pack apps/host-agent/pkg` → `npm i -g --prefix <임시 폴더> ./qcard-host-<버전>.tgz` → `<임시 폴더>/bin/qcard status`.
- 올리기(사람이 직접): `apps/host-agent/package.json`의 `version`을 올리고 bundle → `npm publish apps/host-agent/pkg --access public`.
