import { center, FakeDevice, findElement, UnexpectedActionError } from '@qcard/device';
import { describe, expect, it } from 'vitest';
import { APP_PACKAGE, onboardingScenario, validNickname } from './device';

async function tap(d: FakeDevice, id: string) {
  const el = findElement(await d.dumpTree(), id);
  if (!el) throw new Error(`${d.current}에 ${id} 없음`);
  await d.tap(...center(el.bounds));
}

describe('합성 온보딩 시나리오', () => {
  it('런처에서 홈까지 온보딩을 끝까지 갈 수 있다', async () => {
    const d = new FakeDevice(onboardingScenario());
    await d.launchApp(APP_PACKAGE);
    await d.dumpTree();
    expect(findElement(await d.dumpTree(), 'profile_title')?.text).toBe('닉네임 설정');
    await tap(d, 'profile_nickname');
    await d.inputText('콩콩이');
    await tap(d, 'profile_save');
    await tap(d, 'room_name');
    await d.inputText('물 2L 마시기');
    await tap(d, 'room_create');
    expect(d.current).toBe('invite');
    await tap(d, 'invite_close');
    for (let n = 1; n < 5; n++) await d.swipe([900, 1200], [180, 1200]);
    expect(findElement(await d.dumpTree(), 'tutorial_step')?.text).toBe('STEP 5');
    await tap(d, 'tutorial_start');
    expect(d.current).toBe('home');
  });

  it('닉네임 형식이 틀리면 저장해도 넘어가지 않는다', async () => {
    const d = new FakeDevice({ ...onboardingScenario(), start: 'profile' });
    await tap(d, 'profile_nickname');
    await d.inputText('하루콩');
    await expect(tap(d, 'profile_save')).rejects.toBeInstanceOf(UnexpectedActionError);
    expect(['하루콩', '하루콩!', 'abcdefghijk'].map(validNickname)).toEqual([false, false, false]);
    expect(['하루콩하루콩', 'qa01'].map(validNickname)).toEqual([true, true]);
  });

  it('공유 시트는 뒤로가기로 닫히고, 링크 복사 토스트는 잠시 뒤 사라진다', async () => {
    const d = new FakeDevice({ ...onboardingScenario(), start: 'invite' });
    await tap(d, 'invite_share');
    expect(d.current).toBe('share-sheet');
    await d.pressKey('back');
    await tap(d, 'invite_copy');
    expect(findElement(await d.dumpTree(), 'toast')?.text).toBe('초대 링크를 복사했어요');
    await d.dumpTree();
    expect(d.current).toBe('invite');
  });

  it('상태바처럼 앱 밖 요소는 트리에 넣지 않는다', async () => {
    const d = new FakeDevice({ ...onboardingScenario(), start: 'profile' });
    expect(findElement(await d.dumpTree(), 'statusbar')).toBeUndefined();
  });
});
