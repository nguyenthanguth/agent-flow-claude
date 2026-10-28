---
name: fix-bug
description: Quy trình sửa lỗi đầy đủ cho agent-flow bằng team agent (leader → tester → coder → tester → reviewer), có test tái hiện lỗi trước khi sửa. Dùng khi người dùng gọi /fix-bug kèm mô tả lỗi.
argument-hint: <mô tả lỗi hoặc số issue>
disable-model-invocation: true
---

# Sửa lỗi: $ARGUMENTS

Làm theo đúng thứ tự dưới đây. Mỗi bước dùng subagent tương ứng trong `.claude/agents/`. Brief cho subagent phải tự đủ nghĩa (subagent không thấy cuộc hội thoại này): mục tiêu, file và dòng liên quan, ràng buộc, và cần báo lại gì.

## 1. Chuẩn bị

- `git status`: nếu working tree không sạch, hỏi người dùng trước khi làm tiếp.
- Làm thẳng trên `main`, không tạo nhánh (theo CLAUDE.md).
- Nếu `$ARGUMENTS` là số issue upstream, đọc issue bằng `gh issue view <số> -R patoles/agent-flow`.

## 2. Lập kế hoạch: `leader`

Gọi `leader` với mô tả lỗi. Cần nhận về: nguyên nhân gốc (`file:line`), các entry point bị ảnh hưởng (subagent chạy nền / foreground, attach khi đang chạy, reconnect, Windows), chiến lược test, và có cần CHANGELOG hay không.

Nếu leader không tìm ra nguyên nhân gốc, dừng lại và báo người dùng. Không đoán.

## 3. Tái hiện: `tester`

Yêu cầu `tester` viết test **fail** tái hiện lỗi theo kế hoạch, và xác nhận test fail đúng lý do (trích assertion). Lỗi thuần UI/canvas không test được bằng `node:test` thì ghi rõ và mô tả cách tái hiện thủ công bằng `pnpm run dev:demo` hoặc `?stress=heavy`.

## 4. Sửa: `coder`

Đưa `coder` kế hoạch, đường dẫn test vừa viết, và yêu cầu diff tối thiểu. Thêm dòng `- Fix: ...` vào `CHANGELOG.md` nếu lỗi người dùng thấy được.

## 5. Kiểm tra: `tester`

Yêu cầu `tester` chạy toàn bộ check CI (xem skill `ci-check`). Có lỗi thì quay lại bước 4 với output lỗi.

## 6. Review: `reviewer`

Gọi `reviewer` cho `git diff main...HEAD` và các thay đổi chưa commit. Gặp **CHANGES REQUESTED** thì đưa các finding `blocking`/`should-fix` cho `coder`, rồi lặp lại bước 5–6. Tối đa 2 vòng; sau đó dừng và báo người dùng.

## 7. Tổng kết (tiếng Việt)

- Nguyên nhân gốc và cách sửa (1–3 câu)
- File đã đổi
- Bảng kết quả check
- Finding của reviewer và cách đã xử lý
- Gợi ý commit message dạng `fix: ...` (tiếng Anh)

**Không commit, không push** trừ khi người dùng yêu cầu.
