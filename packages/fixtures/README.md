# @qcard/fixtures

백엔드·실기기 없이 화면과 테스트를 돌리기 위한 결정적(deterministic) 데이터. 모두 **가상 앱 하루콩**(습관 기록 앱, `com.example.harukong`) 기준이며 실제 앱·팀과 관계없다.

- `spec/onboarding-flow/spec.md` — 하루콩 온보딩 스펙(팀 스펙 템플릿 형식). 고치면 `pnpm --filter @qcard/fixtures gen-spec`.
- `src/data/onboarding-flow.json` — 위 스펙을 `@qcard/spec` 파서로 뽑은 FR·UX와 TS·EC 행 (`gen-spec`이 만든다).
- `src/data/onboarding-points.json` — 행별 검증 포인트. 행 ID에 맞춰 직접 고친다.
- `src/screens.ts` — 목업 디바이스 화면(1080×2400 px)의 요소 배치. 웹의 `MockScreen`과 액션 오버레이가 같은 좌표를 쓴다.
- `src/device.ts` — 위 화면으로 만든 합성 접근성 트리와 온보딩 전환 규칙(FakeDevice 시나리오).
- `src/build.ts` — 위 데이터로 QA 문서(1.3.0, 이전 1.2.0)·사이클·결과·결함·로컬 콘솔 세션을 만든다. 무작위 없이 항상 같은 결과.

실제 팀 스펙과 그 파생 데이터는 저장소 밖 `../qcard-specs/`에 둔다.
