# ContentBadge

짧은 상태·분류 라벨.

## qcard에서 쓰는 법

- 수행 방식(Auto/Manual), 테스트 유형, 변경(신규/변경) 표시에 쓴다.
- 색 지정은 Montage 토큰 경로로 한다(예: `accentColor="semantic.foreground.accent.violet"`).
- **판정(Pass/Fail/Blocked/확인필요)은 이 배지의 accent 색 대신 `qcard-verdict-*` 토큰을 쓴다** — Montage 상태색은 작은 글자 대비가 부족하다(README 참고).
- 색만으로 의미를 전달하지 않는다.

## 출처

Montage `@montage-ui/core` 4.1.3의 `ContentBadge`(`packages/core/src/components/content-badge`)을 그대로 번들했습니다. 전체 props는 `index.d.ts`의 `ContentBadgeProps`를 봅니다.
