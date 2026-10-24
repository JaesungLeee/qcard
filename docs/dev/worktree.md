# 워크트리

여러 작업을 동시에 하려면 Claude Code 워크트리를 쓴다. 워크트리는 `.claude/worktrees/<이름>/`에 생기며 gitignore돼 있다.

```sh
claude --worktree <이름>    # 새 워크트리에서 세션 시작
```

서브에이전트는 `isolation: "worktree"`로 각자 워크트리에서 돌릴 수 있다.

## 따라오는 것과 아닌 것

- `qcard.local.json`은 `.worktreeinclude`에 따라 본 저장소에서 복사된다. `guard-bash.sh`의 `pm clear` 허용과 실기기 스크립트의 기본 앱이 이 파일을 쓴다.
- `.env`는 복사하지 않는다. API 키 경로(`device-llm.md`)가 필요하면 직접 복사한다.
- `node_modules`는 워크트리마다 따로다. Stop 훅(`verify-on-stop.sh`)이 없으면 `pnpm install --frozen-lockfile`부터 한다.
- 저장소 밖 `qcard-specs/`는 스크립트(`qadoc generate`, `eval-locator`)가 위 폴더로 올라가며 찾으므로, 워크트리에서도 본 저장소 옆 폴더를 쓴다.

## 동시에 띄울 때

- `pnpm verify`: 테스트 에뮬레이터가 실행마다 빈 포트를 써서 여러 워크트리에서 동시에 돌아도 된다(`emulators.md`).
- `pnpm emu`: 포트(9099·8080·5001·9199)가 고정이라 한 번에 하나만 띄운다. 어느 워크트리에서 띄우든 같은 에뮬레이터에 붙는다.
- `pnpm dev`: 5173이 차 있으면 Vite가 다음 포트를 쓴다. 터미널에 나온 주소를 연다.
- 실기기는 한 대뿐이라 실기기 명령(`device:check`, `run-cycle`, `/rerecord`)은 한 워크트리에서만 돌린다.
