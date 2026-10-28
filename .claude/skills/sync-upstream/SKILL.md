---
name: sync-upstream
description: Kéo thay đổi mới từ upstream patoles/agent-flow về fork cá nhân, tóm tắt commit mới, merge trên nhánh riêng, giải quyết conflict và chạy check. Dùng khi người dùng gọi /sync-upstream.
argument-hint: "[nhánh upstream, mặc định main]"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Đồng bộ với upstream

Remote: `origin` là fork (`nguyenthanguth/agent-flow`), `upstream` là `patoles/agent-flow`. Nhánh upstream: `$ARGUMENTS`, mặc định là `main`.

## 1. Xem trước, chưa thay đổi gì

```bash
git status --short                       # phải sạch, nếu không thì hỏi người dùng
git fetch upstream
git log --oneline main..upstream/main    # commit mới từ upstream
git log --oneline upstream/main..main    # commit riêng của fork
git diff --stat main...upstream/main
```

Không có commit mới thì báo "đã đồng bộ" và dừng.

Tóm tắt bằng tiếng Việt: các commit mới, nhóm theo fix / feat / chore. Ghi chú những file mà **cả hai phía đều sửa** (`git diff --name-only main...upstream/main` giao với `git diff --name-only upstream/main...main`), vì đó là nơi dễ conflict. Đọc phần CHANGELOG mới của upstream nếu có.

Hỏi người dùng có muốn merge không trước khi sang bước 2.

## 2. Merge thẳng vào `main`

Theo CLAUDE.md, không tạo nhánh:

```bash
git switch main
git merge --no-ff upstream/main
```

Dùng merge, không rebase: `main` của fork đã push lên `origin`, rebase sẽ phải force-push. Nếu cần bỏ dở khi đang conflict: `git merge --abort`.

## 3. Conflict

Với mỗi file conflict:
- Đọc cả hai phía. Hiểu ý đồ của upstream (xem commit gốc bằng `git log upstream/main -- <file>`) và ý đồ của thay đổi trong fork.
- Fork này đã xoá Codex: thay đổi upstream chỉ liên quan tới Codex (`codex-*.ts`, `runtime === 'codex'`, OpenAI logo, GPT model) thì bỏ, file `codex-*` bị upstream sửa thì `git rm` lại.
- Giữ cả hai khi có thể. Nếu upstream đã sửa cùng lỗi theo cách khác, ưu tiên cách của upstream để diff của fork nhỏ lại, và báo người dùng.
- Không bao giờ chọn "theirs" hoặc "ours" cho cả file mà không đọc.
- `pnpm-lock.yaml` conflict: lấy bản upstream rồi chạy `pnpm install` để tạo lại, không sửa tay.
- Conflict nào không chắc, dừng lại và hỏi người dùng, kèm trích đoạn hai phía.

## 4. Kiểm tra

Chạy `pnpm install` nếu `package.json` hoặc lockfile đổi, sau đó chạy toàn bộ check (skill `ci-check`).

## 5. Báo cáo

- Số commit đã merge và tóm tắt
- Các conflict và cách đã giải quyết
- Kết quả check
- Bước tiếp theo đề xuất: `git push origin main`. **Chỉ làm khi người dùng đồng ý.**
