---
paths:
  - 'packages/device/**'
  - 'packages/agent/**'
  - 'apps/host-agent/**'
---

# 디바이스·Agent 규칙

- 한글 입력은 ADBKeyboard(`com.android.adbkeyboard/.AdbIME`)로 한다: 입력할 때만 IME를 바꾸고 되돌린다. ASCII는 `adb input text`.
- Executor에는 기본으로 트리만 보내고, 스크린샷은 Agent가 `view_screen`으로 요청할 때만 보낸다(비용 대부분이 쌓이는 이미지). 키보드 창은 앱 트리에 없으므로 관찰에 키보드 상태를 넣고, 가려진 위치 탭은 코드가 막는다.
- 대상 앱이 포그라운드가 아니면 스크린샷을 LLM에 보내지 않는다(개인 기기의 다른 화면 보호). 이 동작을 바꾸지 않는다.
- 잠긴 폰을 adb로 풀지 않는다. 화면 꺼짐·잠김·연결 끊김은 LLM을 부르기 전에 일시정지로 처리한다.
- 앱 데이터 삭제(`pm clear`)는 실행 대상으로 지정한 앱에만 한다. 낮은 버전·다른 서명 APK는 데이터가 지워져야 하므로 자동으로 설치하지 않고 멈춘다.
- 테스트는 `FakeDevice`(화면 + 전환 규칙 상태 기계, 시나리오는 `packages/fixtures/src/device.ts`)와 녹화 재생으로 한다. 실기기 없이 `pnpm verify`가 돌아야 한다.
- 위험 액션([docs/product/execution.md](../../docs/product/execution.md#위험-액션))은 Executor가 실행 직전에 멈춘다: Agent의 `risk` 표시 + 코드 안전장치(`packages/agent/src/risk.ts` — 앱 밖 탭, 민감한 권한, 결제·발송·삭제 문구, 비밀번호 칸, 본인인증 화면). 사람 전용(본인인증 등)은 Agent가 입력하지 않고, 인증 화면이 남아 있는 동안 LLM에 보내지 않는다. 안전장치를 좁히거나 실행자가 없을 때 그냥 진행하게 바꾸지 않는다.
- Agent 도구·Verifier 출력 스키마는 `packages/shared/src/agent.ts`. 프롬프트·도구·관찰 형식을 바꾸면 cassette를 다시 녹화해야 한다 — `/rerecord` skill.

실기기에서 직접 돌리는 명령과 호스트 에이전트 동작은 [docs/dev/host-agent.md](../../docs/dev/host-agent.md), [docs/dev/device-llm.md](../../docs/dev/device-llm.md).
