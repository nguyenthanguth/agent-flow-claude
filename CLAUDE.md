# CLAUDE.md

**agent-flow-claude** — bản fork cá nhân của [patoles/agent-flow](https://github.com/patoles/agent-flow), đã được làm lại cho gọn: **chỉ visualize real-time các session Claude Code trên trình duyệt**. Không còn VS Code extension, Codex, hook hay telemetry. Server chỉ *đọc* transcript mà Claude Code tự ghi ra, không cài gì vào `~/.claude/settings.json`.

Trả lời người dùng bằng tiếng Việt. Code, comment, commit message và CHANGELOG viết bằng tiếng Anh.

## Cấu trúc

pnpm workspace gồm `server` và `web`.

| Thư mục | Vai trò |
|---|---|
| `server/src/core/` | Lõi: `transcript-parser.ts` (JSONL → `AgentEvent`), `subagent-watcher.ts` (tail transcript subagent + `.meta.json`), `protocol.ts` (kiểu dữ liệu), `constants.ts`, `tool-summarizer.ts`, `token-estimator.ts`, `fs-utils.ts`, `logger.ts` |
| `server/src/relay.ts` | Tìm session đang hoạt động của workspace, watch/poll file, buffer event theo session, stream SSE |
| `server/src/server.ts`, `static.ts`, `main.ts`, `args.ts` | HTTP server (`/events` + phục vụ UI đã build), CLI |
| `server/test/` | `node:test` cho parser, subagent watcher, fs-utils |
| `web/` | UI React 19 + Canvas, build bằng Vite. `hooks/use-event-stream.ts` (SSE), `hooks/use-agent-simulation.ts` + `hooks/simulation/*` (event → state), `components/agent-visualizer/canvas/draw-*` (vẽ) |

Luồng dữ liệu:

```
~/.claude/projects/<encoded>/<session>.jsonl ──► relay.ts + TranscriptParser ─┐
~/.claude/projects/<encoded>/<session>/subagents/agent-<id>.jsonl (+ .meta.json) ─► subagent-watcher.ts ─┤
                                                                               ▼
                                     AgentEvent ─► buffer theo session ─► SSE /events
                                                                               ▼
web: use-event-stream.ts ─► use-agent-simulation.ts ─► simulation/handle-*-events.ts ─► canvas/draw-*
```

## Bất biến quan trọng

- **Transcript là nguồn sự thật duy nhất.** Đừng thêm lại hook: hook từng gây event trùng với tên agent khác (`Explore-7ea23e`) và `Stop` hook làm toàn bộ subagent đang chạy bị đánh dấu xong rồi biến mất.
- **Subagent:**
  - Tên lấy từ `description` trong `.meta.json` (giống `description` của tool `Agent`). Watcher chờ tối đa 5 giây để file meta xuất hiện.
  - Subagent chạy nền hoàn thành khi có `<task-notification>` (Claude Code 2.1+ ghi dưới dạng entry `attachment` với `attachment.prompt`), **hoặc** khi `.meta.json` có `finished: true`, tuỳ cái nào đến trước. Xem `finishBackgroundSubagent`.
  - Khi attach vào session đang chạy, prescan **không** đánh dấu subagent là đã spawn; watcher spawn những subagent còn đang chạy.
- **SSE:** mỗi kết nối bắt đầu bằng `reset` rồi phát lại toàn bộ session. Phía web tăng `epoch` để restart simulation; đừng để reconnect nối thêm event vào buffer cũ.
- **Inactivity** (5 phút) chỉ đưa orchestrator về `agent_idle`, không `agent_complete`: `agent_complete` của agent cha sẽ cascade sang mọi agent con.
- **Agent con xong việc** chỉ mờ đi (`COMPLETED_AGENT_OPACITY`), không bị xoá khỏi đồ thị.
- `server/src/core/protocol.ts` là hợp đồng với `web/lib/bridge-types.ts` và `web/hooks/simulation/*`. Đổi một bên thì sửa cả hai (xem skill `protocol-change`).
- Path trên Windows: so sánh phải case-fold (`foldPathCase`). Workspace được mã hoá bằng cách thay mọi ký tự không phải chữ/số bằng `-` (`C:\Users\X\proj` → `C--Users-X-proj`).

## Lệnh

Node 20+ và pnpm 10 (máy này đã cài sẵn cả hai).

```bash
pnpm i
pnpm dev          # server :3030 (tsx watch) + Vite :3000, /events được proxy sang server
pnpm dev:demo     # chỉ UI, chạy kịch bản demo (?demo)
pnpm build        # build UI + bundle server → server/dist/
pnpm start        # node server/dist/agent-flow-claude.js
pnpm install-global  # build + npm install -g ./server (symlink) → lệnh `agent-flow-claude` ở mọi thư mục
pnpm test         # node:test: server/test, web/hooks, web/lib
pnpm typecheck    # tsc cho server và web
```

Theo dõi project khác khi dev: `AGENT_FLOW_CLAUDE_WORKSPACE=/đường/dẫn/project pnpm dev`, hoặc `node server/dist/agent-flow-claude.js -w <dir>`.

Release: tăng `version` trong `server/package.json`, commit, push tag `v<version>` → workflow `release.yml` tạo GitHub Release kèm `agent-flow-claude.tgz` (cài bằng `npm install -g .../releases/latest/download/agent-flow-claude.tgz`).

Chạy một file test: `node --import tsx --test server/test/<file>.test.ts`.

CI (`.github/workflows/ci.yml`) chạy `pnpm test`, `pnpm typecheck`, `pnpm build` trên mỗi push/PR và upload `server/dist/` làm artifact `agent-flow-claude`. Theo dõi bằng `gh run list` / `gh run watch` (đã được phép dùng GitHub Actions).

### Windows

- `.npmrc` đặt `shell-emulator=true` để cú pháp POSIX (`VAR=x cmd`, `&&`) trong script chạy được trên Windows. Đừng xoá.
- Cổng mặc định là 3030, để không đụng app `npx agent-flow-app` của upstream (3001) nếu nó còn chạy.
- Dùng Bash tool (Git Bash) cho `pnpm`; PowerShell 5.1 không có `&&`.

## Kiểm tra giao diện

Không có test DOM. Để xem UI thật, chạy `pnpm dev:web` rồi chụp bằng Chrome headless qua DevTools Protocol, đợi vài giây cho kịch bản chạy (`?demo`). Ở chế độ live, có thể tạo một subagent probe (ví dụ chạy vài lệnh `sleep`) để thấy subagent real-time.

## Quy ước code

- TypeScript strict, 2 space, **không dấu chấm phẩy**, nháy đơn. Mỗi file mở đầu bằng block comment ngắn; phân đoạn bằng `// ─── Tên ───`; comment giải thích *tại sao*.
- Màu chỉ khai báo trong `web/lib/colors.ts` (bảng màu ấm, màu nhấn clay `#d97757`); màu trạng thái phải là hex 6 chữ số vì code vẽ nối thêm byte alpha. Font canvas dùng `FONT_SANS` / `FONT_MONO` trong `web/lib/canvas-constants.ts`; monospace chỉ dành cho code và tham số tool.
- Test dùng `node:test` + `node:assert/strict`, filesystem dùng `fs.mkdtempSync(os.tmpdir())`, không bao giờ đụng `~/.claude` thật.
- Không thêm dependency nếu không thật cần.
- Thay đổi người dùng thấy được → thêm dòng vào `CHANGELOG.md` (mục `Unreleased (fork)`).

## Git

- `origin` là fork cá nhân (`nguyenthanguth/agent-flow-claude`), `upstream` là `patoles/agent-flow`. **Không tạo nhánh**: commit thẳng vào `main` rồi `git push origin main`. Chỉ commit/push khi người dùng yêu cầu.
- Conventional Commits: `fix:`, `feat:`, `refactor:`, `chore:`, `docs:`.
- Thương hiệu: "Agent Flow" và logo là của Simon Patole (`TRADEMARK.md`). README phải luôn ghi rõ dự án *dựa trên* Agent Flow và không phải bản chính thức; không dùng logo gốc. Tên `agent-flow-claude` là lựa chọn của người dùng, dù đã được báo là có thể bị coi là dễ nhầm lẫn.
- Fork đã khác upstream rất nhiều (bỏ `extension/`, `scripts/`, `app/`). Merge từ upstream chỉ nên cherry-pick các bản sửa parser liên quan (skill `sync-upstream`).
- `.claude/agents/` và `.claude/skills/` được commit cùng repo; phần còn lại của `.claude/` (settings local…) vẫn bị ignore.

## Agent team

Có 4 subagent trong `.claude/agents/`:

| Agent | Việc |
|---|---|
| `leader` | Phân tích yêu cầu, đọc code, lập kế hoạch, điều phối coder → tester → reviewer |
| `coder` | Implement / sửa lỗi theo kế hoạch, diff tối thiểu |
| `tester` | Viết test tái hiện lỗi hoặc cover tính năng, chạy toàn bộ check |
| `reviewer` | Review diff (chỉ đọc) |

Quy trình cho một bug fix: leader lập kế hoạch → tester viết test fail → coder sửa → tester chạy check → reviewer review. Việc nhỏ thì làm trực tiếp. Muốn leader tự điều phối thì chạy `claude --agent leader` (subagent không gọi được subagent khác).
