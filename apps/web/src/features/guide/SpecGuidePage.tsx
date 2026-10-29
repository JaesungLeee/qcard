import { Link } from 'react-router';
import { Code, GuideLayout, Note, type GuideSection } from './GuideLayout';

/*
 * 스펙 작성 규칙 `/guide/spec`. 파서(`packages/spec/src/parse.ts`)가 실제로 읽는 형식만 쓴다.
 * 파서가 읽는 형식을 바꾸면 이 문서도 고친다. 예시 ZIP은 `pnpm --filter @qcard/web guide:example`로 만든다.
 */

export const EXAMPLE_ZIP = '/guide/harukong-specs.zip';

const sections: GuideSection[] = [
  {
    id: 'folder',
    heading: '폴더 구조',
    body: (
      <>
        <p>
          기능마다 폴더 하나에 <code>spec.md</code>를 둡니다. QA 문서를 만들 때 <code>docs/specs</code> 폴더 전체(또는
          그 폴더를 묶은 ZIP)를 올립니다.
        </p>
        <Code>{`docs/specs/
├─ onboarding-flow/
│  └─ spec.md
└─ account/
   ├─ spec.md
   └─ plan.md        ← 읽지 않습니다`}</Code>
        <ul>
          <li>
            폴더 이름이 스펙 이름입니다. 각 폴더의 <code>spec.md</code>만 읽고 다른 파일은 무시합니다.
          </li>
          <li>
            앱 버전마다 그 버전의 스펙 전체를 올립니다. 일부 기능만 올리면 빠진 스펙의 케이스는 삭제로 판정됩니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'header',
    heading: '머리말',
    body: (
      <>
        <p>
          문서 맨 위 제목(<code>#</code>) 아래에 굵은 글씨 항목으로 씁니다. 읽는 항목은 아래 네 가지이고, 모두
          선택입니다.
        </p>
        <Code>{`# 스펙 명세서: 첫 실행 온보딩

**버전**: 1.3.0
**기준 PRD 버전**: 2.0.0
**상태**: CREATED
**최종 수정일**: 2026-09-20`}</Code>
      </>
    ),
  },
  {
    id: 'requirements',
    heading: '요구사항',
    body: (
      <>
        <p>
          기능 요구사항은 <code>FR-</code>, UX 규칙은 <code>UX-</code>로 번호를 붙여 목록 한 줄에 씁니다. 줄 끝의{' '}
          <code>(근거: …)</code>는 근거로 따로 남깁니다.
        </p>
        <Code>{`- **FR-001**: 시스템은 반드시 온보딩을 닉네임 설정 → 첫 습관 만들기 순서로 진행한다.
- **FR-002**: 시스템은 반드시 닉네임 저장에 성공해야만 다음 스텝을 연다. (근거: 정책 2.1)
- **UX-001**: 이미 끝낸 스텝의 결과는 뒤 스텝의 조작으로 취소되지 않는다.`}</Code>
        <p>요구사항은 케이스가 되지 않습니다. 시나리오 표의 「관련 FR」로 연결해 추적성과 커버리지를 봅니다.</p>
      </>
    ),
  },
  {
    id: 'scenarios',
    heading: '유저 플로우와 시나리오 표',
    body: (
      <>
        <p>
          케이스는 <b>시나리오 표의 행에서만</b> 만들어집니다. 표는 <code>### 유저 플로우 N - 제목</code> 헤딩 아래에
          둡니다. 유저 플로우 밖의 표 행은 경고가 납니다.
        </p>
        <p>
          <b>테스트 시나리오(TS)</b>: 머리줄에 <code>ID</code>, <code>시나리오</code>, <code>Given</code>,{' '}
          <code>When</code>, <code>Then</code>, <code>관련 FR</code>이 있어야 합니다.
        </p>
        <Code>{`### 유저 플로우 1 - 온보딩을 처음부터 끝까지 밟는다

| ID | 시나리오 | Given | When | Then | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| TS-001 | 첫 스텝은 닉네임 설정 | 닉네임이 없는 앱 설치에서 온보딩 시작 | 화면을 확인한다 | 닉네임 설정 스텝이 열려 있다 | FR-001, FR-005 |
| TS-002 | 닉네임을 저장하면 첫 습관 스텝으로 | 규칙에 맞는 닉네임이 입력되어 있다 | [저장]을 누른다 | 첫 습관 만들기 스텝이 열린다 | FR-001, FR-002 |`}</Code>
        <p>
          <b>엣지 케이스(EC)</b>: 머리줄에 <code>ID</code>, <code>상황</code>, <code>처리</code>, <code>관련 FR</code>이
          있어야 합니다.
        </p>
        <Code>{`| ID | 상황 | 처리 | 관련 FR |
| --- | --- | --- | --- |
| EC-001 | 닉네임 저장에 실패한다 | 닉네임 설정 스텝에 머무르고 다음으로 가지 않는다 | FR-002 |`}</Code>
        <ul>
          <li>
            ID는 <code>TS-001</code>, <code>EC-001</code> 형식입니다. 사이에 끼워 넣을 때는 <code>TS-002a</code>,{' '}
            <code>TS-003-1</code>처럼 접미사를 붙입니다.
          </li>
          <li>
            칸 안에 <code>|</code>를 쓰려면 <code>\|</code>로 씁니다.
          </li>
          <li>Then(EC는 처리)이 비면 경고가 납니다. 케이스의 기대 결과가 되기 때문입니다.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ids',
    heading: '버전 사이의 ID 규칙',
    body: (
      <>
        <p>
          새 버전의 QA 문서를 만들면 이전 버전과 <b>스펙 이름 + 행 ID</b>로 짝을 짓습니다. 내용이 같은 행은 이전
          케이스를 그대로 복사하고(Claude를 부르지 않음), 바뀐 행만 새로 만들며, 케이스 ID(TC ID)를 이어받습니다.
        </p>
        <ul>
          <li>
            <b>지운 ID를 다시 쓰지 마세요.</b> 다른 시나리오에 예전 ID를 붙이면 예전 케이스의 이력과 섞입니다.
          </li>
          <li>시나리오의 뜻이 바뀌면 고치지 말고 새 ID로 추가한 뒤 예전 행을 지우세요.</li>
          <li>표현만 다듬어도 그 행은 "변경"으로 판정되어 다시 만들어집니다.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'writing',
    heading: '좋은 시나리오 쓰기',
    body: (
      <ul>
        <li>
          <b>Then은 화면에서 확인할 수 있게</b> 씁니다. "저장된다"보다 "토스트 '저장했습니다'가 뜨고 목록에 새 항목이
          보인다"가 검증 포인트로 바뀌기 쉽습니다.
        </li>
        <li>
          <b>Given에는 시작 상태</b>를 씁니다. 로그인 여부, 데이터 개수 같은 상태는 준비 플로우와 테스트 계정으로
          만들어집니다.
        </li>
        <li>
          <b>버튼은 화면의 글자 그대로</b> <code>[저장]</code>처럼 씁니다.
        </li>
        <li>
          본인인증·SMS 인증번호 같은 단계는 Agent가 하지 않고, 실행 중에 멈춰 실행자에게 넘깁니다. 그런 단계가 있다고
          스펙에 적어 두면 케이스를 검토할 때 알아보기 쉽습니다.
        </li>
        <li>모호한 곳은 QA 문서의 확인 질문으로 돌아옵니다. 답을 스펙에 반영하면 다음 버전부터 질문이 줄어듭니다.</li>
      </ul>
    ),
  },
  {
    id: 'testtag',
    heading: '앱에 testTag 달기 (권장)',
    body: (
      <>
        <p>
          Agent는 화면을 접근성 트리로 읽습니다. 요소에 고유한 ID가 있으면 더 정확하게 찾고, 검증 포인트를 트리로 확인할
          수 있어 Pass 자동 확정이 늘어납니다(트리로 확인하지 못하면 확인필요로 남습니다).
        </p>
        <ul>
          <li>
            Jetpack Compose: 주요 요소에 <code>Modifier.testTag("...")</code>를 달고, 화면 루트에{' '}
            <code>
              Modifier.semantics {'{'} testTagsAsResourceId = true {'}'}
            </code>
            를 켭니다.
          </li>
          <li>
            View 시스템: <code>android:id</code>가 그대로 보입니다. 이미지 버튼에는 <code>contentDescription</code>을
            넣습니다.
          </li>
          <li>
            선택 표시 점처럼 접근성 트리에 나오지 않는 요소는 상태를 텍스트나 contentDescription으로 드러내 주세요.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'example',
    heading: '예시 스펙',
    body: (
      <>
        <p>
          가상 앱 하루콩(습관 기록 앱)의 온보딩 스펙입니다. 형식을 참고하거나, 새 프로젝트에 올려 QA 문서 생성을 해 볼
          수 있습니다. 실제 앱이 없으므로 테스트 사이클 실행은 내 앱의 스펙으로 하세요.
        </p>
        <p>
          <a href={EXAMPLE_ZIP} download>
            하루콩 예시 스펙 내려받기 (ZIP)
          </a>{' '}
          — <code>docs/specs/onboarding-flow/spec.md</code>
        </p>
        <Note>
          QA 문서 생성 방법은 <Link to="/guide#qa-doc">시작 가이드</Link>를 보세요.
        </Note>
      </>
    ),
  },
];

/** 스펙 작성 규칙 `/guide/spec`. 로그인하지 않아도 볼 수 있다 */
export function SpecGuidePage() {
  return (
    <GuideLayout
      title="스펙 작성 규칙"
      intro="qcard가 읽는 spec.md 형식입니다. 케이스는 유저 플로우 아래 시나리오 표의 행에서 만들어집니다."
      sections={sections}
      links={[
        { to: '/guide', label: '시작 가이드' },
        { to: '/login', label: '로그인' },
      ]}
    />
  );
}
