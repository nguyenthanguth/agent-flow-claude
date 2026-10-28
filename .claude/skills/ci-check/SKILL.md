---
name: ci-check
description: Chạy toàn bộ check giống CI của agent-flow (test, typecheck server + web, build) và báo cáo kết quả dạng bảng. Dùng trước khi coi một thay đổi là xong, trước khi commit/push, hoặc khi người dùng nói "chạy test", "check CI", "kiểm tra lại".
allowed-tools: Bash, Read
---

# Chạy check CI

Chạy đúng các bước của `.github/workflows/ci.yml` từ thư mục gốc repo, bằng Bash tool (Git Bash). Chạy **cả 3** bước kể cả khi một bước fail.

## 0. Môi trường

```bash
node -v && pnpm -v
```

Nếu chưa có `node_modules/`, chạy `pnpm install --frozen-lockfile`. Nếu lockfile lệch thì báo, không tự sửa `pnpm-lock.yaml`.

## 1. Các bước

```bash
pnpm test         # node:test: server/test/**, web/hooks/**, web/lib/**
pnpm typecheck    # tsc -p server && tsc -p web
pnpm build        # vite build (web) + esbuild (server) → server/dist/
```

Nếu có `$ARGUMENTS` (ví dụ `test`), chỉ chạy bước đó và nói rõ đã bỏ qua bước nào.

## 2. Báo cáo (tiếng Việt)

| Bước | Kết quả | Ghi chú |
|---|---|---|
| Tests | ✅ 43 pass / ❌ 2 fail | ... |
| Typecheck | | |
| Build | | |

Với mỗi lỗi: tên test hoặc `file:line`, trích nguyên văn thông báo lỗi (cắt gọn), và nhận định ngắn là lỗi code, lỗi test hay lỗi môi trường.

Không tự sửa code trong skill này, trừ khi người dùng yêu cầu.
