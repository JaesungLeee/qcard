---
paths:
  - 'apps/web/**'
  - 'packages/ui/**'
---

# UI 작업 규칙

디자인 기준은 [packages/ui/docs/DESIGN.md](../../packages/ui/docs/DESIGN.md)와 `packages/ui/docs/components/*.md`. UI를 만들기 전에 먼저 읽는다.

- 컴포넌트는 `@qcard/ui`에서 가져온다(Montage 재수출). 새로 만들기 전에 Montage에 있는지 확인한다(60여 종).
- 색·간격·모서리·그림자는 `token('<이름>')` 또는 `var(--qc-<이름>)`만 쓴다. 색 값을 직접 쓰면 `pnpm verify`가 실패한다.
- 글자는 `textClass('<스타일>', 'regular' | 'medium' | 'bold')`. 화면 제목 `title3` bold, 섹션 제목 `headline2` bold, 본문·표 `label1`.
- 판정(Pass/Fail/Blocked/확인필요/N/T/N/A)은 `VerdictBadge`. 색만으로 구분하지 않는다.
- 수백 행 편집 그리드(케이스 그리드, QA 시트)는 AG Grid, 작은 요약 표는 Montage `Table`.
- 디바이스 스크린샷은 `MockScreen`(`apps/web/src/mock/`)으로 그린다. 화면 요소 좌표는 `packages/fixtures/src/screens.ts` 한 곳에서 정의하고 액션 오버레이도 같은 좌표를 쓴다. 디바이스 화면 안에서는 테마와 무관한 `atomic-*`·`static-*` 토큰만 쓴다.
- 토큰을 바꿀 때는 `tokens.json`을 고치고 `pnpm tokens`. 생성 파일(`src/generated/`)을 직접 고치지 않는다. 원본 디자인 시스템(claude.ai 아티팩트)도 함께 갱신해야 하는지 사용자에게 묻는다.

## 완료 조건

새 화면은 `apps/web/e2e/screens/<기능>.json`에 등록하고(공용 컴포넌트는 `/__ui` 카탈로그), `pnpm ui:snap`을 돌려 PNG를 직접 열어 확인한다(라이트·다크, 좁은 폭 포함). 가로 스크롤·콘솔 에러가 있으면 실패한다. 절차는 `/ui-check` skill.

## 데이터

화면은 `QcardApi`만 안다. `pnpm dev`·`ui:snap`은 메모리 구현(`apps/web/src/data/memory.ts`, fixture, 새로고침하면 초기화), `pnpm dev:firebase`는 Firestore 구현을 쓴다. `pnpm dev`는 `packages/agent/runs/`의 실기기 실행을 "로컬 실행" 사이클로 함께 보여 준다(`apps/web/vite/local-runs.ts`, 개발 서버 전용).
