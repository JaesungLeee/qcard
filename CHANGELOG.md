# 변경 이력

버전 하나가 서비스(웹·Functions·보안 규칙)와, 바뀐 경우 호스트 에이전트 `@qcard/host`를 함께 가리킨다.
릴리스할 때 Conventional Commits를 보고 작성한다([docs/dev/branching.md](docs/dev/branching.md)).
버전은 [Semantic Versioning](https://semver.org/)을 따른다.

## [0.3.0](https://github.com/JaesungLeee/qcard/compare/v0.2.1...v0.3.0) (2026-10-29)

`@qcard/host` 0.2.1 → 0.3.0. **서비스와 함께 업데이트해야 한다** — 0.2.1 호스트는 이 버전의 서비스에서 Run을 실행하지 못한다.
`npm i -g @qcard/host`로 업데이트하고 `qcard serve`를 다시 켠다.

### ⚠ 호환되지 않는 변경

* **cycles:** Run의 지금 칸(`currentTcId`)은 Functions(`claimCell`)만 정한다. 0.2.1 이하 호스트는 첫 케이스에서 보안 규칙에 막혀 Run이 멈추고, 웹은 그 호스트로 Run을 시작하지 않는다 (F-CY-06) ([#23](https://github.com/JaesungLeee/qcard/pull/23)) ([9f2093c](https://github.com/JaesungLeee/qcard/commit/9f2093ccb0895901d3a9afbaa3e3e47b3fdb3edb))

### 새 기능

* **cycles:** 케이스를 시작하기 전에 케이스 × 디바이스 칸을 선점해, 같은 대상 디바이스로 동시에 돌려도 한 칸을 두 번 실행하지 않는다 (F-CY-06) ([#23](https://github.com/JaesungLeee/qcard/pull/23)) ([9f2093c](https://github.com/JaesungLeee/qcard/commit/9f2093ccb0895901d3a9afbaa3e3e47b3fdb3edb))
* **cycles:** 테스트 사이클을 완료하고 다시 연다. 완료된 사이클은 새 Run을 받지 않는다 (F-CY-09) ([#15](https://github.com/JaesungLeee/qcard/pull/15)) ([f7937a7](https://github.com/JaesungLeee/qcard/commit/f7937a7758e9f4669d982c72b186c104cdeee134))
* **cycles:** 잘못 만든 테스트 사이클을 결과·Run·결함·증거와 함께 삭제한다 (F-CY-10) ([#17](https://github.com/JaesungLeee/qcard/pull/17)) ([cff4284](https://github.com/JaesungLeee/qcard/commit/cff4284858c1ad00e8d583c58b419d6ff15227e8))
* **cycles:** 사이클 목록을 시작 전·진행 중·완료 칩으로 나눈다 (F-CY-09) ([#20](https://github.com/JaesungLeee/qcard/pull/20)) ([72f77fb](https://github.com/JaesungLeee/qcard/commit/72f77fb4919924429ff1339e4774274fab3dfdee))
* **defects:** Fail 결과에서 결함을 등록하고 그 칸과 연결한다 (F-RP-19) ([#16](https://github.com/JaesungLeee/qcard/pull/16)) ([2d04f94](https://github.com/JaesungLeee/qcard/commit/2d04f942b17b5201503704e39746311a203e0b51))
* **host:** Run·QA 문서 생성을 시작하기 전에 Claude Code 설치·로그인·버전을 점검하고, 쓸 수 없으면 이유를 웹에 알린다 (F-EX-17, F-DB-09) ([#22](https://github.com/JaesungLeee/qcard/pull/22)) ([004c970](https://github.com/JaesungLeee/qcard/commit/004c9705bb08901d7e5640ccccb8cd886ef2b64e))
* **host:** 호스트가 버전을 알리고, 웹은 최소 버전(0.3.0)보다 낮은 호스트로 Run을 시작하지 않고 업데이트를 안내한다 ([#25](https://github.com/JaesungLeee/qcard/pull/25)) ([5b69d40](https://github.com/JaesungLeee/qcard/commit/5b69d4018b319ddec9eb420807437820c5242fa8))
* **prep-flows:** 웹에서 준비 플로우를 편집하고, 쓰는 케이스가 없으면 삭제한다 (F-PF-01) ([#19](https://github.com/JaesungLeee/qcard/pull/19)) ([c45fae0](https://github.com/JaesungLeee/qcard/commit/c45fae0287ea982931327b133b82603606ee9b17))
* **projects:** 영구 삭제한 프로젝트의 Storage 파일도 지운다 (F-TM-12) ([#13](https://github.com/JaesungLeee/qcard/pull/13)) ([48f5e36](https://github.com/JaesungLeee/qcard/commit/48f5e36bbe1a58eb71e9ce36dac36d9a24a0f7ca))
* **qa-doc:** 일괄 승인·반려에서 보이는 페이지가 아니라 필터에 맞는 케이스 전체를 선택한다 ([#24](https://github.com/JaesungLeee/qcard/pull/24)) ([c964fc2](https://github.com/JaesungLeee/qcard/commit/c964fc2733d66c8189c88165d3314ce6b31ff38c))
* **results:** 수동 결과를 입력하며 스크린샷을 첨부한다 (F-RP-05) ([#18](https://github.com/JaesungLeee/qcard/pull/18)) ([2cede9a](https://github.com/JaesungLeee/qcard/commit/2cede9a2d6146026c839b0dd04d12c76d9cf7ab7))

### 버그 수정

* **rules:** 올린 스펙 스냅샷·빌드와 사이클의 빌드를 덮어쓰지 못하게 한다 (F-IN-03, F-DV-05) ([#13](https://github.com/JaesungLeee/qcard/pull/13)) ([0140bfe](https://github.com/JaesungLeee/qcard/commit/0140bfe6c48a8bbe81b5c9f4ab73aa3977874f79))
* **web:** 일시정지된 Run이 남긴 칸에 그 칸을 잡은 Run을 보여 준다 ([#23](https://github.com/JaesungLeee/qcard/pull/23)) ([af07f29](https://github.com/JaesungLeee/qcard/commit/af07f297921bf5d7634682c8b0f5dae4d1062cdb))
* **web:** 내용이 짧은 페이지에서도 좁은 폭 헤더를 작게 유지한다 ([#20](https://github.com/JaesungLeee/qcard/pull/20)) ([3d2b556](https://github.com/JaesungLeee/qcard/commit/3d2b556ee25c5a0e05ebf42ba112ae7917a520d4))
* **web:** 새 사이클 화면의 빌드 정보를 항목·값 쌍으로 배치한다 ([#14](https://github.com/JaesungLeee/qcard/pull/14)) ([01a3c45](https://github.com/JaesungLeee/qcard/commit/01a3c45e5d7b2725daf0c8249b71c642cf7577ab))

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
