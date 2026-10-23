import { describe, expect, it } from 'vitest';
import { nameChecker, unmarkUnknownNames } from './names';

describe('버튼 이름 확인', () => {
  const known = nameChecker(['[저장]을 누르면 다음 화면으로 간다', "'건너뛰기' 버튼", '공유 버튼을 누른다']);

  it('괄호·따옴표로 감싼 이름과 "이름 버튼"만 근거로 인정한다', () => {
    expect(['저장', '건너뛰기', '공유'].map(known)).toEqual([true, true, true]);
    // 문장 속 낱말("다음 화면")은 버튼 이름의 근거가 아니다
    expect(known('다음')).toBe(false);
  });

  it('근거 없는 [이름]은 이름(추정)으로 바꾼다', () => {
    expect(unmarkUnknownNames('[다음]을 누르고 [저장]을 누른다', known)).toEqual({
      text: '다음(추정)을 누르고 [저장]을 누른다',
      guessed: ['다음'],
    });
  });
});
