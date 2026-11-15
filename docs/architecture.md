# 아키텍처

## 배포 형태

**실행·관찰은 로컬, 결과는 클라우드에서 공유한다.** 라이브 화면은 실행자만 보면 되므로 영상은 PC 밖으로 나가지 않는다. 팀이 함께 봐야 하는 데이터(QA 문서, 사이클 진행 상태, 결과, 증거 스크린샷)만 Firebase에 저장한다. 자체 서버는 없다.

- **웹 대시보드** (`apps/web`) — `https://qcard.dev`(Firebase Hosting). 스펙 업로드, QA 문서 검토·편집·승인, 사이클과 진행 상태, QA 시트, 결과 확정. 설치할 것이 없다.
- **Firebase** — Auth, Firestore, Storage, Cloud Functions(`apps/functions`), Cloud KMS. 리전은 서울(`asia-northeast3`).
- **GitHub** — 결함을 이슈로 발행하는 곳. qcard GitHub App을 팀 저장소에 설치하고, Functions만 GitHub API를 부르고 웹훅을 받는다([product/issues.md](product/issues.md)).
- **호스트 에이전트** (`apps/host-agent`, npm `@qcard/host`, 명령 `qcard`) — 디바이스가 꽂힌 실행자 PC(macOS)에서 돈다. `127.0.0.1`로 로컬 콘솔을 띄우고, Firebase에는 밖으로 나가는 연결만 쓰므로 포트를 열 필요가 없다. LLM은 같은 PC에 설치된 사용자 본인의 Claude Code로 부른다.

실행자는 디바이스가 연결된 PC 앞에 있어야 한다. 원격 실행·여러 명의 동시 관전은 범위 밖이다.

## 구성 요소

```
┌──────────── 브라우저 (팀원 N명) ────────────────┐
│ 웹 대시보드: 스펙 업로드 / QA 문서 편집·승인 /   │
│   사이클 진행(실시간) / QA 시트·판정 추적        │
└──────────────────────▲──────────────────────────┘
                       │ Firestore 실시간 구독 / Storage / Functions 호출
┌──────────────────────┴──────────── Firebase ───────────────────────────────┐
│ Auth (웹: GitHub 로그인 / 호스트: 호스트 자격으로 받은 호스트 토큰)         │
│ Firestore (프로젝트·멤버·QA 문서·사이클·Run·결과·작업, 보안 규칙으로 격리)  │
│ Storage (스펙·빌드·스크린샷)                                               │
│ Cloud Functions (초대·호스트 연결·계정 배정·칸 선점·사이클·프로젝트 삭제,   │
│                  GitHub 이슈 발행·상태 동기화 웹훅) ◀──▶ GitHub App        │
│ Cloud KMS (테스트 계정 비밀값 암호화)                                      │
└──────────────────────▲─────────────────────────────────────────────────────┘
                       │ 결과·증거 업로드, 작업 구독, 빌드 다운로드  ※ 아웃바운드만
┌──────────────────────┴─── 호스트 에이전트 (실행자 PC, macOS) ──────────────┐
│ 로컬 콘솔 (127.0.0.1): 라이브 화면·액션 오버레이·타임라인·사고 로그·제어    │
│ Executor / Verifier 루프 (관찰 → 판단 → 액션 → 검증 포인트 판정)           │
│ QA Doc Generator (웹에서 요청한 작업)                                     │
│ 업로드 큐 (로컬 디스크, 네트워크가 끊기면 보관 후 재전송)                  │
│ 호스트 자격 (macOS 키체인) → 켤 때마다 호스트 토큰 발급                    │
│ Android: ADB(uiautomator dump·input) + scrcpy(로컬 화면)                  │
│ Claude Code CLI (사용자 본인 로그인, claude -p) ──────▶ Anthropic          │
└──────────────────────┬─────────────────────────────────────────────────────┘
                       │ USB / Wi-Fi
                 Android 디바이스
```

### 왜 이렇게 나눴나

- **Executor를 호스트에 둔다.** 관찰 → 판단 → 액션 루프는 디바이스와 가까울수록 지연이 적고, 스크린샷 같은 큰 데이터를 로컬에서 처리한 뒤 필요한 것만 올릴 수 있다.
- **LLM 작업을 모두 호스트에 둔다.** LLM 비용을 각 사용자의 Claude 플랜으로 부담하려면, 호출이 그 사용자가 로그인한 Claude Code에서 나가야 한다([security.md](security.md#llm-호출-경로)). 그래서 클라우드에는 LLM을 부르는 구성 요소가 없다. 웹의 QA 문서 생성·케이스 수정안·Run 시작·이슈 초안은 Firestore **작업 문서**로 만들고, 요청자의 호스트가 구독해 처리한다. 호스트는 처리할 수 있는 작업 종류를 연결 신호로 알리고, 웹은 이를 보고 업데이트가 필요한 호스트를 안내한다.
- **화면은 로컬에서만 본다.** 실행 관찰은 실행자 1명만 하면 되므로, 영상을 서버로 중계하지 않으면 미디어 서버·NAT 통과·대역폭 문제가 없다. 팀은 진행 상태를 실시간으로, 화면은 스크린샷으로 나중에 확인한다.

## Agent 구조

| Agent                                   | 위치            | 역할                                                                                                                                            | 모델          |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **QA Doc Generator** (`packages/qadoc`) | 요청자의 호스트 | 스펙 TS·EC 행 → 실행 가능한 케이스 변환(신규·변경만), 준비 플로우, 확인 질문, 보강 제안, 답변 기반 수정안. 매칭·동일 케이스 복사·ID·해시는 코드 | Opus          |
| **Executor** (`packages/agent`)         | 실행자의 호스트 | 화면 관찰 → 액션 결정 → 디바이스 조작, 준비 플로우 수행                                                                                         | Sonnet        |
| **Verifier** (`packages/agent`)         | 실행자의 호스트 | 검증 포인트 판정과 근거. Executor와 분리해 자기확증 편향을 줄인다. 트리 포인트는 대상 요소만 찾고 값 비교는 코드, 비전 포인트는 화면으로 판정   | Sonnet (고정) |
| **Reporter** (`packages/reporter`)      | 요청자의 호스트 | 결함·케이스 텍스트 → 고른 이슈 템플릿에 맞춘 제목·본문 초안. 넘긴 정보에 없는 칸은 비운다. 템플릿 해석·본문 조립·끝줄은 코드                    | Sonnet        |

Haiku는 판정이 아닌 보조 작업(화면 변화 감지, 팝업 분류 등)에만 쓴다. 역할별 모델은 `packages/llm/src/types.ts`의 `MODELS`에 있다.

### LLM 호출

- 모든 Agent는 `LlmClient` 인터페이스 하나로 LLM을 부른다. 기본 구현은 Claude Code CLI를 헤드리스로 실행한다(`claude -p`, `--model`, `--effort`, `--json-schema`).
- Executor의 액션 선택도 구조화 출력으로 받아 도구 호출 형식으로 바꾸므로, 실행 루프는 LLM 제공 방식과 무관하다.
- Claude Code의 내장 도구·MCP·사용자 설정을 끄고, 세션을 남기지 않는다([security.md](security.md#claude-code-실행-방식)).
- 개발·테스트용으로 Anthropic API 키 구현과 녹화·재생(cassette) 구현을 함께 둔다. `pnpm verify`는 실제 LLM을 부르지 않는다.

## 기술 스택

**원칙**: 웹·Functions·호스트를 **TypeScript 단일 언어 모노레포**로 만든다. 세 컴포넌트가 함께 바뀌는 제품이라 스키마를 타입 정의 하나로 공유하는 이점이 크다. 서버 인프라는 Firebase 관리형 서비스로 대신해 운영 부담을 없앤다.

| 영역         | 채택                                                                                                         | 이유                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 모노레포     | pnpm workspace + Turborepo                                                                                   | 패키지 구성은 [CLAUDE.md](../CLAUDE.md#구조)                                                                                                         |
| 공유 스키마  | Zod (`packages/shared`)                                                                                      | Firestore 문서·케이스·LLM 구조화 출력 검증을 한 곳에서                                                                                               |
| 웹           | React 18 + Vite + react-router + TanStack Query, AG Grid, 디자인 시스템 Montage(`packages/ui`)               | 큰 케이스 그리드. 로컬 콘솔도 같은 코드(`apps/web`의 `console`)를 호스트에 내장해 쓴다                                                               |
| 데이터 접근  | `QcardApi` 인터페이스(`packages/data`) — Firestore 구현과 메모리 구현                                        | 웹 개발 서버·테스트는 메모리 구현                                                                                                                    |
| 백엔드 로직  | Cloud Functions(2nd gen)                                                                                     | 클라이언트에 맡길 수 없는 트랜잭션·권한 확인. LLM을 부르는 함수는 없다                                                                               |
| DB           | Firestore                                                                                                    | 실시간 구독(진행 상태 공유), 보안 규칙                                                                                                               |
| 작업 큐      | Firestore 작업 문서 → 요청자의 호스트가 구독                                                                 | LLM 작업을 요청자 본인의 플랜으로 처리                                                                                                               |
| 파일         | Cloud Storage for Firebase                                                                                   | 스펙·빌드·스크린샷                                                                                                                                   |
| 인증         | Firebase Auth — 웹은 GitHub 단일, 호스트는 Functions가 발급한 커스텀 토큰(호스트 클레임)                     | 대상 사용자는 GitHub 계정이 있다. 로그인 장소를 웹 하나로 모으고, 호스트에 GitHub 토큰을 두지 않으며, 보안 규칙이 호스트 쓰기와 사람 쓰기를 구분한다 |
| 이슈 트래커  | GitHub Issues, qcard GitHub App(Issues 쓰기·Contents 읽기) + Functions 웹훅                                  | 대상 사용자가 GitHub을 쓴다. 저장소 단위 최소 권한, 상태 동기화를 같은 App 웹훅으로([decisions.md](decisions.md#결함-트래커는-github-issues))        |
| 비밀값       | Cloud KMS + Firestore                                                                                        | 테스트 계정 비밀값은 수가 많고 프로젝트와 함께 지워야 해서 KMS로 암호화해 Firestore에 둔다                                                           |
| Android 제어 | ADB 직접 호출(`uiautomator dump`, `input`, 한글은 ADBKeyboard), `DeviceDriver` 인터페이스(`packages/device`) | 설치 부담이 없다. Appium은 필요해지면 같은 인터페이스 뒤에 붙인다. 테스트는 `FakeDevice`                                                             |
| Android 화면 | scrcpy H.264 → 브라우저 WebCodecs                                                                            | 저지연·서버 불필요. Chrome 계열에서만 된다                                                                                                           |
| LLM          | Claude Code CLI 헤드리스, 사용자 본인 플랜                                                                   | 사용자별 과금. 판정은 Sonnet 고정                                                                                                                    |
| 배포         | 웹·Functions·규칙은 GitHub Actions가 `main` 푸시 때, 호스트는 npm `@qcard/host`(태그 `host-v*`)              | [dev/ci.md](dev/ci.md), [dev/deploy.md](dev/deploy.md)                                                                                               |

**호스트 OS는 macOS만 지원한다.** 실행자는 QA할 때 `qcard serve`로 호스트를 켠다. 로그인 시 자동 시작·트레이 앱은 없다.

## 테스트 전략

외부 의존성은 인터페이스 뒤에 두고, 테스트는 대역으로 한다. 실기기·실제 LLM 없이 `pnpm verify`가 돈다.

| 의존성   | 인터페이스     | 대역                                                    |
| -------- | -------------- | ------------------------------------------------------- |
| 디바이스 | `DeviceDriver` | `FakeDevice` + 목업 화면(`packages/fixtures`)           |
| LLM      | `LlmClient`    | 녹화·재생 cassette(`packages/agent/cassettes`)          |
| Firebase | `QcardApi`     | 메모리 구현, Firebase 에뮬레이터(보안 규칙 테스트 포함) |

fixture와 cassette는 가상 앱 하루콩(`packages/fixtures/spec/`) 기준이다. 실제 팀의 스펙·화면은 저장소에 넣지 않는다.
