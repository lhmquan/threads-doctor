# Security — Hard Rules cho dự án Threads Doctor

Tài liệu này là **luật bắt buộc** cho mọi người (và mọi AI agent) làm việc trong repo.
Mục tiêu: không bao giờ rò rỉ dữ liệu mật (token, credential, API key) lên git.

## 1. Dữ liệu cấm commit

Threads Doctor xử lý: token Threads/Meta, OpenAI API key, webhook URL n8n — tất cả do
người dùng nhập và lưu trong **localStorage** (không nằm trong repo). Ngoài ra `.env` ở root
chứa token cấu hình tooling AI (Anthropic). Mọi thứ đó là **dữ liệu mật**, không bao giờ
được đưa lên GitHub.

`.gitignore` đã chặn:
```
.env*  secrets.*       # secret cấu hình (giữ .env.example)
*.pem *.key *.p12 *.pfx  # khóa riêng
.claude/               # cache token/permission của Claude Code (GH_TOKEN, API key…)
node_modules/ dist/ release/ out/ tmp/ *.log   # dependency, build, log, tạm
```

> Bất kỳ pattern mới nào chứa secret → thêm vào `.gitignore` ngay.

## 2. Quy trình commit bắt buộc

### Quy tắc vàng
- **KHÔNG `git add -A` / `git add .` mù quáng.**
- **Luôn xem `git status` + `git diff --cached` trước khi `git commit`.**
- **Không hardcode** token/password/secret thật vào source (kể cả comment, test, placeholder).

### Scan secret trước khi commit (bắt buộc ít nhất 1 lần/đầu session)

Bật pre-commit hook (đã cài ở `.githooks/pre-commit`, tự chạy khi `git commit`):

```powershell
# Bật hook (chạy 1 lần / clone mới)
git config core.hooksPath .githooks
```

Hoặc scan thủ công — tìm các pattern secret phổ biến (PowerShell):
```powershell
$pat = 'ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|gho_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
$hits = Get-ChildItem -Recurse -Include *.js,*.jsx,*.cjs,*.json,*.md -Exclude node_modules |
  Select-String -Pattern $pat
if ($hits) { Write-Host "⚠️ TÌM THẤY SECRET — KHÔNG COMMIT"; $hits } else { Write-Host "✓ Sạch" }
```

Kiểm tra không có file nhạy cảm nào bị track:
```powershell
git ls-files | Select-String -Pattern '\.(pem|key|p12|pfx|env)$|secret|credential' |
  ForEach-Object { Write-Host "⚠️ CÓ: $_" }
```

## 3. Token đã lộ = phải revoke

Nếu một secret lỡ bị **dán vào chat**, **commit**, hoặc **ghi vào file không ignore**:
1. **DỪNG**, không push.
2. Báo user **revoke (thu hồi) token ngay** trên GitHub Settings → Developer settings → Tokens
   (hoặc trên đối tác tương ứng: Meta/Threads, OpenAI).
3. Xoá token khỏi file/commit chỉ là phụ — git history vẫn lưu → revoke là biện pháp duy nhất triệt để.
4. Nếu đã push secret → user phải force-push xoá + revoke token + xoá cache GitHub (contact GitHub Support nếu cần).

> Xoá file khỏi working copy KHÔNG đủ. Git lưu lịch sử. **Revoke là bắt buộc.**

## 4. Pre-commit hook (defense in depth)

`.githooks/pre-commit` quét secret trong staged files trước mỗi commit. Nếu thấy pattern
token/key → **chặn commit**. Cài 1 lần:
```powershell
git config core.hooksPath .githooks
```

Hook viết bằng bash — trên Windows cần Git for Windows (đã kèm Git Bash) để chạy.
Hook không thay thế việc con người/agent kiểm tra — nó là tầng phòng thủ cuối.
Muốn bỏ qua (KHÔNG khuyến nghị, chỉ khi chắc chắn false positive): `git commit --no-verify`.

## 5. Audit định kỳ

Khi nghi ngờ leak:
```powershell
# Xem toàn bộ lịch sử có commit file .env/.claude/secrets không
git log --all --full-history -- ".env*" ".claude/*" "secrets.*" "*.pem" "*.key"
```
Nếu có → báo user, cân nhắc revoke + xoá lịch sử.
