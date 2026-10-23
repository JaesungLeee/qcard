/*
 * 단계의 버튼 이름 확인: `[이름]`은 Agent가 화면에서 그 글자를 찾는 이름이다. 모델이 흔한 이름([다음]·[확인])을
 * 지어내면 실제 화면과 달라 실행이 헤매므로, 근거 문서(스펙 본문·사람이 쓴 이전 케이스·기존 준비 플로우)에
 * 이름으로 나오지 않는 `[이름]`은 `이름(추정)`으로 바꿔 Agent·검토자가 추정임을 알게 한다.
 */

const QUOTES = [
  ['[', ']'],
  ["'", "'"],
  ['"', '"'],
  ['‘', '’'],
  ['“', '”'],
  ['`', '`'],
  ['「', '」'],
] as const;

/** 근거 문서에 이름으로 나오는가: 괄호·따옴표로 감쌌거나 "이름 버튼" */
export function nameChecker(sources: string[]): (name: string) => boolean {
  const corpus = sources.join('\n');
  return (name) =>
    QUOTES.some(([a, b]) => corpus.includes(`${a}${name}${b}`)) ||
    corpus.includes(`${name} 버튼`) ||
    corpus.includes(`${name}버튼`);
}

/** 근거 없는 `[이름]` → `이름(추정)`. 바꾼 이름도 돌려준다 */
export function unmarkUnknownNames(
  text: string,
  known: (name: string) => boolean,
): { text: string; guessed: string[] } {
  const guessed: string[] = [];
  const out = text.replace(/\[([^\[\]\n]+)\]/g, (m, name: string) => {
    if (known(name.trim())) return m;
    guessed.push(name.trim());
    return `${name.trim()}(추정)`;
  });
  return { text: out, guessed };
}
