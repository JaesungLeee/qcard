# 코드 규칙

- 외부 의존성(디바이스, LLM, Firebase, 시계)은 인터페이스 뒤에 두고, 테스트는 대역(Fake·녹화 재생·에뮬레이터)으로 한다. 실기기·실제 LLM 호출 없이 `pnpm verify`가 돌아야 한다.
- 새 패키지 버전은 공개 후 2주가 지난 것만 쓴다(`pnpm-workspace.yaml`의 `minimumReleaseAge`). 버전은 정확히 고정한다.
- 용어는 PRD §12를 따른다(QA 문서, 테스트 사이클, Run, 확인필요, 준비 플로우 …).
- fixture(`packages/fixtures`)와 `packages/agent/cassettes/`는 하루콩 팀 스펙에서 파생됐으므로 저장소를 공개하기 전에 빼야 한다. 새로 만드는 파생 데이터도 같은 위치에 둔다.
- 하루콩 스펙 원본은 저장소 밖 `../qcard-specs/`에 둔다. 저장소에 복사하거나 커밋하지 않는다.
