---
name: install-local
description: Build agent-flow và chạy nó cho một project Claude Code trên máy, tuỳ chọn tạo lệnh `agent-flow` dùng global. Dùng khi người dùng gọi /install-local.
argument-hint: "[đường dẫn project cần theo dõi]"
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Build và chạy bản local

## 1. Build

Chạy từ thư mục gốc repo bằng Bash tool. Chạy skill `ci-check` trước; nếu có lỗi thì dừng lại.

```bash
pnpm build          # → server/dist/agent-flow-claude.js + server/dist/webview/
node server/dist/agent-flow-claude.js --help
```

## 2. Chạy

```bash
node server/dist/agent-flow-claude.js -w "$ARGUMENTS"
```

Không có `$ARGUMENTS` thì hỏi người dùng muốn theo dõi project nào. Mặc định server theo dõi thư mục hiện tại, tức chính repo agent-flow.

- UI mở ở http://127.0.0.1:3030. Đổi cổng bằng `--port`.
- Thêm `--verbose` để xem log từng event.
- Khi test thử, chạy với `--no-open` ở chế độ nền. Xong thì tắt process: trên Windows `timeout`/SIGINT từ Git Bash không dừng được `node.exe`, nên dùng PowerShell `Stop-Process`.

## 3. Lệnh global (tuỳ chọn)

`pnpm install-global` (= build + `npm install -g ./server`, symlink về repo) tạo lệnh `agent-flow-claude` dùng ở mọi thư mục; build lại là lệnh global tự cập nhật. Bản phát hành: `npm install -g https://github.com/nguyenthanguth/agent-flow-claude/releases/latest/download/agent-flow-claude.tgz`. Lệnh này sửa môi trường global, nên **hỏi trước khi chạy**. Gỡ: `npm uninstall -g agent-flow-claude`.

Nếu người dùng vẫn còn cài app `npx agent-flow-app` của upstream: app đó dùng cổng 3001 và cài hook vào `~/.claude/settings.json`. Bản fork không cần những hook đó. Muốn gỡ thì người dùng tự xoá các hook có `agent-flow/hook.js` trong settings; agent không tự sửa file này.

## Báo cáo

Đường dẫn build, lệnh chạy, URL, và lỗi gặp phải (nguyên văn).
