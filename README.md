# qcard

Agent 기반 모바일 QA 자동화 플랫폼. 요구사항은 [docs/PRD.md](docs/PRD.md), 개발 규칙은 [CLAUDE.md](CLAUDE.md).

```sh
pnpm install          # pnpm이 없으면 npx -y pnpm@10.34.6 install
pnpm verify           # 타입 검사 + 테스트 + 색 하드코딩 검사
pnpm dev              # http://localhost:5173/__ui 에서 UI 카탈로그 확인
pnpm ui:snap          # 화면 스크린샷 (처음 한 번: pnpm --filter @qcard/web exec playwright install chromium)
```
