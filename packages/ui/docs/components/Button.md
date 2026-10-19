# Button

화면의 주요·보조 동작을 실행하는 버튼.

## qcard에서 쓰는 법

- 화면당 `solid` + `primary`는 하나(예: 사이클 만들기, 승인).
- 보조 동작은 `outlined` + `assistive`(편집, MD 다운로드).
- 되돌리기 어려운 동작은 `color="negative"`(반려, 삭제).
- 크기: 표 툴바·상세 패널 `small`, 페이지 헤더 `medium`.
- 처리 중에는 `loading`을 켜서 중복 클릭을 막는다.

## 출처

Montage `@montage-ui/core` 4.1.3의 `Button`(`packages/core/src/components/button`)을 그대로 번들했습니다. 전체 props는 `index.d.ts`의 `ButtonProps`를 봅니다.
