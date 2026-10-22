# qcard

스펙 문서로 앱 버전별 QA 문서를 만들고, Agent가 Android 디바이스에서 직접 수행하는 QA 자동화 플랫폼. 1인 사이드 프로젝트.
제품 요구사항은 [docs/PRD.md](docs/PRD.md)가 기준이다. 62KB라 통째로 읽지 말고 필요한 절(§)만 찾아 읽는다.

## 구조

pnpm workspace + Turborepo, TypeScript 단일 언어.

| 경로                    | 내용                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`              | 웹 대시보드 (React 18 + Vite + react-router 7 + TanStack Query). `/__ui`는 UI 카탈로그                                                                                                                                       |
| `apps/web/src/data`     | fixture 메모리 구현(`memory.ts`), 브라우저 Firebase 연결(`firebaseClient.ts`), 훅(`hooks.ts`). `api.ts`는 `@qcard/data` 재수출                                                                                               |
| `apps/web/src/features` | 화면 단위 폴더: `qa-sheet`(사이클·QA 시트·판정 추적), `qa-doc`(QA 문서 검토·승인), `console`(로컬 콘솔)                                                                                                                      |
| `packages/ui`           | 디자인 시스템 "Montage for qcard" — Montage 컴포넌트 재수출, `--qc-*` 토큰, `VerdictBadge`                                                                                                                                   |
| `packages/shared`       | 도메인 스키마(Zod, PRD §6.4)와 표시용 라벨                                                                                                                                                                                   |
| `packages/fixtures`     | 하루콩 onboarding-flow 스펙에서 만든 결정적 데이터(QA 문서·사이클·결과·콘솔 세션)와 목업 디바이스 화면 배치                                                                                                                    |
| `packages/device`       | `DeviceDriver` 인터페이스, 접근성 트리 파서, `AdbDriver`·녹화(`@qcard/device/node`), `FakeDevice`(화면 + 전환 규칙 상태 기계)                                                                                                |
| `packages/llm`          | `LlmClient`(SDK 타입 그대로), 실제 호출 구현 2개(본인 Claude Code `claude -p` = 기본·제품 경로 / API 키 = 개발용), 녹화·재생(cassette), 사용량·한도, 비밀값 검사, strict 도구·출력 스키마 변환                               |
| `packages/agent`        | Executor 루프(`runSteps`), 검증 포인트 판정(`verifyPoints`·`settle`), 판정 집계(`judge`), 케이스 실행(`runCase`). `e2e/`는 합성 온보딩 앱 + 실제 모델 녹화 재생                                                              |
| `apps/functions`        | Cloud Functions: 프로젝트·멤버·초대 쓰기(callable, `@qcard/shared` membership 규칙을 트랜잭션에서 강제), 삭제 유예 지난 프로젝트 영구 삭제. LLM은 부르지 않는다. 보안 규칙은 `firebase/firestore.rules`, 테스트는 에뮬레이터 |
| `apps/host-agent`       | 호스트 에이전트: 사이클 케이스를 실기기에서 `runCase`로 실행하고 Run 진행·결과를 Firestore, 스크린샷을 Storage에 올린다(`runCycle`·`firestoreSink`). 플랜 한도·로그인 문제면 Run 일시정지                                    |
| `packages/data`         | 데이터 접근 인터페이스 `QcardApi`·오류(`api.ts`), 구현 공용 계산(`logic.ts`), Firestore 구현(`@qcard/data/firebase`), 에뮬레이터 시드(`@qcard/data/seed`). 웹·호스트 에이전트·테스트가 함께 쓴다                             |
| `packages/spec`         | 스펙 파서(`spec.md` → 요구사항·TS/EC 행·출처 위치·행 해시)와 버전 매칭(출처 ID로 동일·변경·신규·삭제, TC ID 이어받기, F-QD-08). LLM 없음                                                                                     |
| `packages/qadoc`        | QA Doc Generator: 스펙 묶음 + 이전 QA 문서 → 새 QA 문서. 매칭·복사·ID·해시·승인 상태는 코드, 신규·변경 행의 케이스 변환·준비 플로우·확인 질문·보강 제안은 Opus(`prompts.ts`). Firestore를 모른다                            |

Agent 도구·Verifier 출력 스키마는 `packages/shared/src/agent.ts`, 온보딩 합성 시나리오(FakeDevice용)는 `packages/fixtures/src/device.ts`.

화면은 `QcardApi`만 알고, 구현은 둘이다: 메모리(`memory.ts`, fixture, 새로고침하면 초기화)와 Firestore(`firebase.ts`, 읽기는 Firestore·프로젝트/멤버/초대 쓰기는 callable 함수). 두 구현이 함께 쓰는 계산은 `data/logic.ts`, 프로젝트·멤버·초대 규칙은 `@qcard/shared` membership. Firestore 구현은 `apps/functions/test/web-api.test.ts`가 에뮬레이터에서 메모리 구현과 결과를 비교한다. fixture와 `packages/agent/cassettes/`는 하루콩 팀 스펙에서 파생됐으므로 저장소를 공개하기 전에 빼야 한다.

## 명령

pnpm이 전역에 없으면 `npx -y pnpm@10.34.6 <명령>`으로 실행한다.

- `pnpm verify` — 타입 검사 + 테스트 + 색 하드코딩 검사. **작업을 끝내기 전에 반드시 통과**(Stop 훅이 강제한다). Functions·보안 규칙 테스트는 Firestore 에뮬레이터를 띄워 돈다 — **Java 21 이상 필요**(`brew install openjdk@21`, `apps/functions/scripts/emulators.mjs`가 찾아 쓴다)
- `pnpm emu` — 함수를 번들해 Auth·Firestore·Functions 에뮬레이터를 띄우고 fixture를 시드한다(프로젝트 `demo-qcard`, 실제 Firebase와 연결되지 않음, Ctrl+C로 종료). 시드 사용자 비밀번호 `qcard-dev`
- `pnpm --filter @qcard/host-agent run-cycle --project haru --cycle cycle-130-device --user jaesung-lee [TC-ID…] [--package com.example.harukong.qa]` — 연결된 실기기에서 사이클 케이스를 실행해 에뮬레이터에 올린다(웹 QA 시트에 바로 보임, 플랜 사용량 차감). 디바이스가 사이클 대상(모델 + OS 메이저)이어야 한다 — 개발 시드의 `cycle-130-device`는 SM-S711N 대상. `pnpm emu`가 떠 있어야 한다. 결과·증거는 업로드 큐(`~/.qcard/upload-queue`)를 거쳐 끊겨도 다음 실행 때 이어 보낸다. `--resume <run id>`로 일시정지 후 재개
- `pnpm --filter @qcard/functions seed-generated <결과.json…>` — `qadoc generate` 결과를 실행 중인 에뮬레이터에 별도 프로젝트(`haru-gen`)로 넣는다(기존 시드는 그대로)
- `pnpm --filter @qcard/spec check <docs/specs 폴더> [--prev <이전 버전 폴더>]` — 실제 스펙 폴더를 파싱해 개수·경고와 이전 버전 대비 동일·변경·신규·삭제를 보인다(읽기 전용, LLM 없음). 하루콩 스펙은 저장소 밖 `../qcard-specs/`에 둔다(커밋하지 않음)
- `pnpm --filter @qcard/qadoc generate <docs/specs 폴더> --out <결과.json> [--only a,b] [--prev-doc <이전 결과.json> --prev <이전 스펙 폴더>]` — 실제 스펙으로 QA 문서를 만들어 JSON으로 쓴다(Opus, 플랜 사용량 차감, Firestore에 올리지 않음). 호출은 `../qcard-specs/cassettes/qadoc`에 녹화돼 같은 요청은 재생하므로 중단해도 이어 간다. 프롬프트를 바꾸면 바뀐 호출만 다시 부른다
- `pnpm dev:firebase` — 웹을 Firebase 모드(`VITE_DATA=firebase`)로 띄운다. `pnpm emu`가 떠 있어야 하고, 로그인 화면에서 시드 사용자를 고른다. `pnpm dev`·`ui:snap`은 계속 메모리 구현을 쓴다
- `pnpm ui:snap` — `/__ui` 등 화면을 데스크톱·좁은 폭 × 라이트·다크로 찍어 `apps/web/.snap/*.png`에 저장
- `pnpm tokens` — `packages/ui/tokens/tokens.json` → `src/generated/` 재생성
- `pnpm dev` — 웹 개발 서버 (http://localhost:5173). `packages/agent/runs/`의 실기기 실행을 "로컬 실행" 사이클로 함께 보여 준다(`apps/web/vite/local-runs.ts`, 개발 서버 전용)
- `pnpm --filter @qcard/agent sample-runs` — ui:snap용 로컬 실행 샘플(`apps/web/e2e/runs-sample/`)을 녹화 재생으로 다시 만든다. Agent 결과 형식을 바꾸면 돌린다
- `pnpm device:check` — 실기기 점검(연결·기기 정보·앱 설치·IME·덤프 속도). 읽기 전용
- `pnpm --filter @qcard/agent device-run <TC-ID…> [--package com.example.harukong.qa]` — 실기기에서 케이스 실행(실제 모델, 사용자 플랜 사용량 차감). 플랜 한도·로그인 만료면 일시정지하고 `--resume <실행 id>`로 이어 간다. 결과·스크린샷은 `packages/agent/runs/`(커밋 안 함). 지정한 앱만 `pm clear`한다
- `pnpm device:record <화면 이름> [--set <묶음>]` — 실기기의 지금 화면(스크린샷 + 트리)을 `packages/device/recordings/`에 저장 (커밋 안 함, 읽기 전용 명령만 씀)
- `pnpm llm:smoke` — Claude Code 설치·로그인 상태와 실제 모델의 도구·출력 스키마 확인 (호출 2번, 플랜 사용량 차감)
- `pnpm --filter @qcard/agent record [TC-ID…]` — e2e 케이스를 실제 모델로 다시 녹화 (`packages/agent/cassettes/<시나리오>/`). Agent 프롬프트·도구·관찰 형식을 바꾸면 요청이 달라져 재생 테스트가 실패하므로 다시 녹화한다 (플랜 사용량 차감)
- LLM 모드는 `LLM_MODE=replay`(기본, 녹화 없으면 실패)·`record`·`live`. 테스트는 항상 replay
- 실제 호출 제공자는 `LLM_PROVIDER=claude-cli`(기본: 같은 PC의 Claude Code를 본인 플랜으로)·`api`(ANTHROPIC_API_KEY, 비용 발생). claude-cli는 내장 도구·MCP·설정을 끄고 저장소 밖 빈 폴더에서 실행하며, API 키 환경변수를 넘기지 않는다. Claude 자격 증명을 직접 읽거나 Agent SDK·OAuth 토큰으로 호출하지 않는다(PRD §8 옵션 D)

## UI 작업 규칙

디자인 기준은 [packages/ui/docs/DESIGN.md](packages/ui/docs/DESIGN.md)와 `packages/ui/docs/components/*.md`. UI를 만들기 전에 먼저 읽는다.

- 컴포넌트는 `@qcard/ui`에서 가져온다(Montage 재수출). 새로 만들기 전에 Montage에 있는지 확인한다(60여 종).
- 색·간격·모서리·그림자는 `token('<이름>')` 또는 `var(--qc-<이름>)`만 쓴다. 색 값을 직접 쓰면 `pnpm verify`가 실패한다.
- 글자는 `textClass('<스타일>', 'regular' | 'medium' | 'bold')`. 화면 제목 `title3` bold, 섹션 제목 `headline2` bold, 본문·표 `label1`.
- 판정(Pass/Fail/Blocked/확인필요/N/T/N/A)은 `VerdictBadge`. 색만으로 구분하지 않는다.
- 수백 행 편집 그리드(케이스 그리드, QA 시트)는 AG Grid, 작은 요약 표는 Montage `Table`.
- 디바이스 스크린샷은 `MockScreen`(`apps/web/src/mock/`)으로 그린다. 화면 요소 좌표는 `packages/fixtures/src/screens.ts` 한 곳에서 정의하고 액션 오버레이도 같은 좌표를 쓴다. 디바이스 화면 안에서는 테마와 무관한 `atomic-*`·`static-*` 토큰만 쓴다.
- **UI 작업의 완료 조건**: 새 화면은 `apps/web/e2e/screens/<기능>.json`에 등록하고(공용 컴포넌트는 `/__ui` 카탈로그), `pnpm ui:snap`(일부만: `SNAP_ONLY=<기능>`)을 돌려 PNG를 직접 열어 확인한다(라이트·다크, 좁은 폭 포함). 가로 스크롤·콘솔 에러가 있으면 실패한다. 여러 작업을 동시에 돌릴 때는 `SNAP_PORT`를 서로 다르게 준다.
- 토큰을 바꿀 때는 `tokens.json`을 고치고 `pnpm tokens`. 생성 파일을 직접 고치지 않는다. 원본 디자인 시스템(claude.ai 아티팩트)도 함께 갱신해야 하는지 사용자에게 묻는다.

## 코드 규칙

- 외부 의존성(디바이스, LLM, Firebase, 시계)은 인터페이스 뒤에 두고, 테스트는 대역(Fake·녹화 재생·에뮬레이터)으로 한다. 실기기·실제 LLM 호출 없이 `pnpm verify`가 돌아야 한다.
- 새 패키지 버전은 공개 후 2주가 지난 것만 쓴다(`pnpm-workspace.yaml`의 `minimumReleaseAge`). 버전은 정확히 고정한다.
- 한글 입력은 ADBKeyboard(`com.android.adbkeyboard/.AdbIME`)로 한다: 입력할 때만 IME를 바꾸고 되돌린다. ASCII는 `adb input text`.
- Executor에는 기본으로 트리만 보내고, 스크린샷은 Agent가 `view_screen`으로 요청할 때만 보낸다(F-EX-02, 비용 대부분이 쌓이는 이미지). 키보드 창은 앱 트리에 없으므로 관찰에 키보드 상태를 넣고, 가려진 위치 탭은 코드가 막는다.
- 대상 앱이 포그라운드가 아니면 스크린샷을 LLM에 보내지 않는다(개인 기기의 다른 화면 보호). 이 동작을 바꾸지 않는다.
- 용어는 PRD §12를 따른다(QA 문서, 테스트 사이클, Run, 확인필요, 준비 플로우 …).

## 하지 말 것

- 배포(Firebase·gcloud), `git push --force`, 비밀값 조회 — `.claude/hooks/guard-bash.sh`가 막는다. 필요하면 사용자에게 명령을 알려준다.
- `.env`·서비스 계정 키 읽기.
- 실기기 대상 파괴적 ADB 명령(앱 데이터 삭제, 재부팅 등)을 사용자 확인 없이 실행.
