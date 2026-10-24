# qcard

스펙 문서로 앱 버전별 QA 문서를 만들고, Agent가 Android 디바이스에서 직접 수행하는 QA 자동화 플랫폼. 1인 사이드 프로젝트.
제품 요구사항은 [docs/PRD.md](docs/PRD.md)가 기준이다. 62KB라 통째로 읽지 말고 필요한 절(§)만 찾아 읽는다.

## 구조

pnpm workspace + Turborepo, TypeScript 단일 언어.

| 경로                | 내용                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | 웹 대시보드(React 18 + Vite + react-router 7 + TanStack Query). `features/`: `qa-sheet`·`qa-doc`·`console`. `/__ui` 카탈로그      |
| `apps/functions`    | Cloud Functions: 프로젝트·멤버·초대 쓰기(callable), 삭제 유예 지난 프로젝트 영구 삭제. 보안 규칙은 `firebase/`                    |
| `apps/host-agent`   | 실기기에서 사이클 실행 → Firestore·Storage 업로드, QA 문서 생성 작업 처리, 로컬 콘솔(`console/`). npm `@qcard/host`(명령 `qcard`) |
| `packages/ui`       | 디자인 시스템 "Montage for qcard" — Montage 재수출, `--qc-*` 토큰, `VerdictBadge`                                                 |
| `packages/shared`   | 도메인 스키마(Zod, PRD §6.4)·표시용 라벨·membership 규칙. Agent 도구·Verifier 출력 스키마는 `src/agent.ts`                        |
| `packages/data`     | 데이터 접근 인터페이스 `QcardApi`, 공용 계산 `logic.ts`, Firestore 구현, 에뮬레이터 시드                                          |
| `packages/fixtures` | 가상 앱 하루콩의 온보딩 스펙(`spec/`)에서 만든 결정적 데이터와 목업 디바이스 화면(`screens.ts`)·합성 시나리오(`device.ts`)        |
| `packages/device`   | `DeviceDriver`, 접근성 트리 파서, `AdbDriver`·녹화(`@qcard/device/node`), `FakeDevice`                                            |
| `packages/llm`      | `LlmClient`, 실제 호출(본인 Claude Code `claude -p` = 기본 / API 키 = 개발용), 녹화·재생(cassette), 사용량·한도                   |
| `packages/agent`    | Executor 루프(`runSteps`), 검증 포인트 판정(`verifyPoints`·`settle`), 판정 집계(`judge`), 케이스 실행(`runCase`), `e2e/`          |
| `packages/spec`     | 스펙 파서(`spec.md` → 요구사항·TS/EC 행)와 버전 매칭(출처 ID, TC ID 이어받기). LLM 없음                                           |
| `packages/qadoc`    | QA Doc Generator: 스펙 묶음 + 이전 QA 문서 → 새 QA 문서. 결정적인 부분은 코드, 케이스 변환 등은 Opus(`prompts.ts`)                |
| `packages/apk`      | APK 매니페스트(패키지·버전)·서명 인증서 지문 읽기(브라우저·Node 공용). 테스트 APK는 `scripts/make-fixtures.sh`                    |

## 명령

pnpm이 전역에 없으면 `npx -y pnpm@10.34.6 <명령>`으로 실행한다.

- `pnpm verify` — 타입 검사 + 테스트 + 색 하드코딩 검사. **작업을 끝내기 전에 반드시 통과**(Stop 훅이 강제한다). 에뮬레이터 테스트에 Java 21 이상 필요
- `pnpm dev` — 웹 개발 서버(http://localhost:5173, 메모리 구현)
- `pnpm emu` — 개발용 Firebase 에뮬레이터 + 시드. `pnpm dev:firebase`로 웹을 붙인다
- `pnpm ui:snap` — 화면 스크린샷(데스크톱·좁은 폭 × 라이트·다크) → `apps/web/.snap/`
- `pnpm tokens` — `packages/ui/tokens/tokens.json` → `src/generated/` 재생성

그 밖의 명령은 `docs/dev/`에 있다. 필요할 때 읽는다.

- [host-agent.md](docs/dev/host-agent.md) — `connect`(PC 연결)·`serve`(상주 모드)·`run-cycle`, 로컬 콘솔, 배포 패키지 `qcard`
- [device-llm.md](docs/dev/device-llm.md) — 실기기 점검·실행, `llm:smoke`, cassette 녹화, `sample-runs`
- [spec-qadoc.md](docs/dev/spec-qadoc.md) — `spec check`, `qadoc generate`, `seed-generated`
- [emulators.md](docs/dev/emulators.md) — 에뮬레이터 구성·시드·임시 폴더 분리
- [worktree.md](docs/dev/worktree.md) — 워크트리에서 병렬 작업할 때 복사되는 파일·포트·`qcard-specs` 경로
- [deploy.md](docs/dev/deploy.md) — 실제 Firebase 프로젝트(`qcard-d2ade`) 설정, 웹·규칙·Functions 배포, 호스트 환경변수

## 하네스

- **규칙** `.claude/rules/` — `code.md`는 항상, 나머지는 해당 경로를 만질 때 적용된다: `ui.md`(웹·디자인 시스템), `device.md`(디바이스·Agent·호스트 에이전트), `llm.md`(LLM·qadoc), `data.md`(데이터·Functions·Firebase)
- **Skills** — `/ui-check`(UI 완료 조건 확인), `/rerecord`(Agent cassette 다시 녹화, 플랜 사용량 차감)
- **훅** `.claude/hooks/` — `guard-bash.sh`(아래 금지 명령 차단), `format.sh`(편집 후 prettier), `verify-on-stop.sh`(코드를 바꿨으면 `pnpm verify`)

## 하지 말 것

- 배포(Firebase·gcloud), `git push --force`, 비밀값 조회 — `guard-bash.sh`가 막는다. 필요하면 사용자에게 명령을 알려준다.
- `.env`·서비스 계정 키 읽기(`settings.json`의 deny).
- 실기기 대상 파괴적 ADB 명령(앱 데이터 삭제, 앱 삭제, 재부팅, 초기화, `/data/local/tmp` 밖 파일 삭제)을 사용자 확인 없이 실행. `guard-bash.sh`가 막으며, `pm clear`는 로컬 설정 `qcard.local.json`(gitignore)의 `devApp`만 허용한다.
