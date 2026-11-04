> **저장소 안내** — 이 문서는 디자인 시스템 아티팩트 "Montage for qcard"(https://claude.ai/artifact/6Jc4yY1xFNcvLZSHeyQFhb)의 README를 2026-10-20에 복사한 것이다. 저장소에서는 다음처럼 쓴다.
> - 토큰 원본: `packages/ui/tokens/tokens.json` → `pnpm tokens`로 `--qc-<토큰 이름>` CSS 변수와 TS 타입을 생성한다. 코드에서는 `token('foreground-neutral-primary')`.
> - 컴포넌트: 아티팩트의 `window.MontageQcard` 번들 대신 npm `@montage-ui/core`·`@montage-ui/icon` 4.1.3을 `@qcard/ui`에서 재수출한다. 아이콘은 `Icons.IconSearch`.
> - 판정 배지: `VerdictBadge`. 타이포: `textClass('label1', 'medium')`.
> - 컴포넌트별 가이드: `docs/components/*.md`.

# Montage for qcard

qcard 웹 대시보드에 쓰는 디자인 시스템입니다. 원티드랩이 공개한 Montage 디자인 시스템([wanteddev/montage-web](https://github.com/wanteddev/montage-web), MIT)의 토큰을 그대로 가져오고, QA 도구에 필요한 판정(verdict) 색만 `qcard-` 접두어로 덧붙였습니다. 원티드의 로고·브랜드 에셋은 포함하지 않습니다 — qcard는 원티드 제품이 아니며, 디자인 언어만 빌려 씁니다.

- 출처: `wanteddev/montage-web` `main@9eb1f67`, `packages/theme` (2026-10-20 동기화)
- 라이선스: Montage 코드 MIT © 2026 Wanted Lab, Inc. · Pretendard SIL OFL 1.1 © Kil Hyung-jin

## 원칙

- **정보가 먼저, 장식은 나중.** qcard 화면은 읽기보다 훑어보고 판단하는 화면입니다. 색은 상태를 말할 때만 쓰고, 나머지는 cool-neutral 계열로 조용하게 둡니다.
- **semantic 토큰으로 칠하고, atomic은 예외로만.** 화면은 `foreground-*`, `background-*`, `surface-*`, `line-*`로 그립니다. `atomic-*`은 semantic에 해당 역할이 없을 때만 씁니다.
- **반투명 토큰은 겹치지 않게.** `surface-neutral-secondary`, `line-neutral-primary` 같은 토큰은 알파 값이 있어 위에 겹치면 진해집니다. 겹쳐 그려야 하면 `*-opaque` 버전을 씁니다.

## 컬러

| 역할 | 토큰 | 쓰는 곳 |
| --- | --- | --- |
| 페이지 배경 | `background-neutral-primary` / `background-neutral-secondary` | 본문 영역 / 사이드바·그룹 영역 |
| 카드·패널 | `surface-neutral-primary` + `line-neutral-secondary` 테두리 | 그림자 없이 선으로 구분 |
| 표 헤더·호버 | `surface-neutral-tertiary` | |
| 선택된 행·내비 | `surface-brand-subtle` + `foreground-brand-primary` 글자 | |
| 주요 버튼 | `surface-brand-primary` → 호버 `surface-brand-strong` → 눌림 `surface-brand-heavy` | 글자는 `static-white` |
| 상단 바·토스트 | `surface-neutral-inverse` + `foreground-neutral-inverse` | |
| 본문 텍스트 | `foreground-neutral-primary` | |
| 보조 텍스트 | `foreground-neutral-secondary` (설명) · `foreground-neutral-tertiary` (레이블) | |
| 구분선 | `line-neutral-tertiary` (표 행) · `line-neutral-secondary` (카드) · `line-neutral-primary` (입력 필드) | |
| 포커스 링 | `line-brand-focus` 3px + `line-brand-strong` 1px | |

### 판정 색 (qcard 확장)

Montage의 `foreground-positive-primary`(#00bf40), `foreground-cautionary-primary`(#ff9200)는 흰 배경에서 작은 글자로 쓰면 4.5:1에 못 미칩니다. 그래서 판정 배지·셀은 Montage atomic 팔레트의 어두운 단계로 만든 `qcard-verdict-*` 토큰을 씁니다.

| 판정 | 글자 / 배경 | 비고 |
| --- | --- | --- |
| Pass | `qcard-verdict-pass-fg` / `qcard-verdict-pass-bg` | green 30 / 95 |
| Fail | `qcard-verdict-fail-fg` / `qcard-verdict-fail-bg` | red 30 / 95 |
| Blocked | `qcard-verdict-blocked-fg` / `qcard-verdict-blocked-bg` | orange 30 / 95 |
| 확인필요 | `qcard-verdict-check-fg` / `qcard-verdict-check-bg` | Montage에 노랑이 없어 qcard가 추가. Blocked와 명도로 구분 |
| N/T · N/A | `qcard-verdict-nt-fg` / `qcard-verdict-nt-bg` | cool-neutral |

판정은 색만으로 구분하지 않습니다. 셀과 배지에는 항상 글자(Pass, Fail, Blocked, 확인필요)나 머리글자(P, F, B, ?)를 함께 씁니다.

`foreground-accent-*`, `surface-accent-*`는 기능·스펙 태그처럼 카테고리를 구분할 때만 쓰고, 상태 의미로는 쓰지 않습니다.

## 타이포그래피

글꼴은 Pretendard 하나입니다(400·500·600·700, `fonts/`에 KS X 1001 서브셋 woff2 포함). TC ID, 해시, 시간 같은 고정폭 데이터만 `mono` 패밀리를 씁니다.

| qcard에서 | 스타일 |
| --- | --- |
| 화면 제목 | `title3` bold (24/32) |
| 섹션 제목 | `headline2` bold (17/24) |
| 본문·표 셀 | `label1` regular (14/20) |
| 상세 패널 본문 | `body2-reading` (15/24) |
| 표 헤더·메타 정보 | `label2` medium (13/18) |
| 배지·캡션 | `caption1` medium (12/16) |

Montage는 스타일마다 regular·medium·bold 세 가지 굵기를 둡니다. display~title은 bold가 700, heading 이하는 600입니다. 자간(letter-spacing)은 스타일마다 정해진 값을 그대로 씁니다.

## 간격 · 모서리 · 그림자

- 간격은 `space-*` 스케일(2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40 …)만 씁니다. 표 셀 안쪽 여백은 `space-10`·`space-12`, 카드 안쪽은 `space-16`~`space-20`, 섹션 사이는 `space-24`.
- 모서리는 배지 `radius-4`, 입력·작은 버튼 `radius-8`, 버튼 `radius-10`, 카드·패널 `radius-12`, 모달 `radius-16`, 칩·아바타 `radius-full`.
- 그림자는 떠 있는 요소에만 씁니다: 드롭다운 `shadow-medium`, 드로어 `shadow-large`, 모달 `shadow-xlarge`. 카드에는 쓰지 않고 선으로 구분합니다.

## 컴포넌트

Montage `@montage-ui/core` 4.1.3과 `@montage-ui/icon` 4.1.3의 공개 빌드를 하나의 스크립트(`components/bundle.js`)로 묶었습니다. React 18 위에서 `window.MontageQcard.<컴포넌트>`로 씁니다. 스타일은 Montage가 런타임에 주입하고(Emotion), 테마 변수와 리셋은 `components/bundle.css`에 있습니다. 다크 모드는 `<html data-theme="dark">`를 따릅니다.

| 그룹 | 컴포넌트 | qcard에서 |
| --- | --- | --- |
| Actions | `Button`, `TextButton`, `IconButton` | 승인·편집·반려, 전체 보기, 알림·펼치기 |
| Selection | `Chip`, `Checkbox`, `Switch` | 변경·판정 필터, 행 선택, 프로젝트 설정 |
| Navigation | `Tab`, `SegmentedControl` | QA 시트 ①~⑤ 탭, 보기 전환 |
| Inputs | `TextField` | 케이스 검색 |
| Display | `ContentBadge`, `Table` | 수행 방식·유형 배지, 요약 표 |
| Feedback | `SectionMessage` | 승인 보류, 자동 확정 불가, Blocked 사유 |

- 판정 배지·셀은 Montage 컴포넌트 색 대신 `qcard-verdict-*` 토큰으로 그립니다(위 판정 색 참고).
- 수백 행을 편집하는 케이스 그리드와 QA 시트는 AG Grid를 쓰고, 색·글자·간격만 이 시스템 토큰에 맞춥니다. `Table`은 작은 요약 표용입니다.
- 번들에는 위 12종 외에도 Montage의 다른 컴포넌트(Modal, Select, Tooltip, Toast, Pagination 등 60여 종)와 아이콘 359종(`MontageQcard.Icons.IconSearch` 등)이 함께 들어 있습니다. 카드와 가이드는 아직 12종만 작성했습니다.

## 아이콘

Montage 아이콘은 번들의 `MontageQcard.Icons`로 씁니다(예: `IconSearch`, `IconBell`, `IconPlus`, `IconChevronRightSmall`). 아이콘만 있는 버튼에는 `aria-label`을 붙입니다.

## Not synced

- 컴포넌트: 리포지토리(pnpm 12 + lerna) 대신, 같은 버전(4.1.3)의 npm 공개 빌드를 esbuild로 묶었습니다. 카드는 12종만 작성했습니다.
- 로티(`packages/lottie`): 가져오지 않았습니다.
- 브랜드(`packages/brand`): 원티드 로고·브랜드 에셋이라 의도적으로 제외했습니다.
- breakpoint, z-index, dimension 토큰: 가져오지 않았습니다.
- 그림자는 `normal` 계열만 가져왔습니다(`drop`, `spread` 제외).
- Montage 원본의 다크 테마 그림자는 라이트와 같은 값입니다.
