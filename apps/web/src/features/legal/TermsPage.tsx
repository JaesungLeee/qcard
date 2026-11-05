import { Link } from 'react-router';
import { Contact, LegalPage, type LegalSection } from './LegalPage';
import { OPERATOR } from './policy';

const sections: LegalSection[] = [
  {
    heading: '서비스',
    body: (
      <p>
        qcard는 스펙 문서로 앱 버전별 QA 문서를 만들고, 이용자의 PC에 연결한 Android 디바이스에서 Agent가 테스트를
        수행하며, 그 결과를 프로젝트 멤버와 공유하는 서비스입니다.
      </p>
    ),
  },
  {
    heading: '계정',
    body: (
      <ul>
        <li>GitHub 계정으로 로그인합니다. 계정 관리 책임은 이용자에게 있습니다.</li>
        <li>프로젝트를 만든 사람이 Admin이 되며, Admin은 멤버 초대·역할·프로젝트 설정과 삭제를 맡습니다.</li>
      </ul>
    ),
  },
  {
    heading: 'Claude 사용',
    body: (
      <ul>
        <li>
          QA 문서 생성과 테스트 실행에는 이용자 PC에 설치하고 로그인한 Claude Code가 필요합니다. 사용량은 작업을 실행한
          이용자 본인의 Claude 구독 플랜에서 차감됩니다.
        </li>
        <li>이용자는 Anthropic의 약관과 이용 정책을 지켜야 합니다. qcard는 Claude 계정의 자격 증명을 받지 않습니다.</li>
        <li>
          프로젝트 설정의 실행 안전장치로 사용량을 제한할 수 있지만, 플랜 사용량을 관리할 책임은 이용자에게 있습니다.
        </li>
      </ul>
    ),
  },
  {
    heading: '이용자 자료',
    body: (
      <ul>
        <li>이용자는 올리는 스펙 문서와 앱 빌드를 쓸 권리가 있어야 합니다. 자료의 권리는 이용자에게 남습니다.</li>
        <li>qcard는 서비스를 제공하는 데 필요한 범위에서만 자료를 저장·처리합니다.</li>
        <li>
          테스트에는 테스트 전용 계정과 데이터를 쓰세요. 개인정보 처리는 <Link to="/privacy">개인정보처리방침</Link>을
          따릅니다.
        </li>
      </ul>
    ),
  },
  {
    heading: 'GitHub 이슈 연동',
    body: (
      <ul>
        <li>
          프로젝트 Admin은 qcard GitHub App으로 GitHub 저장소를 연결할 수 있습니다. 연결하려면 그 저장소에 접근할 권한이
          있어야 합니다.
        </li>
        <li>
          이슈는 qcard GitHub App(<code>qcard-bot[bot]</code>) 이름으로 만들어지고, 본문에 발행한 이용자의 GitHub
          사용자명이 남습니다. 무엇을 발행할지, 공개 저장소에 발행해도 되는지는 발행하는 이용자가 판단합니다.
        </li>
        <li>
          발행한 이슈는 GitHub의 약관을 따르며 qcard가 지우지 못합니다. Claude가 쓴 초안은 틀릴 수 있으니 발행 전에
          확인하세요.
        </li>
      </ul>
    ),
  },
  {
    heading: 'Agent 실행',
    body: (
      <ul>
        <li>
          Agent는 이용자가 연결한 디바이스를 자동으로 조작합니다. 실행 대상 앱의 데이터를 초기화하거나 앱을 설치할 수
          있으니 테스트용 디바이스나 테스트 빌드를 쓰세요.
        </li>
        <li>Agent의 판정은 틀릴 수 있습니다. 출시 여부 같은 결정은 사람이 결과와 근거를 확인한 뒤 내려야 합니다.</li>
        <li>
          메시지 발송·결제·삭제 같은 위험 액션은 실행 전에 멈추고 실행자의 승인을 받습니다. 승인한 액션의 결과는 승인한
          이용자의 책임입니다.
        </li>
      </ul>
    ),
  },
  {
    heading: '금지 행위',
    body: (
      <ul>
        <li>테스트할 권한이 없는 앱이나 다른 사람의 계정으로 테스트하는 일</li>
        <li>서비스의 보안 장치를 우회하거나 다른 프로젝트의 데이터에 접근하려는 일</li>
        <li>서비스 운영을 방해할 만큼 과도한 요청을 보내는 일</li>
        <li>법령을 어기는 자료를 올리는 일</li>
      </ul>
    ),
  },
  {
    heading: '서비스 변경과 이용 제한',
    body: (
      <ul>
        <li>qcard는 기능을 바꾸거나 서비스를 중단할 수 있으며, 중요한 변경은 미리 서비스 안에서 알립니다.</li>
        <li>금지 행위가 확인되면 해당 이용자나 프로젝트의 이용을 제한할 수 있습니다.</li>
        <li>
          이용자는 언제든 프로젝트에서 탈퇴하거나 프로젝트를 삭제할 수 있고, 계정 삭제는 문의처로 요청할 수 있습니다.
        </li>
      </ul>
    ),
  },
  {
    heading: '책임의 한계',
    body: (
      <p>
        qcard는 서비스를 있는 그대로 제공합니다. qcard의 고의나 중대한 과실이 없는 한, Agent의 판정 오류, 디바이스나 앱
        데이터의 변경, 이용자의 Claude 플랜 사용량, 발행한 GitHub 이슈의 내용, 이용자 PC·Anthropic·GitHub 등 qcard
        밖에서 생긴 손해에 책임을 지지 않습니다.
      </p>
    ),
  },
  {
    heading: '준거법',
    body: <p>이 약관은 대한민국 법을 따릅니다.</p>,
  },
  {
    heading: '문의와 변경',
    body: (
      <>
        <p>
          문의: <Contact />
        </p>
        <p>약관을 바꾸면 시행 7일 전에 서비스 안에서 알립니다. 이용자에게 불리한 변경은 30일 전에 알립니다.</p>
      </>
    ),
  },
];

/** 이용약관 `/terms`. 로그인하지 않아도 볼 수 있다 */
export function TermsPage() {
  return (
    <LegalPage
      title="이용약관"
      intro={`이 약관은 ${OPERATOR}(이하 "qcard")가 제공하는 qcard 서비스의 이용 조건을 정합니다.`}
      sections={sections}
      other={{ to: '/privacy', label: '개인정보처리방침' }}
    />
  );
}
