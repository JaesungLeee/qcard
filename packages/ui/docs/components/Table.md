# Table

행과 열로 된 데이터 표.

## qcard에서 쓰는 법

- 작은 요약 표(최근 사이클, QA 문서 버전, 결함 목록)에 쓴다.
- 수백 행 편집·정렬·고정 열이 필요한 케이스 그리드와 QA 시트는 PRD대로 AG Grid를 쓰고, 색·글자·간격만 이 시스템 토큰에 맞춘다.
- 판정 셀은 `qcard-verdict-*` 토큰 배지로 표시한다.

## 출처

Montage `@montage-ui/core` 4.1.3의 `Table`(`packages/core/src/components/table`)을 그대로 번들했습니다. 전체 props는 `index.d.ts`의 `TableProps`를 봅니다.
