---
paths:
  - 'packages/llm/**'
  - 'packages/agent/**'
  - 'packages/qadoc/**'
  - 'apps/host-agent/src/jobs.ts'
---

# LLM 호출 규칙

- LLM 모드는 `LLM_MODE=replay`(기본, 녹화 없으면 실패)·`record`·`live`. 테스트는 항상 replay — 실제 LLM 호출 없이 `pnpm verify`가 돌아야 한다.
- 실제 호출 제공자는 `LLM_PROVIDER=claude-cli`(기본: 같은 PC의 Claude Code를 본인 플랜으로)·`api`(ANTHROPIC_API_KEY, 비용 발생).
- claude-cli는 내장 도구·MCP·설정을 끄고 저장소 밖 빈 폴더에서 실행하며, API 키 환경변수를 넘기지 않는다. Claude 자격 증명을 직접 읽거나 Agent SDK·OAuth 토큰으로 호출하지 않는다(PRD §8 옵션 D).
- `LlmClient`는 SDK 타입을 그대로 쓴다. 도구·출력 스키마는 strict 변환을 거친다. 요청에 비밀값이 섞이지 않게 검사하고, 사용량·플랜 한도를 추적한다(한도에 걸리면 일시정지).
- 요청(프롬프트·도구·관찰 형식)이 바뀌면 녹화가 맞지 않아 재생 테스트가 실패한다. Agent는 `/rerecord` skill로 다시 녹화하고, qadoc은 `../qcard-specs/cassettes/qadoc`에서 바뀐 호출만 다시 부른다. 녹화는 플랜 사용량을 쓰므로 사용자 확인 후에 한다.
- qadoc에서 매칭·복사·ID·해시·승인 상태는 코드가 정하고, 모델(`prompts.ts`)은 신규·변경 행의 케이스 변환·준비 플로우·확인 질문·보강 제안만 한다. qadoc은 Firestore를 모른다.

실제 모델을 부르는 명령은 [docs/dev/device-llm.md](../../docs/dev/device-llm.md), [docs/dev/spec-qadoc.md](../../docs/dev/spec-qadoc.md).
