---
name: protocol-change
description: Checklist khi thêm hoặc đổi một AgentEvent type, payload, hoặc message SSE giữa server và web trong agent-flow (server/src/core/protocol.ts, transcript-parser, subagent-watcher, relay, web/hooks/simulation, canvas). Dùng khi một thay đổi chạm vào protocol.ts hoặc hình dạng payload event.
---

# Thay đổi protocol giữa server và web

`server/src/core/protocol.ts` là hợp đồng duy nhất giữa phía sinh event (server) và phía tiêu thụ (web). Thay đổi phải đi hết pipeline, nếu không UI sẽ lặng lẽ bỏ qua event hoặc crash.

## Pipeline

```
Nguồn event                                 Vận chuyển                         Tiêu thụ
───────────                                 ──────────                         ────────
server/src/core/transcript-parser.ts  ┐                                        web/hooks/use-event-stream.ts
server/src/core/subagent-watcher.ts   ├──► server/src/relay.ts (buffer + SSE) ─► web/hooks/use-agent-simulation.ts
server/src/relay.ts (inactivity, ...) ┘                                        web/hooks/simulation/process-event.ts
                                                                               web/hooks/simulation/handle-*-events.ts
                                                                               web/components/agent-visualizer/canvas/draw-*.ts
```

## Checklist

**Định nghĩa**
- [ ] `server/src/core/protocol.ts`: thêm vào `AgentEventType` hoặc `ServerMessage`.
- [ ] `web/lib/bridge-types.ts`, `web/lib/agent-types.ts`, và union `ServerMessage` trong `web/hooks/use-event-stream.ts`: đồng bộ kiểu.

**Nguồn**
- [ ] Transcript chính (`processTranscriptLine`), kể cả entry không phải `user`/`assistant` như `attachment`.
- [ ] Subagent (`readSubagentNewLines` / `pollSubagent`) nếu event có thể đến từ subagent.
- [ ] Catch-up khi attach (`prescanExistingContent`, `emitCatchUpEntries`): event có cần được dựng lại cho session đang chạy dở không?

**Vận chuyển**
- [ ] Event có `sessionId` để được buffer (`MAX_EVENT_BUFFER`) và phát lại sau `reset` không?
- [ ] Message SSE mới phải được xử lý trong `handleMessage` của `use-event-stream.ts`.

**Tiêu thụ**
- [ ] `web/hooks/simulation/process-event.ts`: thêm `case` và gọi handler.
- [ ] Handler chịu được payload thiếu field (event cũ, replay).
- [ ] `snap-visual-state.ts`: event có ảnh hưởng trạng thái khi tua (review mode) không?
- [ ] Vẽ: `canvas/draw-*.ts` hoặc panel. Màu lấy từ `web/lib/colors.ts`, font từ `FONT_SANS` / `FONT_MONO`.
- [ ] `web/lib/mock-scenario.ts`: thêm vào kịch bản demo để xem bằng `pnpm dev:demo`.

**Tương thích ngược**
- [ ] Field mới là optional, không đổi nghĩa field cũ. UI gặp `type` lạ thì bỏ qua, không throw.

**Test và tài liệu**
- [ ] Test trong `server/test/transcript-parser.test.ts` hoặc `subagent-watcher.test.ts`, dùng đúng hình dạng JSONL thật.
- [ ] Test logic simulation nếu là logic thuần (`web/hooks/**/*.test.ts`).
- [ ] `CHANGELOG.md` nếu người dùng thấy được.
- [ ] Chạy skill `ci-check`.
