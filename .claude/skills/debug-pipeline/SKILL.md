---
name: debug-pipeline
description: Chẩn đoán khi agent-flow không hiện session hoặc event (không thấy session, subagent không hiện, subagent không kết thúc, event không stream, lỗi riêng trên Windows). Kiểm tra lần lượt thư mục transcript, file subagent + meta, server/SSE, rồi phía web. Dùng khi người dùng báo "không thấy gì", "không có session", "subagent không hiện".
argument-hint: "[đường dẫn project]"
allowed-tools: Bash, Read, Grep, Glob
---

# Chẩn đoán pipeline event

Agent Flow chỉ đọc transcript, không có hook. Đi từ nguồn tới UI và dừng ở mắt xích hỏng đầu tiên. **Chỉ đọc** `~/.claude`, không sửa gì.

Project cần theo dõi: `$ARGUMENTS`, mặc định là workspace mà server đang chạy (dòng `Workspace:` lúc server khởi động).

## 1. Transcript của session

Workspace được mã hoá bằng cách thay mọi ký tự không phải chữ/số bằng `-` (`server/src/relay.ts`, `encodeWorkspace`), ví dụ `C:\Users\X\proj` → `C--Users-X-proj`.

```bash
ls -t ~/.claude/projects/ | head
ls -lt ~/.claude/projects/<encoded>/*.jsonl | head -5
tail -c 1500 ~/.claude/projects/<encoded>/<session>.jsonl
```

- Server chỉ nhận thư mục khớp (case-fold trên Windows, `foldPathCase`) hoặc là thư mục con của workspace. Chạy server từ sai thư mục là lỗi hay gặp nhất: dùng `-w <dir>` hoặc `AGENT_FLOW_CLAUDE_WORKSPACE`.
- Session chỉ được attach khi transcript hoặc một subagent của nó được ghi trong `ACTIVE_SESSION_AGE_S` (10 phút, `server/src/core/constants.ts`).

## 2. Subagent

```bash
ls -lt ~/.claude/projects/<encoded>/<session>/subagents/ | head
for f in ~/.claude/projects/<encoded>/<session>/subagents/*.meta.json; do echo "$f: $(cat "$f")"; done
```

- **Không hiện:** thiếu `.meta.json` thì watcher đợi 5 giây rồi dùng tên dự phòng `subagent-N`. Nếu meta đã có `finished: true` lúc server attach, subagent bị coi là lịch sử và không được vẽ.
- **Không kết thúc:** phải có một trong hai tín hiệu: `finished: true` trong meta, hoặc một entry `<task-notification>` trong transcript chính (`grep -n "task-notification" <session>.jsonl | tail -3`). Định dạng mới là `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<task-notification>…"}}`. Nếu Claude Code đổi định dạng, sửa `taskNotificationText` trong `transcript-parser.ts`.
- **Sai tên hoặc trùng node:** tên lấy từ `description` của meta, phải trùng với `description` của tool `Agent` trong transcript chính.

## 3. Server / SSE

```bash
curl -s -N -m 5 http://127.0.0.1:3030/events | head -c 2000
```

- Dòng đầu phải là `{"type":"reset",...}`, tiếp theo là `session-list` và các `agent-event-batch`.
- Không kết nối được: server chưa chạy, hoặc cổng đang bị chiếm (`EADDRINUSE`). Đổi cổng bằng `--port`.
- Có `reset` mà không có `session-list`: server không thấy session nào, quay lại bước 1. Chạy `agent-flow-claude --verbose` (hoặc `node server/dist/agent-flow-claude.js --verbose`) để xem log `[session] Watching …` và `[SubagentWatcher] Tailing …`.

## 4. Web

- Dev: UI ở `:3000` proxy `/events` sang `:3030` (`web/vite.config.ts`). Nếu server chạy ở cổng khác thì proxy hỏng.
- Có event nhưng UI trống: mở DevTools console. Kiểm tra `use-event-stream.ts` (session đang được chọn, `epoch`) và `use-agent-simulation.ts`.

## 5. Kết luận (tiếng Việt)

- Mắt xích hỏng và bằng chứng (lệnh và output)
- Nguyên nhân khả dĩ nhất, kèm `file:line` liên quan
- Cách sửa: lệnh để người dùng tự chạy, hoặc đề xuất dùng `/fix-bug` nếu là lỗi code
