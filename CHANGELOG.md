# 변경 이력

버전 하나가 서비스(웹·Functions·보안 규칙)와, 바뀐 경우 호스트 에이전트 `@qcard/host`를 함께 가리킨다.
릴리스할 때 Conventional Commits를 보고 작성한다([docs/dev/branching.md](docs/dev/branching.md)).
버전은 [Semantic Versioning](https://semver.org/)을 따른다.

## [0.2.1](https://github.com/JaesungLeee/qcard/compare/v0.2.0...v0.2.1) (2026-10-26)

`@qcard/host` 0.1.5 → 0.2.1(0.2.0은 npm에 배포하지 않았다). 케이스 수정안과 테스트 계정 배정은 이 호스트부터 동작한다.
`npm i -g @qcard/host`로 업데이트하고 `qcard serve`를 다시 켠다.

### 버그 수정

* **host:** 계정이 바뀌거나 다음 케이스에 계정이 필요 없으면 앱 데이터를 지워, 다른 계정의 로그인이 기기에 남지 않게 한다 (F-PF-04) ([#7](https://github.com/JaesungLeee/qcard/pull/7)) ([241ef70](https://github.com/JaesungLeee/qcard/commit/241ef7050b56431ecfc1f46eb0d1939313db6bf7))
* **host:** 앱이 자격 정보를 거절했을 때만 계정을 로그인 실패로 표시하고, 같은 종류가 한 Run에서 두 번 실패하면 배정을 멈춰 계정 풀 전체가 잠기지 않게 한다 (F-PF-08) ([#7](https://github.com/JaesungLeee/qcard/pull/7)) ([241ef70](https://github.com/JaesungLeee/qcard/commit/241ef7050b56431ecfc1f46eb0d1939313db6bf7))
* **qadoc:** 로그인 준비 플로우를 쓰는데 필요 계정 종류가 비어 있으면 기본 종류로 채운다 (F-QD-04) ([#7](https://github.com/JaesungLeee/qcard/pull/7)) ([241ef70](https://github.com/JaesungLeee/qcard/commit/241ef7050b56431ecfc1f46eb0d1939313db6bf7))

## [0.2.0](https://github.com/JaesungLeee/qcard/compare/host-v0.1.5...v0.2.0) (2026-10-26)

`@qcard/host` 0.1.5 → 0.2.0. 케이스 수정안과 테스트 계정 배정은 새 호스트가 있어야 동작한다.
`npm i -g @qcard/host`로 업데이트하고 `qcard serve`를 다시 켠다.

### 새 기능

* **accounts:** 테스트 계정 풀 데이터 계층과 웹 화면 (F-PF-04·08·09) ([#2](https://github.com/JaesungLeee/qcard/pull/2)) ([ec6cb92](https://github.com/JaesungLeee/qcard/commit/ec6cb92fa541bb74a844e27ececfb2df127101a1))
* **agent:** 위험 액션 직전에 멈추고 실행자에게 묻는다 (F-EX-10) ([7b52988](https://github.com/JaesungLeee/qcard/commit/7b52988a0ceccf139fb335c67c4901491d2ed036))
* **host:** 케이스마다 테스트 계정을 호스트에서 배정한다 (F-PF-04·08·09, F-EX-09) ([#2](https://github.com/JaesungLeee/qcard/pull/2)) ([f34e555](https://github.com/JaesungLeee/qcard/commit/f34e5557f0ee155b0575ee8700d3c77e61ba6b86))
* **host:** 호스트가 케이스 수정안을 지원하지 않는 이전 버전이면 업데이트를 안내한다 ([#5](https://github.com/JaesungLeee/qcard/pull/5)) ([09673ef](https://github.com/JaesungLeee/qcard/commit/09673efb9bc65a946b357076c3c1ecb905643e7d))
* **qa-doc:** 답변된 스펙 확인 질문으로 케이스 수정안을 만든다 (F-QD-17) ([#5](https://github.com/JaesungLeee/qcard/pull/5)) ([6970dc0](https://github.com/JaesungLeee/qcard/commit/6970dc04971e85dd5a5f6aa3ea99cc4091faf8d6))
* **qa-doc:** 스펙 확인 질문을 카테고리별로 하나씩 처리한다 ([#5](https://github.com/JaesungLeee/qcard/pull/5)) ([1f74298](https://github.com/JaesungLeee/qcard/commit/1f74298ea4004538924d5fe77e544f9372ad1abf))
* **qadoc:** QA 문서 생성에 필요 계정 종류와 원복 플로우를 더한다 (F-QD-04, F-PF-09) ([#2](https://github.com/JaesungLeee/qcard/pull/2)) ([190a73c](https://github.com/JaesungLeee/qcard/commit/190a73c609673c7bb96225a60efe89254122bd3e))
* **web:** Firebase 기본 도메인을 qcard.dev로 보낸다 ([d465da7](https://github.com/JaesungLeee/qcard/commit/d465da7ca367a126143ba98eee6f1f61d0aa9832))

### 버그 수정

* **host:** 이전 버전 CLI도 PC 연결이 되게 하고, 로컬 콘솔이 웹 대시보드를 연다 ([0ea2162](https://github.com/JaesungLeee/qcard/commit/0ea216207ba0bdb214fd00489f8e862d6f061273))
* **host:** 로컬 콘솔을 보는 동안에만 폰 화면을 스트리밍한다 ([761d5e2](https://github.com/JaesungLeee/qcard/commit/761d5e253d14f579b07a50df95360865f961a73c))
* **web:** qcard.dev가 HTTPS로 응답할 때만 리디렉션한다 ([09e9ecd](https://github.com/JaesungLeee/qcard/commit/09e9ecd0d9a99ba0195077a35860847c598898f9))

## 0.1.1 (2026-10-26)

`main`의 핫픽스. 태그는 없다.

### 버그 수정

* **deploy:** KMS 키 이름을 고정해 CI 배포가 멈추지 않게 한다 ([#3](https://github.com/JaesungLeee/qcard/pull/3)) ([a39cc49](https://github.com/JaesungLeee/qcard/commit/a39cc49702391a832baaa1c8444bc9501a23e92f))

## 0.1.0

0.1.1 이전 변경은 여기에 기록하지 않았다. `@qcard/host`는 0.1.5까지 변경 이력 없이 `main`에서 배포했다.
