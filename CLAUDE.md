# qcard

스펙 문서로 앱 버전별 QA 문서를 만들고, Agent가 Android 디바이스에서 직접 수행하는 QA 자동화 플랫폼. 1인 사이드 프로젝트.
제품 요구사항은 [docs/PRD.md](docs/PRD.md)가 기준이다. 62KB라 통째로 읽지 말고 필요한 절(§)만 찾아 읽는다.

## 구조

pnpm workspace + Turborepo, TypeScript 단일 언어.

| 경로                    | 내용                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web`              | 웹 대시보드 (React 18 + Vite + react-router 7 + TanStack Query). `/__ui`는 UI 카탈로그                    |
| `apps/web/src/data`     | 데이터 접근 인터페이스 `QcardApi`(`api.ts`)와 fixture 메모리 구현(`memory.ts`), 훅(`hooks.ts`)            |
| `apps/web/src/features` | 화면 단위 폴더: `qa-sheet`(사이클·QA 시트·판정 추적), `qa-doc`(QA 문서 검토·승인), `console`(로컬 콘솔)   |
| `packages/ui`           | 디자인 시스템 "Montage for qcard" — Montage 컴포넌트 재수출, `--qc-*` 토큰, `VerdictBadge`                |
| `packages/shared`       | 도메인 스키마(Zod, PRD §6.4)와 표시용 라벨                                                                |
| `packages/fixtures`     | 하루콩 onboarding-flow 스펙에서 만든 결정적 데이터(QA 문서·사이클·결과·콘솔 세션)와 목업 디바이스 화면 배치 |

예정: `apps/functions`, `apps/host-agent`, `packages/device`(DeviceDriver + FakeDevice), `packages/llm`(LlmClient + 녹화/재생).

화면은 `QcardApi`만 알고, 지금은 메모리 구현이 fixture를 돌려준다(새로고침하면 초기화). Firestore 구현은 같은 인터페이스로 끼운다. fixture는 하루콩 팀 스펙에서 파생됐으므로 저장소를 공개하기 전에 빼야 한다.

## 명령

pnpm이 전역에 없으면 `npx -y pnpm@10.34.6 <명령>`으로 실행한다.

- `pnpm verify` — 타입 검사 + 테스트 + 색 하드코딩 검사. **작업을 끝내기 전에 반드시 통과**(Stop 훅이 강제한다)
- `pnpm ui:snap` — `/__ui` 등 화면을 데스크톱·좁은 폭 × 라이트·다크로 찍어 `apps/web/.snap/*.png`에 저장
- `pnpm tokens` — `packages/ui/tokens/tokens.json` → `src/generated/` 재생성
- `pnpm dev` — 웹 개발 서버 (http://localhost:5173)

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
- 용어는 PRD §12를 따른다(QA 문서, 테스트 사이클, Run, 확인필요, 준비 플로우 …).

## 하지 말 것

- 배포(Firebase·gcloud), `git push --force`, 비밀값 조회 — `.claude/hooks/guard-bash.sh`가 막는다. 필요하면 사용자에게 명령을 알려준다.
- `.env`·서비스 계정 키 읽기.
- 실기기 대상 파괴적 ADB 명령(앱 데이터 삭제, 재부팅 등)을 사용자 확인 없이 실행.
