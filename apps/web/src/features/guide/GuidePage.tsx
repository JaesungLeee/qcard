import { AUTO_CONFIRM_LABEL, INVITE_TTL_DAYS, type AutoConfirmCondition } from '@qcard/shared';
import { Link } from 'react-router';
import { Code, GuideLayout, Note, Shot, Steps, Ui, type GuideSection } from './GuideLayout';

/*
 * 시작 가이드 `/guide`: 처음 온 팀이 문서만 보고 첫 사이클 결과까지 가는 순서 (PRD §10 공개 출시 완료 기준).
 * 버튼·메뉴 이름은 화면과 같게 쓴다. 화면 흐름을 바꾸면 이 문서와 스크린샷(`pnpm --filter @qcard/web guide:shots`)도 고친다.
 */

export const HOST_README = 'https://www.npmjs.com/package/@qcard/host';

const sections: GuideSection[] = [
  {
    id: 'overview',
    heading: 'qcard가 하는 일',
    body: (
      <>
        <p>
          qcard는 앱의 스펙 문서로 버전별 QA 문서(테스트 케이스)를 만들고, Agent가 실제 Android 기기에서 케이스를 직접
          수행해 결과를 팀과 공유합니다.
        </p>
        <ul>
          <li>
            <b>웹 (qcard.dev)</b>: 팀이 함께 쓰는 곳입니다. 프로젝트·멤버, QA 문서 검토·승인, 테스트 사이클, 결과와
            결함을 봅니다.
          </li>
          <li>
            <b>내 PC + Android 기기</b>: 실행은 각자의 PC에서 합니다. PC에 설치한 호스트 에이전트(
            <code>@qcard/host</code>)가 USB로 연결한 기기를 조작하고, 결과와 스크린샷을 웹에 올립니다.
          </li>
          <li>
            <b>내 Claude 플랜</b>: QA 문서 생성과 테스트 실행에 쓰는 Claude는 PC에 로그인한 본인의 Claude Code로
            부릅니다. 사용량은 작업을 실행한 사람의 플랜에서 차감되고, API 키는 쓰지 않습니다.
          </li>
        </ul>
        <p>처음부터 첫 결과까지는 아래 순서로 진행합니다.</p>
        <Steps>
          <li>프로젝트를 만들고 팀원을 초대합니다.</li>
          <li>PC를 연결합니다.</li>
          <li>스펙을 올려 QA 문서를 만들고 케이스를 승인합니다.</li>
          <li>(로그인이 있는 앱이면) 테스트 계정과 준비 플로우를 정합니다.</li>
          <li>빌드(APK)를 올려 테스트 사이클을 만들고 Run을 시작합니다.</li>
          <li>결과를 확인하고 판정을 확정합니다.</li>
        </Steps>
      </>
    ),
  },
  {
    id: 'requirements',
    heading: '준비물',
    body: (
      <>
        <div className="qg-table-wrap">
          <table className="qg-table">
            <tbody>
              <tr>
                <th>계정</th>
                <td>GitHub 계정 (qcard 로그인), Claude 구독 플랜 (Pro·Max 등)</td>
              </tr>
              <tr>
                <th>PC</th>
                <td>
                  macOS, Node.js 22 이상, adb(<code>brew install android-platform-tools</code>), 로그인한 Claude Code.
                  기기 화면을 실시간으로 보려면 scrcpy(선택)
                </td>
              </tr>
              <tr>
                <th>기기</th>
                <td>
                  Android 기기. 개발자 옵션의 USB 디버깅을 켜고 PC에 USB로 연결합니다. 한글 입력이 있는 케이스는
                  ADBKeyboard가 필요합니다
                </td>
              </tr>
              <tr>
                <th>브라우저</th>
                <td>로컬 콘솔의 라이브 화면은 Chrome 계열 브라우저에서만 보입니다</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Note>
          Run 동안 Agent가 기기를 직접 조작하고 실행 대상 앱의 데이터를 초기화할 수 있습니다. 테스트용 기기나 테스트
          빌드를 쓰세요.
        </Note>
      </>
    ),
  },
  {
    id: 'project',
    heading: '프로젝트 만들기와 팀원 초대',
    body: (
      <>
        <p>프로젝트는 앱 하나의 QA 대시보드입니다. 만든 사람이 Admin이 됩니다.</p>
        <Steps>
          <li>
            GitHub로 로그인한 뒤 내 프로젝트에서 <Ui>새 프로젝트</Ui>를 누릅니다.
          </li>
          <li>
            프로젝트 이름, 앱 이름, 패키지명(테스트할 Android 앱의 applicationId)을 넣고, 데이터 처리 안내를 확인한 뒤{' '}
            <Ui>프로젝트 만들기</Ui>를 누릅니다.
          </li>
          <li>
            사이드바의 <Ui>프로젝트 설정</Ui> → 초대에서 GitHub 사용자명과 역할을 정해 <Ui>초대 보내기</Ui>를 누릅니다.
            사용자명을 비우면 링크를 가진 사람 누구나 들어올 수 있는 <Ui>초대 링크 만들기</Ui>가 됩니다.
          </li>
          <li>만든 초대 링크를 팀원에게 보냅니다. 팀원이 로그인한 뒤 링크에서 수락하면 멤버가 됩니다.</li>
        </Steps>
        <Shot name="members" alt="프로젝트 설정의 멤버와 초대" caption="프로젝트 설정 — 멤버와 초대" />
        <ul>
          <li>
            <b>Admin</b>: 멤버·초대, 프로젝트 설정(실행 안전장치 포함)과 삭제
          </li>
          <li>
            <b>QA</b>: QA 문서 편집·승인, 실행, 판정 확정
          </li>
          <li>
            <b>Viewer</b>: 조회만
          </li>
        </ul>
        <Note>
          초대는 {INVITE_TTL_DAYS}일 뒤 만료됩니다. 지금은 사용자명으로 초대해도 알림이 가지 않으니 초대 링크를 직접
          전해 주세요.
        </Note>
      </>
    ),
  },
  {
    id: 'connect',
    heading: 'PC 연결',
    body: (
      <>
        <p>실행할 PC마다 한 번 연결합니다. 먼저 이 PC의 브라우저로 qcard에 로그인해 두고, 터미널에서 실행합니다.</p>
        <Code>{`npm i -g @qcard/host

qcard doctor     # 준비물 점검 (adb, Claude Code, scrcpy)
qcard connect    # 브라우저가 열리면 [이 PC 연결]을 누릅니다
qcard serve      # 호스트 에이전트를 켭니다 (작업하는 동안 켜 둡니다)`}</Code>
        <Shot name="connect" alt="이 PC 연결 화면" caption="qcard connect가 연 연결 화면" />
        <ul>
          <li>
            <b>이 PC의 터미널에서 직접 시작한 경우에만</b> <Ui>이 PC 연결</Ui>을 누르세요. 연결 정보는 macOS 키체인에
            저장됩니다.
          </li>
          <li>
            <code>qcard serve</code>가 켜져 있어야 웹에서 요청한 QA 문서 생성과 Run을 이 PC가 받아 처리합니다. 켜면 로컬
            콘솔 주소가 출력됩니다.
          </li>
          <li>
            연결한 PC는 내 프로젝트 화면 위쪽의 <Ui>연결된 PC</Ui>에서 보고 해제할 수 있습니다.
          </li>
        </ul>
        <p>
          명령 옵션과 문제 해결은{' '}
          <a href={HOST_README} target="_blank" rel="noreferrer">
            호스트 에이전트 안내(npm)
          </a>
          에 있습니다.
        </p>
      </>
    ),
  },
  {
    id: 'qa-doc',
    heading: '스펙을 올려 QA 문서 만들기',
    body: (
      <>
        <p>
          QA 문서는 앱 버전 하나의 테스트 케이스 묶음입니다. 스펙 문서의 테스트 시나리오(TS)·엣지 케이스(EC) 표에서
          케이스를 만들고, 이전 버전과 출처 ID로 비교해 바뀐 행만 새로 만듭니다. 스펙 형식은{' '}
          <Link to="/guide/spec">스펙 작성 규칙</Link>을 보세요.
        </p>
        <Steps>
          <li>
            사이드바의 <Ui>QA 문서</Ui>에서 <Ui>스펙 업로드 · QA 문서 생성</Ui>을 누릅니다.
          </li>
          <li>
            <Ui>폴더 선택</Ui>으로 <code>docs/specs</code> 폴더를, 또는 <Ui>ZIP 선택</Ui>으로 그 폴더를 묶은 ZIP을
            고릅니다. 스펙마다 신규·변경·동일 행 수를 미리 보여 줍니다.
          </li>
          <li>앱 버전을 넣고 비교할 이전 QA 문서를 고릅니다 (처음이면 없음).</li>
          <li>
            <Ui>내 Claude 플랜으로 생성 요청</Ui>을 누릅니다. 생성은 내 PC의 호스트 에이전트가 하므로{' '}
            <code>qcard serve</code>가 켜져 있어야 합니다.
          </li>
        </Steps>
        <Shot name="qa-doc-new" alt="QA 문서 생성 화면" caption="QA 문서 생성 — 스펙 폴더, 버전, 생성" />
        <p>요청하면 진행 화면으로 갑니다. 스펙별 진행과 기록이 보이고, 끝나면 QA 문서를 열 수 있습니다.</p>
        <Shot name="qa-doc-job" alt="QA 문서 생성 진행 화면" caption="생성 진행 — 다른 멤버도 같은 화면을 봅니다" />
        <Note>
          스펙 원문은 요청한 사람의 Claude 계정으로 Anthropic에 전송됩니다. 자세한 내용은{' '}
          <Link to="/privacy">개인정보처리방침</Link>을 보세요.
        </Note>
      </>
    ),
  },
  {
    id: 'review',
    heading: '케이스 검토와 승인',
    body: (
      <>
        <p>승인된 케이스만 테스트 사이클에서 실행됩니다.</p>
        <ul>
          <li>
            <b>케이스</b> 탭: 케이스마다 출처(스펙의 TS·EC 행), 단계, 검증 포인트, 수행 방식(자동·수동)을 보고 고칩니다.
            이전 버전 대비 바뀐 케이스에는 변경 표시가 붙습니다. 골라서 <Ui>일괄 승인</Ui>하거나 반려합니다.
          </li>
          <li>
            <b>확인 질문</b> 탭: 스펙이 모호해 생긴 질문입니다. 답변을 등록하거나 <Ui>현 스펙대로 진행</Ui>을 고르면
            연결된 케이스의 승인 보류가 풀립니다.
          </li>
          <li>
            <b>보강 제안</b> 탭: 케이스가 연결되지 않은 요구사항에 대해 스펙에 넣을 시나리오를 제안합니다. 케이스가
            아니라 스펙 작성자에게 전할 내용입니다.
          </li>
          <li>
            <b>추적성</b> 탭: 요구사항별로 연결된 케이스와 커버리지를 봅니다.
          </li>
        </ul>
        <Shot name="qa-doc-cases" alt="QA 문서 케이스 목록" caption="QA 문서 — 케이스 검토와 일괄 승인" />
        <Shot name="qa-doc-questions" alt="스펙 확인 질문" caption="확인 질문 — 기능·유저 플로우별로 처리" />
      </>
    ),
  },
  {
    id: 'accounts',
    heading: '테스트 계정과 준비 플로우',
    body: (
      <>
        <p>
          로그인이 없는 앱이면 이 단계는 건너뛰어도 됩니다. 케이스를 실행하기 전에 앱을 필요한 상태로 만드는 방법을
          정합니다.
        </p>
        <ul>
          <li>
            <b>테스트 계정</b>: 사이드바의 <Ui>테스트 계정</Ui>에서 <Ui>계정 추가</Ui>로 로그인 ID, 비밀번호, (있으면)
            인증 앱 TOTP 시드를 등록합니다. 로그인이 필요한 케이스는 실행할 때 비어 있는 계정을 하나씩 배정받습니다.
            비밀값은 암호화해 보관하고 저장한 뒤에는 다시 보여 주지 않습니다. <b>테스트 전용 계정만</b> 등록하세요.
          </li>
          <li>
            <b>준비 플로우</b>: 사이드바의 <Ui>준비 플로우</Ui>에서 로그인, 데이터 상태, 환경, 원복 플로우를 확인 조건과
            수행 스텝으로 정합니다. QA 문서를 만들면 스펙의 사전조건에서 후보를 제안하고, QA 문서 버전마다 따로
            관리합니다.
          </li>
        </ul>
        <Shot name="accounts" alt="테스트 계정 목록" caption="테스트 계정 — 계정 종류별 현황과 상태" />
        <Shot name="prep-flows" alt="준비 플로우 목록" caption="준비 플로우 — QA 문서 버전별" />
        <Note>
          SMS·이메일 인증번호, 본인인증 같은 단계는 Agent가 하지 않습니다. 실행 중에 멈추고 실행자가 기기에서 직접
          입력합니다.
        </Note>
      </>
    ),
  },
  {
    id: 'cycle',
    heading: '테스트 사이클 만들기',
    body: (
      <>
        <p>
          테스트 사이클은 QA 문서 버전 + 빌드 + 대상 디바이스로 묶은 실행 단위입니다. 여러 실행자의 결과가 한 사이클로
          모입니다.
        </p>
        <Steps>
          <li>
            사이드바의 <Ui>테스트 사이클</Ui>에서 <Ui>사이클 만들기</Ui>를 누릅니다.
          </li>
          <li>QA 문서를 고릅니다. 지금 승인된 케이스가 사이클에 고정됩니다.</li>
          <li>
            빌드를 고르거나 <Ui>APK 올리기</Ui>로 올립니다. 배포와 같은 키로 서명된 APK를 올리세요. qcard는 재서명하지
            않고 그대로 설치합니다.
          </li>
          <li>
            대상 디바이스를 모델과 OS 메이저 버전으로 정합니다 (예: Pixel 8 · Android 16). 내 PC에 연결된 기기를 눌러
            바로 넣을 수 있습니다.
          </li>
          <li>이름과 서버 환경을 넣고 사이클을 만듭니다.</li>
        </Steps>
        <Shot name="new-cycle" alt="사이클 만들기 화면" caption="사이클 만들기 — QA 문서, 빌드, 대상 디바이스" />
        <Shot name="cycles" alt="테스트 사이클 목록" caption="테스트 사이클 — 시작 전·진행 중·완료로 나눠 봅니다" />
      </>
    ),
  },
  {
    id: 'run',
    heading: 'Run 실행',
    body: (
      <>
        <p>
          Run은 한 실행자가 자기 기기로 사이클의 남은 칸(케이스 × 대상 디바이스)을 채우는 실행입니다. 기기의 잠금을 풀어
          두고 시작하세요. 같은 기종을 여러 명이 나눠 돌려도 같은 칸을 두 번 실행하지 않습니다.
        </p>
        <ul>
          <li>
            <b>웹에서</b>: 사이클을 열고 <Ui>내 호스트에서 실행 · 남은 N건</Ui>을 누르면 내 PC가 받아 시작합니다.
            일시정지된 Run은 <Ui>이어서 실행</Ui>으로 다시 시작합니다.
          </li>
          <li>
            <b>로컬 콘솔에서</b>: 사이드바의 <Ui>로컬 콘솔</Ui>(또는 <code>qcard serve</code>가 출력한 주소)를 열어
            사이클을 고르고 <Ui>남은 N건 실행</Ui>이나 <Ui>케이스 고르기</Ui>로 시작합니다.
          </li>
        </ul>
        <p>
          일부 케이스만 돌리려면 <Ui>케이스 고르기</Ui>를 엽니다. 웹(사이클 머리)과 로컬 콘솔이 같은 화면입니다. Run은
          자동 케이스만 돌리므로 목록에는 자동 케이스만 나옵니다.
        </p>
        <ul>
          <li>
            처음에는 <b>남은 칸</b>(이 기기 칸에 아직 결과가 없는 케이스)이 모두 골라져 있습니다.
          </li>
          <li>
            <b>판정</b> 필터(남은 칸·Fail·Blocked·확인필요·전체)는 <b>내 기기 칸</b>의 판정 기준입니다. 다른 기기의
            결과는 보지 않습니다. <b>우선순위</b> 필터와 함께 쓸 수 있습니다.
          </li>
          <li>
            목록은 <b>기능</b>(TC ID 가운데 이름, 예: <code>ONBOARDING</code>) → <b>세부 기능</b>으로 묶여 있습니다.
            묶음의 체크로 그 기능을 한꺼번에 고르거나 뺍니다. 묶음 체크와 <Ui>걸러진 N건 모두 고르기</Ui>는 필터로
            걸러진 케이스에만 적용됩니다.
          </li>
          <li>
            이미 결과가 있는 칸은 지금 판정과 함께 <b>다시 실행</b>으로 표시되고, 고르면 다시 실행해 결과를 새로
            냅니다(이전 시도는 이력에 남습니다).
          </li>
        </ul>
        <Shot name="case-pick" alt="케이스 고르기 화면" caption="케이스 고르기 — 판정·우선순위 필터와 기능 묶음" />
        <Shot name="console-home" alt="로컬 콘솔 홈" caption="로컬 콘솔 — 이 기기가 대상인 사이클과 Run 시작" />
        <p>
          실행 중에는 로컬 콘솔에서 기기 화면, Agent의 판단(사고 로그), 단계와 검증 포인트, 스텝 타임라인을 실시간으로
          봅니다. 일시정지·건너뛰기·Take over(직접 조작 후 Agent에 반환)·중단도 여기서 합니다.
        </p>
        <Shot name="console-running" alt="실행 중인 로컬 콘솔" caption="로컬 콘솔 — 실행 중" />
        <p>
          메시지 발송·결제·삭제처럼 결과가 큰 액션이나 수동 스텝 앞에서는 Agent가 멈추고 실행자를 기다립니다. 승인과
          수동 스텝 완료는 <b>로컬 콘솔에서만</b> 할 수 있고, 웹에는 "승인 대기"로만 보입니다. 응답이 없으면 정해진 시간
          뒤 그 케이스는 Blocked가 됩니다.
        </p>
        <Shot name="console-approval" alt="위험 액션 승인 요청" caption="위험 액션 — 승인하거나 직접 실행" />
      </>
    ),
  },
  {
    id: 'results',
    heading: '결과 확인과 판정',
    body: (
      <>
        <p>
          결과는 사이클의 QA 시트에 실시간으로 모입니다. <b>요약</b>(통과율, 진행 매트릭스), <b>테스트 케이스</b>,{' '}
          <b>결함 목록</b>, <b>추적성 매트릭스</b>, <b>환경</b> 탭이 있습니다.
        </p>
        <Shot name="sheet-summary" alt="QA 시트 요약" caption="QA 시트 — 요약" />
        <div className="qg-table-wrap">
          <table className="qg-table">
            <tbody>
              <tr>
                <th>Pass</th>
                <td>
                  자동 확정 조건을 모두 충족했을 때만 Agent가 Pass로 확정합니다:{' '}
                  {(Object.keys(AUTO_CONFIRM_LABEL) as AutoConfirmCondition[])
                    .map((k) => AUTO_CONFIRM_LABEL[k])
                    .join(', ')}
                  . 하나라도 빠지면 확인필요로 둡니다
                </td>
              </tr>
              <tr>
                <th>Fail</th>
                <td>검증 포인트가 하나라도 불일치했거나 앱이 크래시했습니다</td>
              </tr>
              <tr>
                <th>확인필요</th>
                <td>Agent가 판단하지 못했거나 자동 확정 조건을 채우지 못했습니다. 사람이 확정합니다</td>
              </tr>
              <tr>
                <th>Blocked</th>
                <td>
                  준비 실패, 계정 없음, 대기 시간 초과, 실행 한도 초과처럼 케이스를 끝까지 수행하지 못했습니다. 사유가
                  함께 남습니다
                </td>
              </tr>
              <tr>
                <th>N/T</th>
                <td>아직 수행하지 않은 칸입니다</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          칸을 누르면 판정 추적 화면이 열립니다. 테스트 동작 흐름(단계별 스크린샷과 액션), 검증 포인트별 기대·관찰값과
          증거, 판정 이유를 보고 <Ui>판정 확정</Ui>합니다. Fail 칸에서는 <Ui>결함 등록</Ui>으로 결함을 남기고 결과와
          연결합니다.
        </p>
        <Shot name="trace-fail" alt="판정 추적 화면" caption="판정 추적 — 단계별 증거와 검증 포인트" />
        <p>
          수동 케이스는 판정 추적 화면에서 <b>수동 결과 입력</b>으로 판정과 실제 결과를 넣고, 스크린샷을 첨부할 수
          있습니다. 첨부한 스크린샷은 프로젝트 멤버 모두가 보므로 실제 개인정보가 보이는 화면은 올리지 마세요.
        </p>
        <Shot name="trace-manual" alt="수동 결과 입력" caption="수동 결과 입력" />
        <p>
          모든 칸을 확인했으면 사이클 요약에서 <Ui>사이클 완료</Ui>를 누릅니다. 완료한 사이클은 새 Run을 받지 않고,
          필요하면 다시 열 수 있습니다.
        </p>
      </>
    ),
  },
  {
    id: 'usage',
    heading: '사용량과 일시정지',
    body: (
      <>
        <p>
          QA 문서 생성과 Run은 작업한 사람의 Claude 플랜 사용량을 씁니다. 판정 추적 화면과 로컬 콘솔에서 케이스별 토큰을
          볼 수 있습니다. Admin은 <Ui>프로젝트 설정</Ui>의 실행 안전장치에서 케이스당 턴·호출·토큰, Run당 토큰, 실행자
          대기 시간을 정합니다.
        </p>
        <Shot name="run-limits" alt="실행 안전장치 설정" caption="프로젝트 설정 — 실행 안전장치" />
        <p>Run이 멈추면 웹과 로컬 콘솔에 이유가 보입니다. 해결한 뒤 이어서 실행하면 남은 칸부터 다시 돕니다.</p>
        <div className="qg-table-wrap">
          <table className="qg-table">
            <tbody>
              <tr>
                <th>디바이스 잠김</th>
                <td>기기 잠금을 풀고 화면을 켠 뒤 이어서 실행합니다</td>
              </tr>
              <tr>
                <th>디바이스 연결 끊김</th>
                <td>USB를 다시 연결합니다</td>
              </tr>
              <tr>
                <th>플랜 한도</th>
                <td>Claude 플랜 사용량 한도에 닿았습니다. 한도가 풀린 뒤 이어서 실행합니다</td>
              </tr>
              <tr>
                <th>Run 토큰 한도</th>
                <td>실행 안전장치의 Run당 토큰을 넘었습니다. Admin이 한도를 올린 뒤 이어서 실행합니다</td>
              </tr>
              <tr>
                <th>Claude Code 로그인·설치·업데이트 필요</th>
                <td>
                  터미널에서 <code>claude</code>로 로그인하거나 설치·업데이트합니다
                </td>
              </tr>
              <tr>
                <th>네트워크·호스트 연결 끊김</th>
                <td>PC의 네트워크와 절전 상태를 확인합니다. 올리지 못한 결과는 PC에 보관했다가 이어서 보냅니다</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: 'faq',
    heading: '자주 막히는 곳',
    body: (
      <ul>
        <li>
          <b>"내 호스트 에이전트가 꺼져 있습니다"</b>: 이 PC 터미널에서 <code>qcard serve</code>를 켭니다. 처음 쓰는
          PC면 <code>qcard connect</code>부터 합니다.
        </li>
        <li>
          <b>사이클에 내 기기가 대상이 아니라고 나옴</b>: 사이클의 대상 디바이스(모델 + OS 메이저 버전)와 기기가 같아야
          합니다.
        </li>
        <li>
          <b>계정이 필요한 케이스가 Blocked(계정 없음)</b>: 테스트 계정에서 그 종류의 계정을 추가하거나, 로그인
          실패·격리 표시를 확인합니다.
        </li>
        <li>
          <b>확인필요가 많음</b>: 앱에 testTag를 달면 Agent가 접근성 트리로 확인할 수 있어 자동 확정이 늘어납니다.{' '}
          <Link to="/guide/spec#testtag">스펙 작성 규칙</Link>을 보세요.
        </li>
        <li>
          <b>기기가 보이지 않음, 연결 화면 오류 등 PC 쪽 문제</b>:{' '}
          <a href={HOST_README} target="_blank" rel="noreferrer">
            호스트 에이전트 안내(npm)
          </a>
          의 문제 해결을 보세요.
        </li>
      </ul>
    ),
  },
];

/** 시작 가이드 `/guide`. 로그인하지 않아도 볼 수 있다 */
export function GuidePage() {
  return (
    <GuideLayout
      title="시작 가이드"
      intro="프로젝트를 만들고 PC를 연결해 첫 테스트 사이클 결과를 보기까지의 순서입니다."
      sections={sections}
      links={[
        { to: '/guide/spec', label: '스펙 작성 규칙' },
        { to: '/privacy', label: '개인정보처리방침' },
        { to: '/login', label: '로그인' },
      ]}
    />
  );
}
