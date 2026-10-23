---
name: rerecord
description: Agent 프롬프트·도구·관찰 형식이나 결과 형식을 바꿔 e2e 재생 테스트가 녹화와 맞지 않을 때, 실제 모델로 cassette를 다시 녹화하고 ui:snap 샘플까지 갱신한다. 플랜 사용량을 쓴다.
disable-model-invocation: true
---

# Agent cassette 다시 녹화

녹화는 실제 모델을 부르므로 사용자 플랜 사용량이 차감된다. **시작 전에 녹화할 케이스와 이유를 알리고 사용자 확인을 받는다.**

## 1. 무엇을 다시 녹화할지 정하기

```sh
pnpm --filter @qcard/agent test
```

- 실패한 케이스만 녹화 대상이다. 케이스 목록은 `packages/agent/e2e/onboarding.ts`의 `E2E_CASES`, 녹화는 `packages/agent/cassettes/<케이스>/`.
- 실패 원인이 녹화 불일치(요청이 달라짐)인지 먼저 확인한다. 로직 버그로 실패한 것이면 녹화로 덮지 말고 코드를 고친다.

## 2. 녹화

```sh
pnpm --filter @qcard/agent record <TC-ID…>
```

- 인자 없이 돌리면 전체 케이스를 녹화한다. 필요한 케이스만 지정한다.
- 출력의 판정이 `기대` 값과 다르면 멈추고 사용자에게 알린다(프롬프트 변경이 Agent 동작을 망가뜨렸을 수 있다).
- 플랜 한도·로그인 문제로 멈추면 사용자에게 알리고 기다린다.

## 3. 재생 확인과 샘플 갱신

```sh
pnpm --filter @qcard/agent test
pnpm --filter @qcard/agent sample-runs
```

`sample-runs`는 녹화 재생으로 `apps/web/e2e/runs-sample/`을 다시 만든다(호출 없음). 결과 형식이 바뀌었으면 웹 화면도 영향을 받으므로 `/ui-check`로 확인한다.

## 4. 보고

다시 녹화한 케이스, 판정 결과, 출력의 환산 비용 합계, 바뀐 파일(`cassettes/`, `runs-sample/`)을 알린다.
