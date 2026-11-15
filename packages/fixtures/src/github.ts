/*
 * 가상 앱 하루콩의 GitHub 저장소 (이슈 발행 화면·테스트용, docs/product/issues.md).
 * 웹 메모리 구현과 Functions의 가짜 GitHub(테스트·에뮬레이터)이 같은 값을 쓴다. 실제 팀 저장소가 아니다.
 */

export type SampleRepo = {
  installationId: number;
  repoId: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  /** 저장소 경로 → 내용 */
  files: Record<string, string>;
  labels: string[];
  assignees: string[];
  /** 이미 있는 이슈 (fixture 결함에 연결된 것) */
  issues?: { number: number; title: string; state: 'open' | 'closed' }[];
};

const BUG_FORM = `name: 버그 리포트
description: 앱에서 발견한 버그
title: "[Bug] "
labels: ["bug", "triage"]
body:
  - type: markdown
    attributes:
      value: 버그를 알려 주셔서 고맙습니다.
  - type: textarea
    id: what
    attributes:
      label: 무슨 일이 있었나요?
      description: 실제로 일어난 일과 기대한 동작
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: 재현 절차
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: 앱 버전
  - type: input
    id: device
    attributes:
      label: 기기 / OS
  - type: dropdown
    id: severity
    attributes:
      label: 심각도
      options:
        - Critical
        - Major
        - Minor
        - Trivial
  - type: textarea
    id: logs
    attributes:
      label: 로그
      render: shell
  - type: textarea
    id: cause
    attributes:
      label: 추정 원인
  - type: checkboxes
    id: checks
    attributes:
      label: 확인
      options:
        - label: 같은 이슈가 없는지 찾아봤다
          required: true
`;

const FEATURE_MD = `---
name: 기능 제안
about: 새 기능이나 개선 아이디어
title: "[Feature] "
labels: enhancement
assignees: dev-hana
---
## 배경

## 제안

## 대안
`;

export const HARUKONG_REPO: SampleRepo = {
  installationId: 77,
  repoId: 1001,
  owner: 'harukong',
  name: 'harukong-android',
  private: true,
  defaultBranch: 'main',
  files: {
    '.github/ISSUE_TEMPLATE/bug_report.yml': BUG_FORM,
    '.github/ISSUE_TEMPLATE/feature.md': FEATURE_MD,
    '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false\n',
    '.github/ISSUE_TEMPLATE/old.yml':
      'name: 예전 템플릿\nbody:\n  - type: rating\n    attributes:\n      label: 점수\n',
  },
  labels: ['bug', 'triage', 'enhancement', 'onboarding', 'crash'],
  assignees: ['jaesung-lee', 'minji-kim', 'seojun-choi', 'dev-hana'],
  issues: [{ number: 12, title: '[Bug] 메이트 초대 안내 본문 마침표 누락', state: 'closed' }],
};

/** 같은 설치의 공개 저장소 (공개 경고 확인용) */
export const HARUKONG_PUBLIC_REPO: SampleRepo = {
  installationId: 77,
  repoId: 1002,
  owner: 'harukong',
  name: 'harukong-feedback',
  private: false,
  defaultBranch: 'main',
  files: {},
  labels: ['bug'],
  assignees: ['jaesung-lee'],
};

export const SAMPLE_REPOS = [HARUKONG_REPO, HARUKONG_PUBLIC_REPO];
