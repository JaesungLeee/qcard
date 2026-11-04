# 변경 이력

qcard의 버전별 변경 사항입니다. 버전 하나는 웹 서비스와, 바뀐 경우 PC에 설치하는 호스트(`@qcard/host`)를 함께 가리킵니다.
버전은 [Semantic Versioning](https://semver.org/)을 따릅니다.

## [1.0.0](https://github.com/JaesungLeee/qcard/compare/v0.5.0...v1.0.0) - 2026-11-04

첫 정식 버전입니다. 0.5.0과 기능은 같고, 지금까지의 기능을 1.0.0으로 묶어 안정 버전으로 내보냅니다.

> 호스트 1.0.0. 호스트 0.5.0도 그대로 쓸 수 있습니다. 업데이트하려면 PC에서 `npm i -g @qcard/host`로 1.0.0으로 올린 뒤 `qcard serve`를 다시 켜 주세요.

## [0.5.0](https://github.com/JaesungLeee/qcard/compare/v0.4.0...v0.5.0) - 2026-11-03

> ⚠ **호스트 업데이트가 필요합니다.** 호스트 0.4.0 이하로는 이 버전에서 테스트를 실행할 수 없습니다.
> PC에서 `npm i -g @qcard/host`로 0.5.0으로 업데이트한 뒤 `qcard serve`를 다시 켜 주세요.

### Added

- 테스트를 실행할 때 **돌릴 케이스를 골라** 실행할 수 있습니다. 사이클 화면과 로컬 콘솔의 [케이스 고르기]에서 내 기기의 판정(남은 칸·Fail·Blocked·확인필요)과 우선순위로 거르고, 기능 단위로 한꺼번에 고릅니다. 결과가 있는 칸을 고르면 다시 실행합니다. ([#38](https://github.com/JaesungLeee/qcard/pull/38))
- Admin이 프로젝트 설정에서 **실행 안전장치**를 정할 수 있습니다. 케이스당 턴·LLM 호출·토큰, Run당 토큰, 실행자 대기 시간을 바꾸면 진행 중인 사이클에도 다음 Run부터 적용됩니다. ([#32](https://github.com/JaesungLeee/qcard/pull/32))
- 한 Run이 쓴 토큰이 Run당 한도를 넘으면 다음 케이스를 시작하기 전에 Run을 **일시정지**합니다. 한도를 올린 뒤 이어서 실행하세요. ([#32](https://github.com/JaesungLeee/qcard/pull/32))
- 처음 쓰는 팀을 위한 **시작 가이드**와 **스펙 작성 규칙**을 추가했습니다. 로그인하지 않아도 볼 수 있고, 예시 스펙을 내려받을 수 있습니다. ([#34](https://github.com/JaesungLeee/qcard/pull/34))
- **개인정보처리방침**과 **이용약관**을 추가했습니다. 로그인 화면과 데이터 처리 안내에서 볼 수 있습니다. ([#33](https://github.com/JaesungLeee/qcard/pull/33), [#35](https://github.com/JaesungLeee/qcard/pull/35))

### Changed

- 테스트 결과에 기기의 **정확한 OS 빌드 번호와 보안 패치**를 기록합니다. ([#37](https://github.com/JaesungLeee/qcard/pull/37))
- Wi-Fi로 연결한 기기에서는 네트워크를 끄는 케이스를 실행하지 않고 Blocked로 끝냅니다. 연결이 끊겨 Run이 멈추지 않도록, 네트워크를 끄는 케이스는 USB로 연결해 실행하세요. ([#37](https://github.com/JaesungLeee/qcard/pull/37))

## [0.4.0](https://github.com/JaesungLeee/qcard/compare/v0.3.0...v0.4.0) - 2026-10-29

> ⚠ **호스트 업데이트가 필요합니다.** 호스트 0.3.0 이하로는 이 버전에서 테스트를 실행할 수 없습니다.
> PC에서 `npm i -g @qcard/host`로 0.4.0으로 업데이트한 뒤 `qcard serve`를 다시 켜 주세요.

### Changed

- **준비 플로우를 QA 문서 버전마다 따로 관리합니다.** 지금까지는 프로젝트에 준비 플로우가 하나뿐이라 고치면 모든 버전에 바로 반영됐지만, 이제는 버전마다 따로 갖습니다. ([#28](https://github.com/JaesungLeee/qcard/pull/28))
  - 새 QA 문서를 만들면 이전 버전의 준비 플로우를 직접 고친 내용 그대로 이어받습니다.
  - 이전 버전 QA 문서로 테스트 사이클을 돌리면 그 버전의 준비 플로우를 씁니다.

## [0.3.0](https://github.com/JaesungLeee/qcard/compare/v0.2.1...v0.3.0) - 2026-10-29

> ⚠ **호스트 업데이트가 필요합니다.** 호스트 0.2.1 이하로는 테스트가 첫 케이스에서 멈춥니다.
> PC에서 `npm i -g @qcard/host`로 0.3.0으로 업데이트한 뒤 `qcard serve`를 다시 켜 주세요.

### Added

- 테스트 사이클을 **완료**하거나 **다시 열** 수 있습니다. 완료한 사이클에는 새 Run을 시작할 수 없습니다. ([#15](https://github.com/JaesungLeee/qcard/pull/15))
- 잘못 만든 테스트 사이클을 **삭제**할 수 있습니다. 결과·Run·결함·스크린샷도 함께 지워집니다. ([#17](https://github.com/JaesungLeee/qcard/pull/17))
- 사이클 목록을 **시작 전 / 진행 중 / 완료**로 나눠 볼 수 있습니다. ([#20](https://github.com/JaesungLeee/qcard/pull/20))
- Fail 결과에서 바로 **결함을 등록**하고 그 결과와 연결할 수 있습니다. ([#16](https://github.com/JaesungLeee/qcard/pull/16))
- 결과를 직접 입력할 때 **스크린샷을 첨부**할 수 있습니다. ([#18](https://github.com/JaesungLeee/qcard/pull/18))
- 웹에서 **준비 플로우를 편집**하고, 쓰는 케이스가 없는 플로우는 삭제할 수 있습니다. ([#19](https://github.com/JaesungLeee/qcard/pull/19))
- 테스트나 QA 문서 생성을 시작하기 전에 PC의 Claude Code 설치·로그인·버전을 확인하고, 쓸 수 없으면 웹에서 이유를 알려 줍니다. ([#22](https://github.com/JaesungLeee/qcard/pull/22))
- 연결된 PC의 호스트가 너무 오래된 버전이면 테스트를 시작하지 않고 업데이트를 안내합니다. ([#25](https://github.com/JaesungLeee/qcard/pull/25))

### Changed

- 같은 디바이스로 여러 사람이 동시에 테스트해도 같은 케이스를 두 번 실행하지 않습니다. ([#23](https://github.com/JaesungLeee/qcard/pull/23))
- QA 문서에서 일괄 승인·반려할 때, 지금 보이는 페이지가 아니라 필터에 맞는 케이스 전체를 선택합니다. ([#24](https://github.com/JaesungLeee/qcard/pull/24))
- 영구 삭제한 프로젝트는 업로드한 파일까지 모두 지웁니다. ([#13](https://github.com/JaesungLeee/qcard/pull/13))
- 업로드한 스펙·빌드와 사이클에 지정한 빌드가 나중에 바뀌지 않도록 보호합니다. ([#13](https://github.com/JaesungLeee/qcard/pull/13))

### Fixed

- 일시정지된 Run이 남긴 케이스에 어떤 Run이 맡고 있었는지 표시되지 않던 문제를 고쳤습니다. ([#23](https://github.com/JaesungLeee/qcard/pull/23))
- 좁은 화면에서 내용이 짧은 페이지의 헤더가 커지던 문제를 고쳤습니다. ([#20](https://github.com/JaesungLeee/qcard/pull/20))
- 새 사이클 화면의 빌드 정보가 읽기 어렵게 배치되던 문제를 고쳤습니다. ([#14](https://github.com/JaesungLeee/qcard/pull/14))

## [0.2.1](https://github.com/JaesungLeee/qcard/compare/v0.2.0...v0.2.1) - 2026-10-26

> 호스트 0.1.5 → 0.2.1 (0.2.0은 배포하지 않았습니다). 케이스 수정안과 테스트 계정 배정은 이 호스트부터 동작합니다.
> PC에서 `npm i -g @qcard/host`로 업데이트한 뒤 `qcard serve`를 다시 켜 주세요.

### Fixed

- 테스트 계정이 바뀌거나 다음 케이스에 계정이 필요 없으면 앱 데이터를 지워, 이전 계정의 로그인이 디바이스에 남지 않게 했습니다. ([#7](https://github.com/JaesungLeee/qcard/pull/7))
- 앱이 계정 정보를 실제로 거절했을 때만 그 계정을 로그인 실패로 표시합니다. 같은 종류의 계정이 한 Run에서 두 번 실패하면 배정을 멈춰, 계정 전체가 잠기지 않게 했습니다. ([#7](https://github.com/JaesungLeee/qcard/pull/7))
- 로그인이 필요한 케이스에 계정 종류가 비어 있으면 기본 종류로 채웁니다. ([#7](https://github.com/JaesungLeee/qcard/pull/7))

## [0.2.0](https://github.com/JaesungLeee/qcard/compare/host-v0.1.5...v0.2.0) - 2026-10-26

> 케이스 수정안과 테스트 계정 배정을 쓰려면 호스트를 업데이트해야 합니다. 이 기능이 동작하는 호스트는 0.2.1에서 배포했습니다.

### Added

- **테스트 계정 관리**: 테스트에 쓸 계정을 웹에 등록해 두면, 케이스마다 필요한 계정을 자동으로 배정합니다. ([#2](https://github.com/JaesungLeee/qcard/pull/2))
- QA 문서를 만들 때 케이스마다 필요한 계정 종류와, 테스트 뒤 앱을 원래 상태로 되돌리는 플로우를 함께 만듭니다. ([#2](https://github.com/JaesungLeee/qcard/pull/2))
- 스펙 확인 질문을 카테고리별로 하나씩 답할 수 있고, 답한 내용으로 케이스 수정안을 만듭니다. ([#5](https://github.com/JaesungLeee/qcard/pull/5))
- 호스트가 케이스 수정안을 지원하지 않는 이전 버전이면 업데이트를 안내합니다. ([#5](https://github.com/JaesungLeee/qcard/pull/5))
- 테스트 중 위험한 동작을 하기 직전에 멈추고 실행하는 사람에게 확인을 받습니다.
- PC의 로컬 콘솔에서 웹 대시보드를 바로 열 수 있습니다.

### Changed

- Firebase 기본 주소로 접속하면 qcard.dev로 이동합니다.
- 로컬 콘솔을 열어 둔 동안에만 폰 화면을 스트리밍합니다.

### Fixed

- 이전 버전 호스트로 PC를 연결하지 못하던 문제를 고쳤습니다.

## [0.1.1] - 2026-10-26

### Fixed

- 서비스 배포가 실패하던 문제를 고쳤습니다. 사용하는 기능은 달라지지 않습니다. ([#3](https://github.com/JaesungLeee/qcard/pull/3))

## [0.1.0]

0.1.1 이전 변경은 기록하지 않았습니다.
