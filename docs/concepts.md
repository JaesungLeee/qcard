# 용어와 도메인 모델

qcard의 코드·화면·문서가 함께 쓰는 말이다. 새 이름을 만들기 전에 여기 있는 말을 쓴다. 스키마의 정의는 `packages/shared/src/domain.ts`(Zod)이고, Firestore 문서·fixture·LLM 구조화 출력이 같은 정의를 쓴다.

## 용어

| 용어                       | 뜻                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **프로젝트** (QA 대시보드) | 앱 하나에 대한 QA 작업 공간. 멤버·권한·데이터의 단위이며, 다른 프로젝트의 데이터는 보이지 않는다. 조직 계층은 없다                                         |
| **스펙 묶음**              | 앱 버전 하나의 스펙 폴더 전체 스냅샷. 올린 뒤 바꿀 수 없다                                                                                                 |
| **QA 문서**                | 앱 버전마다 스펙 묶음에서 만드는 케이스 묶음. 기준은 Firestore의 케이스 문서이고 편집은 웹에서만 한다                                                      |
| **출처 ID**                | 케이스가 나온 스펙 행의 ID. `<스펙 이름>/TS-003`, `<스펙 이름>/EC-004`. 버전 간 매칭의 키다                                                                |
| **TC ID**                  | qcard가 붙이는 케이스 ID. `TC-<기능 접두어>-<순번>`. 버전이 바뀌어도 같은 출처면 이어받는다                                                                |
| **스펙 확인 질문**         | 스펙이 모호하거나 빠진 곳. 답이 없으면 연결된 케이스의 승인이 보류된다                                                                                     |
| **스펙 보강 제안**         | 요구사항(FR) 대비 빠진 시나리오(TS·EC) 제안. 케이스가 아니다                                                                                               |
| **케이스 수정안**          | 답변된 확인 질문을 반영해 만든 케이스 변경 제안. 사람이 diff를 보고 적용해야 바뀐다                                                                        |
| **준비 플로우**            | "로그인 상태", "항목 2개 보유" 같은 공통 사전조건을 확인 조건 + 수행 스텝으로 정의한 것. QA 문서 버전마다 사본을 둔다. 종류는 로그인·데이터 상태·환경·원복 |
| **원복 플로우**            | 계정 상태를 바꾸는 케이스가 끝난 뒤 계정을 되돌리는 준비 플로우                                                                                            |
| **계정 종류**              | 케이스가 필요로 하는 테스트 계정의 성질(기본·구독자·관리자 …). 멤버 **역할**과 헷갈리지 않도록 "역할"이라 부르지 않는다                                    |
| **테스트 계정 풀**         | 프로젝트에 등록한 테스트 계정 묶음. 케이스를 시작할 때 필요한 종류의 빈 계정 하나를 배정(리스)받는다                                                       |
| **격리**                   | 원복에 실패한 계정을 배정에서 빼 둔 상태. 사람이 원복한 뒤 해제한다                                                                                        |
| **빌드**                   | 사이클에서 설치할 서명된 APK                                                                                                                               |
| **테스트 사이클**          | QA 문서 버전 + 빌드 + 대상 디바이스로 정의하는 테스트 단위. 여러 Run을 묶어 결과 하나(QA 시트)를 만든다                                                    |
| **대상 디바이스**          | 사이클이 결과를 받는 디바이스. 모델 + OS 메이저 버전이 같으면 같은 대상이다                                                                                |
| **칸**                     | 케이스 × 대상 디바이스. 결과 하나가 들어가는 자리                                                                                                          |
| **Run**                    | 한 실행자가 한 디바이스로 사이클의 케이스를 수행하는 1회 실행                                                                                              |
| **QA 시트**                | 사이클의 케이스와 디바이스별 결과를 담은 웹 화면. 요약·케이스·결함·추적성·환경 탭이 있다                                                                   |
| **검증 포인트**            | 기대 결과를 확인할 수 있는 단위로 나눈 것. 포인트마다 관찰값·증거를 남긴다                                                                                 |
| **스텝 타임라인**          | 스텝별 액션·의도·액션 표시 스크린샷 기록                                                                                                                   |
| **판정 추적**              | 결과 하나를 행동 의도 → 스텝 타임라인 → 검증 포인트 → 판정 이유까지 따라가는 화면                                                                          |
| **확인필요**               | Agent가 판정하지 못했거나 자동 확정 조건을 채우지 못한 상태. 사람이 확정해야 한다                                                                          |
| **자동 확정**              | 조건을 모두 채운 Agent Pass를 사람 확인 없이 확정하는 것                                                                                                   |
| **위험 액션**              | 실행하면 테스트 밖에 영향을 주거나 되돌릴 수 없는 액션. **승인 필요**와 **사람 전용** 두 등급                                                              |
| **수동 스텝**              | Auto 케이스 안에서 실행자가 직접 해야 하는 단계(예: SMS 인증번호 입력)                                                                                     |
| **Take over**              | 실행 중 실행자가 디바이스 조작을 가져오는 것. 끝나면 Agent에 반환한다                                                                                      |
| **일시정지**               | Run이 멈춘 상태. 케이스 결함이 아니라 실행 환경 탓(플랜 한도, 디바이스 연결 끊김 등)일 때 Blocked 대신 쓴다                                                |
| **실행 안전장치**          | 케이스·Run마다 턴·호출·토큰·반복 한도. 프로젝트 설정                                                                                                       |
| **호스트 에이전트**        | 디바이스가 연결된 실행자 PC(macOS)에서 도는 프로그램(`qcard`). 디바이스 제어, 로컬 콘솔, Agent 실행, 결과 업로드, 웹에서 요청한 LLM 작업을 맡는다          |
| **호스트 연결**            | 웹에 로그인한 사용자가 [이 PC 연결]로 호스트를 자기 계정에 묶는 것. 호스트는 따로 로그인하지 않는다                                                        |
| **로컬 콘솔**              | 호스트가 `127.0.0.1`로 띄우는 실행 화면. 라이브 화면·액션 오버레이·타임라인·사고 로그·제어                                                                 |
| **작업** (Job)             | 웹이 요청하고 요청자의 호스트가 처리하는 일. QA 문서 생성(`qa_doc_generate`), 케이스 수정안(`case_revise`), Run 시작(`run_cycle`)                          |
| **Claude Code 연결**       | 호스트가 같은 PC에 설치된 사용자 본인의 Claude Code를 헤드리스(`claude -p`)로 실행해 LLM을 부르는 방식                                                     |
| **환산 비용**              | 사용한 토큰을 Anthropic API 단가로 계산한 참고값. 실제 청구액이 아니며, 사용자 플랜 사용량에서 차감된다                                                    |

## 판정

| 값       | 코드      | 뜻                                                                                |
| -------- | --------- | --------------------------------------------------------------------------------- |
| Pass     | `pass`    | 기대 결과와 일치                                                                  |
| Fail     | `fail`    | 기대 결과와 불일치. 결함을 연결한다                                               |
| Blocked  | `blocked` | 수행할 수 없음(준비 실패, 계정 없음, 대기 타임아웃, 실행 한도 초과, 환경 오류 등) |
| 확인필요 | `check`   | Agent가 판정하지 못했거나 자동 확정 조건을 채우지 못함                            |
| N/T      | `nt`      | 아직 수행하지 않음                                                                |
| N/A      | `na`      | 이 디바이스·플랫폼에 적용되지 않음                                                |

판정을 만드는 규칙은 [product/execution.md](product/execution.md#판정), 사람이 확정하는 규칙은 [product/results.md](product/results.md#사람-확정)에 있다.

## 사이클 상태

- **시작 전**: 판정된 칸도 실행 중인 Run도 없는 사이클. 저장하지 않고 결과·Run으로 계산한다.
- **진행 중**: 시작 전도 완료도 아닌 사이클.
- **완료**: QA 권한자가 끝났다고 표시한 사이클. 새 Run을 받지 않는다. 다시 열 수 있다.

"시작 전"은 Run 요청이 호스트를 기다리는 **호스트 대기**, Run이 위험 액션 승인을 기다리는 **승인 대기**와 다른 말이다.

## 데이터 모델

```
Project(name, createdBy, deletedAt?, runLimits?)
├─ Member(user, githubUsername, role: admin|qa|viewer, dataNoticeAckAt)
├─ Invitation(githubUsername | linkToken, role, expiresAt, status)
├─ Job(kind: qa_doc_generate|case_revise|run_cycle, requestedBy, status)   ← 요청자의 호스트가 처리
├─ SpecBundle(appVersion)                                                  ← 바꿀 수 없는 스냅샷
│    └─ SpecDocument(specName, file, contentHash)
├─ QADocument(appVersion, specBundle, prevVersion)
│    ├─ Requirement(id, sourceRef)
│    ├─ Question · Suggestion                                              ← 확인 질문, 보강 제안
│    ├─ PrepFlow(id, name, kind: login|data_state|env|restore, check, steps[], rev)   ← 버전마다 사본
│    └─ TestCase(tcId, requirementIds[], platform, mode: auto|manual, steps[{text, manual, risk}],
│                prepFlowIds[], cleanState, accountKind?, restoreFlowId?, verificationPoints[],
│                sourceRef, sourceHash, contentHash, rev, change: new|changed|removed|same, approval)
├─ TestAccount(kind, loginId, usesTotp, loginFailed?, lease?, quarantine?)
│    └─ AccountSecret(kmsCiphertext)                                       ← Functions만 읽고 씀
├─ SecretAccessLog(account, run, host, user, at)                           ← 바꿀 수 없음
├─ Build(version, buildNumber, packageName, signingCert, storagePath)
└─ TestCycle(qaDocument, build, targetDevices[], caseSnapshot[], period, completedBy?)
     ├─ CycleCase(tcId, 승인된 케이스 내용 사본)                            ← 바꿀 수 없음
     ├─ Run(executorUid, hostId, device, status, pauseReason?, currentTcId?, llmUsage)
     ├─ RunCase(tcId, contentHash, attempt, verdict, decidedBy, autoConfirmed, unmetConditions[], attachments[])
     │    ├─ Step(action, target, input(마스킹), intent, screenshot)
     │    ├─ VerificationPoint(expected, method: tree|vision, observed, result: match|mismatch|unknown, evidence)
     │    └─ VerdictHistory                                                ← 바꿀 수 없음
     └─ Defect(seq D-n, tcId, device, severity, status: open|fixed|closed, repro, expected, actual)

Host(user, machine, credentialHash, lastSeenAt, revokedAt?, jobKinds[], consoleUrl?, claudeCode)
```

설계상 지키는 것:

- **케이스는 Firestore 문서가 기준이다.** 케이스 단위로 편집·해시·승인·결과를 연결한다. MD 렌더는 두지 않는다.
- **사이클은 만들 때 케이스 내용을 복사한다.** 그 뒤 QA 문서를 고쳐도 사이클은 복사한 내용으로 돈다.
- **준비 플로우는 사이클에 복사하지 않는다.** 사이클은 자기 QA 문서 버전의 플로우를 다음 Run부터 쓴다.
- **승인은 TC ID + 내용 해시에 붙는다.** 내용이 바뀌면 저절로 미승인이 된다. 준비 플로우 내용은 해시에 들어가지 않는다.
