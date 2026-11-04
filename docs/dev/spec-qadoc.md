# 스펙 파싱·QA 문서 생성

실제 팀 스펙은 저장소 밖 `../qcard-specs/`에 둔다(커밋하지 않음).

## spec check — 파싱·버전 비교 (LLM 없음)

```sh
pnpm --filter @qcard/spec check <docs/specs 폴더> [--prev <이전 버전 폴더>]
```

실제 스펙 폴더를 파싱해 개수·경고와 이전 버전 대비 동일·변경·신규·삭제를 보인다. 읽기 전용.

`packages/spec`은 `spec.md` → 요구사항·TS/EC 행·출처 위치·행 해시로 파싱하고, 출처 ID로 버전을 매칭한다(동일·변경·신규·삭제, TC ID 이어받기).

## qadoc generate — QA 문서 생성 (Opus)

```sh
pnpm --filter @qcard/qadoc generate <docs/specs 폴더> --out <결과.json> [--only a,b] [--prev-doc <이전 결과.json> --prev <이전 스펙 폴더>]
```

- 실제 스펙으로 QA 문서를 만들어 JSON으로 쓴다. 플랜 사용량 차감, Firestore에 올리지 않는다.
- 호출은 `../qcard-specs/cassettes/qadoc`에 녹화돼 같은 요청은 재생하므로 중단해도 이어 간다. 프롬프트를 바꾸면 바뀐 호출만 다시 부른다.
- 매칭·복사·ID·해시·승인 상태는 코드, 신규·변경 행의 케이스 변환·준비 플로우·확인 질문·보강 제안은 모델(`packages/qadoc/src/prompts.ts`).
- 결과의 `prepFlows`는 이 버전의 준비 플로우다. `--prev-doc`의 플로우 중 케이스가 참조하는 것을 그대로 이어받고, 없는 것만 새로 만든다(`newPrepFlows`). 다음 버전은 이 결과를 `--prev-doc`으로 준다.

웹에서 요청한 생성 작업은 호스트 에이전트 `serve`가 처리한다([host-agent.md](host-agent.md)).

## qadoc revise — 케이스 수정안 (Opus)

```sh
pnpm --filter @qcard/qadoc revise <docs/specs 폴더> --doc <generate 결과.json> --tc <TC ID> [--answer Q-1=<답변>]
```

- 답변된 확인 질문으로 케이스 수정안을 만들어 바뀐 필드를 출력한다. `--answer`로 아직 답이 없는 질문에 답을 넣어 볼 수 있다. 플랜 사용량 차감, Firestore에 올리지 않는다.
- 녹화 위치는 `generate`와 같다(`--cassettes`로 바꾼다). 웹에서 요청한 수정안은 `serve`가 처리하고, 에뮬레이터 시드에는 1.3.0 문서의 스펙 묶음이 있어 그대로 해 볼 수 있다.

## seed-generated — 결과를 에뮬레이터에 넣기

```sh
pnpm --filter @qcard/functions seed-generated <결과.json…>
```

`qadoc generate` 결과를 실행 중인 에뮬레이터에 별도 프로젝트(`haru-gen`)로 넣는다. 기존 시드는 그대로.
