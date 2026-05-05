# Changelog — Threads Doctor

## v0.8.0 — 2026-05-05

### Electron Desktop App
- Đóng gói thành file `.exe` (Windows installer) bằng Electron
- Chạy độc lập, không cần terminal hay `npm run dev`
- File `electron/main.cjs` — Electron main process
- Build config trong `package.json` — target NSIS installer
- Vite config `base: './'` để load đúng path trong Electron
- Installer ~97 MB (bao gồm Chromium engine)

### Phân biệt trạng thái lỗi
- Tách 3 trạng thái: `locked` (avatar trắng), `error` (access deactivated), `blocked` (access blocked)
- Dashboard có 7 filter: Tổng / Hoạt động / Token die / Bị khoá / Bị block / Bình thường / Bất thường
- Mỗi trạng thái có icon và màu riêng: Lock (cam), X (đỏ), AlertTriangle (vàng)
- ProfileView hiện đúng label cho từng trạng thái

### Phân trang
- Hiển thị 20 tài khoản/trang
- Nút Previous/Next với icon ChevronLeft/ChevronRight
- Text "Trang X/Y · N tài khoản"
- Auto reset về trang 1 khi đổi filter hoặc search

### Nút Refresh (Home)
- Icon Home trên header
- Click reset về trang chủ: xoá filter, xoá search, đóng settings, về trang 1

### Sửa lỗi
- Fix text delay trong bulk import hiện đúng giá trị từ settings (thay vì hardcode `1.5s`)
- Fix Electron main.js lỗi ES module — đổi extension sang `.cjs`

## v0.7.0 — 2026-04-23

### Followers Delta Tracking
- Theo dõi tăng/giảm followers so với lần fetch insights trước
- Lưu mốc followers vào localStorage (`td.followers_baseline`) — tồn tại lâu dài, không bị xóa theo TTL cache
- Mỗi lần fetch insights thành công → cập nhật mốc mới
- AccountCard và ProfileView hiện delta kèm icon TrendingUp (xanh) / TrendingDown (đỏ)
- Delta = 0 không hiện, delta chỉ hiện từ lần fetch thứ 2 trở đi

## v0.6.0 — 2026-04-23

### AI Reply
- Tích hợp OpenAI (ChatGPT) — tạo reply tự động bằng AI
- File `src/lib/ai.js` — gọi trực tiếp OpenAI API từ browser
- Nút AI (Sparkles) trong reply composer → generate reply dựa trên context bài post + reply gốc
- System prompt tiếng Việt: viết reply ngắn gọn, tự nhiên, phù hợp ngữ cảnh

### Reply System
- Nút Reply (MessageSquare) dưới mỗi reply trong PostDetailView
- Reply composer inline: textarea + nút AI + nút Gửi + nút Hủy
- `postReply` trong threads.js — 2 bước theo Threads API: tạo container → đợi 30s → publish
- Sau khi gửi thành công → tự động refresh replies

### Settings — AI
- Thêm OpenAI API Key (password input) vào Settings
- Thêm Model selector: gpt-4o-mini (default), gpt-4o, gpt-4-turbo, gpt-3.5-turbo
- Lưu cùng settings object vào localStorage

## v0.5.0 — 2026-04-22

### Post Insights
- Thêm `fetchPostInsights` — lấy insights (views, likes, replies, reposts, quotes) cho từng bài post
- PostCard trong ProfileView có nút "Lấy insights" inline, hiện data ngay trên card
- PostDetailView tự động fetch insights khi mở, hiện trước phần metadata
- Nút refresh insights trên cả PostCard và PostDetailView
- Nút "Lấy insights tất cả" trên ProfileView — fetch tuần tự 10 post với delay

### Replies
- Thêm `fetchReplies` — lấy replies cho từng bài post kèm tác giả (@username)
- PostDetailView tự động fetch replies khi mở, hiện danh sách replies với author, timestamp, text, media, link
- Cache replies riêng (TTL 10 phút mặc định), nút refresh thủ công

### Cải thiện UX
- Bỏ nút "Lấy ngay" thừa trên AccountCard (dùng nút Download thay thế)
- Nút "Lấy posts" hàng loạt + trên card luôn skip cache (force refresh)

### Sửa lỗi
- Fix lấy posts hàng loạt không hoạt động khi đã có cache (thiếu skipCache)
- Fix card không tự cập nhật sau khi lấy posts hàng loạt

## v0.4.0 — 2026-04-22

### Phát hiện bất thường
- Phát hiện bài viết trùng lặp caption 100% trong 10 bài gần nhất
- Phát hiện tài khoản không đăng bài quá 24h → đánh dấu "Bất thường"
- Phát hiện token die qua avatar trắng (placeholder) → đánh dấu "Lỗi"
- Trang chi tiết hiện lý do bất thường cụ thể
- PostCard highlight: viền đỏ cho trùng lặp, viền vàng cho quá 24h

### Lọc tài khoản
- 5 StatCard clickable: Tổng, Hoạt động, Lỗi, Bình thường, Bất thường
- Filter chip hiện cạnh tiêu đề, click X để reset
- Tài khoản token die loại khỏi "Bình thường", đếm vào "Lỗi"

### Trang chi tiết (ProfileView)
- Hiện ID, token (che 1 phần), link @username clickable
- Nút Copy ID / Copy Token / Copy Username
- Badge trạng thái: "Bình thường" xanh / "Bất thường" đỏ
- Box lý do bất thường nếu có

### Cải thiện UX
- Nút "Lấy posts" trực tiếp trên mỗi AccountCard
- Thời gian post gần nhất hiện dạng "X giờ trước" / "X ngày Y giờ trước"
- Lấy posts hàng loạt luôn skip cache (force refresh)
- Card tự cập nhật sau khi lấy posts hàng loạt (không cần F5)

### Cài đặt
- Nâng cache TTL default lên 30 phút cho tất cả loại
- Thêm cấu hình delay giữa các request hàng loạt (default 5 giây)
- Fix lỗi lưu cache settings bị ghi đè bởi webhook settings

### Sửa lỗi
- Fix thêm tài khoản trùng username không ghi đè mà tạo card mới
- Fix bulk import trùng username không cập nhật token mới
- Fix nút "Lấy posts" hàng loạt không hoạt động khi đã có cache
- Fix filter "Bình thường" vẫn hiện tài khoản token die
- Fix thẻ `</label>` thừa gây lỗi render
