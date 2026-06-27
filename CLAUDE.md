# Threads Doctor — Hard Rules cho Claude Code

Các quy tắc **bắt buộc** khi làm việc trong repo này. Vi phạm có thể làm rò rỉ dữ liệu mật.

## Bảo mật — KHÔNG thương lượng

### Dữ liệu CẤM commit lên git
Các loại sau **tuyệt đối không được add/commit/push**:

| Loại | Lý do | Đã ignore trong `.gitignore` |
|------|-------|------------------------------|
| `.env`, `.env.*` | Token/secret cấu hình runtime & tooling AI (Anthropic). | `.env*` (giữ `.env.example`) |
| `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets.*` | Khóa riêng, secret. | có |
| **`.claude/`** | `settings.local.json` cache **token & permission** (vd `GH_TOKEN`, API key) — RỦI RO CAO. | `.claude/` |
| `node_modules/`, `dist/`, `release/`, `*.log` | Build artifact, dependency, log. | có |

Lưu ý: secret runtime của app (token Threads, OpenAI API key, webhook URL) do người dùng nhập và lưu trong **localStorage**, không nằm trong repo. Tuyệt đối không hardcode chúng vào source.

### Quy trình commit BẮT BUỘC
1. **KHÔNG dùng `git add -A` / `git add .` mù quáng.** Phải kiểm tra `git status` + `git diff --cached` trước khi commit.
2. **Trước khi commit lần đầu trong session**: chạy scan secret (xem `docs/SECURITY.md` → mục "Scan trước khi commit").
3. **Không bao giờ ghi token/secret/password thật vào source code** (dù là comment, placeholder, hay file test). Dùng env var hoặc file bị ignore.
4. **Token GitHub / API key** chỉ dùng qua env var tạm thời (`$env:GH_TOKEN = "..."` trong 1 lệnh). Không lưu vào file nào có thể bị commit.
5. Nếu vô tình thấy secret trong diff → **DỪNG**, báo user, không commit.

### Token đã lộ phải REVOKE
Nếu một token/secret lỡ bị dán vào chat hoặc commit → nó bị xem là đã lộ. **Báo user revoke (thu hồi) ngay** trên GitHub/đối tác. Xoá khỏi git là không đủ (git history vẫn còn).

## Convention code
- **Comment + UI bằng tiếng Việt** (đã là pattern của repo).
- **Build phải sạch**: `npm run build` không lỗi trước khi báo "xong".
- **Sửa main/preload process** (`electron/*.cjs`) → báo user **tắt app mở lại** (nút "Cập nhật" trong app chỉ reload renderer, không nạp lại main process).
- **Stack**: React 18 + Vite + TailwindCSS + Electron. Toàn bộ UI tập trung trong `src/App.jsx`. API/cache/storage tách module trong `src/lib/`.
- **Secret app** lấy từ settings người dùng (`settings.webhookUrl`, `settings.apiKey`) → KHÔNG nhúng cứng trong code.

## Lệnh thường dùng
```powershell
npm run build              # build web (phải sạch)
npm run electron:dev       # build + chạy electron (dev/local)
npm run electron:build     # đóng gói Windows installer (NSIS) -> release/
npm run release            # đóng gói + publish GitHub release (cho auto-update)
```

## Tài liệu
- Bảo mật chi tiết + scan secret + quy trình revoke: `docs/SECURITY.md`
- Checklist nhanh trước khi code: `SECURITY_CHECKLIST.md`

## Quy tắc "Up Version"
Khi user nói **"Up Version"**, thực hiện **đúng theo thứ tự**:
1. **Tổng hợp** công việc đã làm kể từ lần up version gần nhất (xem `git log` từ commit release cuối).
2. **Bump version** trong `package.json` **và** hằng `APP_VERSION` trong `src/App.jsx` (patch/minor/major tuỳ thay đổi — mặc định minor). Hai nơi này phải khớp nhau.
3. **Ghi changelog** vào `CHANGELOG.md` (format Keep a Changelog + SemVer, tiếng Việt) và tóm tắt ngắn vào commit message.
4. **Build** phải sạch trước khi commit (`npm run build`).
5. **Commit** tất cả thay đổi (kiểm tra `git status` + `git diff --cached` cẩn thận, không commit secret).
   - Format commit release: `chore: release vX.Y.Z – <tóm tắt ngắn>`
6. **Push** lên `origin/main` (dùng Git Credential Manager, không cần token).
7. **Chuẩn bị command release** và **thông báo user chạy** (KHÔNG tự chạy):
   ```powershell
   $env:GH_TOKEN = "ghp_token_của_user"; npm run release
   ```
8. **Nhắc user**: sau khi release xong, vào GitHub kiểm tra bản draft/release có cần publish không.
