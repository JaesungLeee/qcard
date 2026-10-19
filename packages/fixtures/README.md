# @qcard/fixtures

백엔드·실기기 없이 화면과 테스트를 돌리기 위한 결정적(deterministic) 데이터.

- `src/data/onboarding-flow.json` — 하루콩 `docs/specs/onboarding-flow/spec.md`(v1.2.1)의 TS·EC 표와 FR·UX를 추출한 것. **하루콩 팀 스펙에서 파생된 데이터이므로 저장소를 공개로 바꾸기 전에 빼야 한다.**
- `src/screens.ts` — 목업 디바이스 화면(1080×2400 px)의 요소 배치. 웹의 `MockScreen`과 액션 오버레이가 같은 좌표를 쓴다.
- `src/build.ts` — 위 데이터로 QA 문서(1.3.0, 이전 1.2.0)·사이클·결과·결함·로컬 콘솔 세션을 만든다. 무작위 없이 항상 같은 결과.
