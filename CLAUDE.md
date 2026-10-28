# CLAUDE.md

Bản fork cá nhân của [patoles/agent-flow](https://github.com/patoles/agent-flow): công cụ visualize real-time các session Claude Code (node graph, tool call, subagent, timeline). Mục tiêu của fork: tuỳ biến và sửa lỗi cho nhu cầu cá nhân. Fork này **chỉ hỗ trợ Claude Code**: toàn bộ phần Codex của upstream đã bị xoá. Khi merge từ upstream, bỏ qua các thay đổi liên quan tới Codex (`codex-*.ts`, `runtime === 'codex'`, OpenAI logo, GPT model). Không cần giữ tương thích với quy trình đóng góp upstream (CLA, PR template), nhưng nên giữ diff gọn để còn merge được từ upstream.

Trả lời người dùng bằng tiếng Việt. Code, comment, commit message và CHANGELOG viết bằng tiếng Anh như phần còn lại của repo.

## Cấu trúc

pnpm workspace (`pnpm-workspace.yaml` chỉ gồm `extension` và `web`; `app` và `scripts` dùng chung dependency ở root).

| Thư mục | Vai trò |
|---|---|
| `extension/src/` | VS Code extension **và** lõi xử lý dùng chung: hook server, transcript parser, session/subagent watcher, protocol |
| `scripts/` | `relay.ts` (relay dùng chung cho dev và app: nhận event → stream SSE), `dev-relay.ts`, `setup.js` (cài hook vào `~/.claude/settings.json`), `telemetry*`, `vscode-shim.js` |
| `app/` | `npx agent-flow-app`: server HTTP phục vụ UI + SSE, bundle bằng esbuild (`app/build.js`), alias `vscode` → `scripts/vscode-shim.js` |
| `web/` | UI React 19 + Canvas. Next.js cho `pnpm run dev`, Vite cho webview (`vite.config.webview.ts`) và app (`vite.config.app.ts`) |

Luồng dữ liệu chính:

```
Claude Code hooks → ~/.claude/agent-flow/hook.js → HookServer (extension/src/hook-server.ts) ─┐
~/.claude/projects/**.jsonl → SessionWatcher + TranscriptParser ──────────────────────────────┴→ AgentEvent (protocol.ts)
                                                                  ↓
        VS Code: webview-provider.ts (postMessage)   |   dev/app: scripts/relay.ts (SSE /events)
                                                                  ↓
        web/hooks/use-vscode-bridge.ts → use-agent-simulation.ts → web/hooks/simulation/* → canvas/draw-*
```

Những điểm cần nhớ:

- `extension/src/protocol.ts` là hợp đồng giữa backend và UI. Đổi `AgentEvent` / message type thì phải sửa cả hai phía (extension + `web/lib/bridge-types.ts`, `web/hooks/simulation/*`).
- Code trong `extension/src/` chạy được cả **trong VS Code** và **ngoài VS Code** (qua `vscode-shim.js`). Shim chỉ có `EventEmitter`, `workspace.workspaceFolders`, `workspace.getConfiguration`, `window.showInformationMessage`. File nào được `scripts/relay.ts` import thì không được dùng API `vscode` nào khác.
- `extension/src/hook-entries.ts` và `scripts/setup.js` ghi vào `~/.claude/settings.json` của người dùng. Bất biến: chỉ đụng tới hook của Agent Flow, không ghi đè file không parse được, ghi atomic (xem CHANGELOG 0.9.2 / #73).
- Path trên Windows: so sánh path phải case-fold (`foldPathCase` trong `fs-utils.ts`). Drive letter `c:\` và `C--` đều có thể xuất hiện.
- Hằng số timeout/interval nằm trong `extension/src/constants.ts`; dùng lại, đừng hardcode.

## Lệnh

Cần Node 20+ và pnpm 10 (CI dùng Node 22, pnpm 10). Máy này đã có Node 22 và pnpm 10 (cài global qua `npm i -g pnpm@10`).

```bash
pnpm i                         # cài dependency cho toàn workspace
pnpm run setup                 # cài hook Claude Code (một lần)
pnpm run dev                   # Next.js (3000) + relay (3001)
pnpm run dev:demo              # UI với dữ liệu mock, không cần relay
pnpm run build:all             # webview + extension
pnpm run build:app             # gói app/dist (npx agent-flow-app)
```

Kiểm tra, giống hệt CI (`.github/workflows/ci.yml`). Chạy hết trước khi coi một thay đổi là xong:

```bash
pnpm test                                 # node:test: scripts/**, app/src/**, web/hooks/**
pnpm --dir extension test                 # node:test: extension/test/**
pnpm --filter agent-flow run lint         # tsc --noEmit cho extension
pnpm --dir web exec tsc --noEmit          # typecheck web
```

Chạy một file test: `node --import tsx --test path/to/file.test.ts` (ở root), hoặc `pnpm --dir extension exec tsx --test test/<file>.test.ts`.

### Windows

- `.npmrc` đặt `shell-emulator=true`, nên pnpm chạy script qua shell cross-platform thay vì `cmd.exe`. Nhờ vậy cú pháp POSIX như `NEXT_PUBLIC_DEMO=0 ...` hay `&&` trong `package.json` chạy được trên Windows. Đừng xoá dòng này.
- Ngoại lệ: `vscode:prepublish` (`cp ...`) do `vsce` gọi qua **npm**, không phải pnpm, nên không được hưởng `.npmrc` này (xem skill `install-local`).
- `pnpm run dev` cần cổng 3000 (web) và 3001 (relay). Nếu đang chạy `npx agent-flow-app` (cũng dùng 3001), relay sẽ báo `EADDRINUSE`.
- Dùng Bash tool (Git Bash) cho các lệnh `pnpm`; PowerShell 5.1 không hỗ trợ `&&`.

## Quy ước code

- TypeScript strict, 2 space, **không dấu chấm phẩy**, nháy đơn. JS thuần (`setup.js`, `build.js`, `vscode-shim.js`) dùng `'use strict'` + CommonJS.
- Mỗi file mở đầu bằng block comment ngắn mô tả vai trò. Phân đoạn bằng `// ─── Tên đoạn ───`. Comment giải thích *tại sao*, kèm số issue khi có (`(#73)`).
- Test dùng `node:test` + `node:assert/strict`, đặt cạnh code (`*.test.ts`) ở `scripts/`, `app/src/`, `web/hooks/`, hoặc trong `extension/test/`. Fixture ở `extension/test/fixtures/`. Test đụng filesystem dùng `fs.mkdtempSync(os.tmpdir())`, không bao giờ đụng `~/.claude` thật.
- Không thêm dependency mới nếu không thật cần. Web chỉ có `d3-force`, `next`, `react`.
- Thay đổi hành vi người dùng thấy được thì thêm dòng vào `extension/CHANGELOG.md` (theo format sẵn có: `- Fix: ...` / `- **Tính năng** ...`).

## Git

- Remote `origin` là fork cá nhân (`nguyenthanguth/agent-flow`), `upstream` là `patoles/agent-flow`. **Không tạo nhánh**: commit thẳng vào `main` rồi `git push origin main`. Chỉ commit/push khi người dùng yêu cầu.
- Commit theo Conventional Commits như lịch sử repo: `fix: ...`, `feat: ...`, `chore: ...`, `docs: ...`.
- `.claude/` đang nằm trong `.gitignore` của upstream, nên các agent trong `.claude/agents/` mặc định không được commit.

## Agent team

Có 4 subagent trong `.claude/agents/`:

| Agent | Việc |
|---|---|
| `leader` | Phân tích yêu cầu, đọc code, lập kế hoạch, chia việc và điều phối coder → tester → reviewer |
| `coder` | Implement / sửa lỗi theo kế hoạch, diff tối thiểu |
| `tester` | Viết test tái hiện lỗi hoặc cover tính năng, chạy toàn bộ check của CI |
| `reviewer` | Review diff (chỉ đọc): đúng/sai, regression, bất biến của repo |

Quy trình chuẩn cho một bug fix: leader lập kế hoạch → tester viết test fail tái hiện lỗi → coder sửa cho test pass → tester chạy toàn bộ check → reviewer review → leader tổng kết. Việc nhỏ (một dòng, đổi text) thì làm trực tiếp, không cần cả quy trình.

Subagent không gọi được subagent khác. Muốn `leader` tự điều phối team thì chạy nó làm agent chính: `claude --agent leader`. Khi được gọi như subagent thường, leader chỉ trả về kế hoạch để session chính điều phối.
