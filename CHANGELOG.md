# Changelog — Threads Doctor

## v0.13.0 — 2026-05-10

### Buff Account (Boss/Worker)
- Thêm route `/buff` và flow buff repost: chọn boss + worker, worker repost bài của boss qua Threads repost API
- Hỗ trợ 2 chế độ chọn bài: `Random` (1 trong 10 bài gần nhất) hoặc `Chỉ định` (tick nhiều bài, mỗi lần chạy random 1 bài trong nhóm đã chọn)
- Hỗ trợ chạy `1 lần` hoặc `lặp chu kỳ` (phút/giờ/ngày), delay random min/max giữa từng worker
- Buff task chạy nền, không phụ thuộc trang đang mở; đổi trang vẫn tiếp tục xử lý
- Thêm realtime global notification hiển thị tiến trình buff đang chạy (`X/Y workers`)
- Nút `Hủy` khi task đang running giờ dừng thực sự (abort loop), không chạy hết danh sách worker nữa

### Buff logs & permalink UX
- Logs buff hiển thị permalink bài repost để click mở trực tiếp
- Thêm `Copy Link` cạnh permalink trong logs để copy nhanh
- Mở rộng hiển thị lỗi chi tiết có thể click `xem tất cả / thu gọn`

### Favourite workers + Context menu
- Thêm danh sách worker favourite persist localStorage (`td.buff_fav_workers.v1`)
- Trang Buff hỗ trợ lọc nguồn worker theo `Tất cả / Favourite`, có tìm kiếm username cho cả Boss và Worker
- Worker chỉ lấy nhóm account `bình thường` (loại account lỗi/bị khóa/bị block/bất thường)
- Context menu trên AccountCard thêm action:
  - `Add to favourite workers` (toggle add/remove)
  - `Buff me` (đi thẳng `/buff` và preselect account làm boss)
- Account đã nằm trong favourite worker list có icon ngay cạnh username trên card, click icon để toggle add/remove

### Ổn định mapping token/account
- Fix collision cache `fetchMe`: bỏ key theo đuôi 8 ký tự, chuyển sang token fingerprint để tránh map nhầm account
- Luồng add/bulk import gia cố dedupe theo `id/token`, giảm nguy cơ record trùng token

### Electron context menu
- Fix menu `Refresh` chuột phải: reload đúng `index.html`, tránh trạng thái trắng màn hình trên SPA routes

## v0.12.1 — 2026-05-09

### Bulk username đối chiếu
- Thêm mode `Đối chiếu username` trong khối thêm tài khoản để dán danh sách và lọc ra username thiếu trong tool
- Hỗ trợ input username dạng URL profile Threads (`threads.com` / `threads.net`) và chuẩn hoá tự động
- Thêm nút `Clear input` để xoá nhanh input + kết quả đối chiếu

### Context menu trên desktop app
- Khôi phục menu chuột phải trong Electron cho ô nhập liệu: Undo/Redo/Cut/Copy/Paste/Select All
- Thêm menu chuột phải vùng thường: Back/Forward/Refresh + Copy/Select All

## v0.12.0 — 2026-05-08

### App Logs page (toàn tool)
- Thêm route `/logs` + nút `Logs` trên header để theo dõi log toàn tool
- Persist app logs vào localStorage (`td.app_logs.v1`) với giới hạn retention cố định (`MAX_APP_LOGS`)
- Ghi log cho các luồng chính: scheduler (create/update/cancel/delete/run), bulk import, add/remove/refresh account, fetch posts/insights hàng loạt
- Trang logs hiển thị tổng số bản ghi, dung lượng logs hiện tại và hỗ trợ `Clear logs`

## v0.11.4 — 2026-05-08

### Scheduler UX + Log retention
- Thêm nút `Xóa` cho các lịch có trạng thái `cancelled`, giúp dọn danh sách lịch đã hủy
- Giới hạn retention cho logs lịch bằng mức cố định (`MAX_SCHEDULE_LOGS`), áp dụng cả khi load và khi ghi log mới

## v0.11.3 — 2026-05-07

### Hotfix UI context menu
- Fix lỗi UI bị kéo dãn ngang và menu nhấp nháy khi chuột phải trên card
- Nguyên nhân từ hover `transform` trên AccountCard khi render context menu fixed; đã đổi hover sang shadow-only để ổn định layout

## v0.11.2 — 2026-05-07

### Hotfix context menu
- Fix lỗi sau khi đã right-click vào account, right-click ở vùng khác vẫn có thể hiện menu không đúng ngữ cảnh
- Chặn lan truyền sự kiện right-click để menu chỉ mở đúng khi thao tác trên AccountCard

### UI polish
- Thêm hiệu ứng hover nổi nhẹ cho AccountCard để thao tác trực quan hơn

## v0.11.1 — 2026-05-07

### Hotfix context menu
- Fix lỗi menu chuột phải trên AccountCard có thể bị đóng ngay sau khi mở, khiến nhìn như không hiển thị
- Điều chỉnh cơ chế đóng menu: giữ đóng bằng click overlay + phím `ESC`, tránh auto-close bởi listener global không cần thiết

## v0.11.0 — 2026-05-07

### Context menu trên tài khoản
- Thêm menu chuột phải (right-click) trực tiếp trên từng AccountCard để thao tác nhanh
- Menu hỗ trợ các action chính: Mở chi tiết, Chọn/Bỏ chọn, Refresh token, Lấy insights, Lấy posts, Xóa tài khoản
- Đóng menu khi click ra ngoài hoặc nhấn `ESC`

### Scheduler nâng cao
- Thêm khả năng sửa lịch hiện có (Edit schedule) thay vì phải tạo lịch mới
- Form scheduler hỗ trợ chế độ `Lưu chỉnh sửa` / `Hủy sửa`
- Lịch lặp theo `ngày` hỗ trợ chọn thêm giờ/phút/giây cho thời điểm chạy

### Dọn cache theo account khi xóa
- Khi xóa tài khoản, tool xóa luôn cache liên quan account đó (`me`, `posts`, `insights`, `post`, `post_insights`, `replies`) để tránh tái dùng dữ liệu cũ khi add lại token

## v0.10.4 — 2026-05-06

### Multi Scheduler + Persist
- Hẹn giờ hỗ trợ tạo nhiều tác vụ độc lập (không còn ghi đè 1 lịch duy nhất)
- Mỗi tác vụ có nút `Hủy` riêng ngay trong danh sách lịch
- Persist danh sách lịch + logs vào localStorage, sau khi cập nhật/restart app vẫn giữ lịch đã tạo
- Rehydrate lịch active khi mở app: lịch lặp tiếp tục chạy theo `nextRunAt`, lịch one-time quá hạn xa sẽ tự hoàn tất

## v0.10.3 — 2026-05-06

### Live stats refresh
- Fix cập nhật stats trạng thái ngay sau thao tác fetch posts/insights (đơn lẻ và hàng loạt), không cần restart hoặc chuyển trang
- `accountHealthMap` đã phụ thuộc `cacheTick` để các chỉ số Bình thường/Bất thường và filter liên quan cache re-compute tức thì

## v0.10.2 — 2026-05-06

### Scheduler UX
- Khi `Target = Selected`, sổ ra danh sách tài khoản kèm checkbox để chọn ngay trong trang `/scheduler` (kèm nút Chọn tất cả / Bỏ chọn, hiển thị `đã chọn X/Y`)
- Ô `Delay riêng (giây)` chỉ hiện khi có ≥ 2 tài khoản trong target (Selected ≥ 2 hoặc All với accounts ≥ 2) — 1 tài khoản không cần delay

## v0.10.1 — 2026-05-06

### Scheduler Page + Chu kỳ nâng cao
- Tách phần hẹn giờ sang route riêng `/scheduler`, vào từ nút `Hẹn giờ` trên header
- Trang chính `/` tập trung quản lý tài khoản; scheduler nằm riêng để thao tác rõ ràng hơn
- Mở rộng chu kỳ lặp: hỗ trợ `phút`, `giờ`, `ngày` (không chỉ phút)
- Trạng thái lịch hiện tại hiển thị đúng đơn vị chu kỳ đã chọn

### Cache behavior (xác nhận)
- Mỗi lần lịch fetch posts chạy thành công vẫn ghi cache `posts:{id}:10` như fetch thủ công
- Sau khi lịch chạy xong, stats/filter liên quan cache được cập nhật lại ngay

## v0.10.0 — 2026-05-06

### Hẹn giờ fetch posts
- Thêm scheduler fetch posts cho 2 chế độ: hẹn 1 lần hoặc lặp theo chu kỳ phút
- Cho phép chọn target `Selected` hoặc `All`, và **chốt snapshot danh sách account tại thời điểm bấm Lên lịch**
- Thêm nút `Hủy lịch` để dừng lịch hiện tại trước khi tạo lịch mới
- Thêm `logs` sau mỗi lần lịch chạy xong: thời gian chạy, số account, success/fail, thời lượng
- Delay giữa các request khi scheduler chạy dùng setting riêng `Delay riêng (giây)`, không dùng chung `bulkDelay`

## v0.9.0 — 2026-05-05

### Bộ lọc & sắp xếp nâng cao
- Lọc nhanh: "Chưa lấy posts" / "Chưa lấy insights" — filter tài khoản chưa có cache data
- Sắp xếp: Mặc định / Mới nhất / Cũ nhất (theo ngày thêm vào tool) / Follow cao→thấp / thấp→cao
- Lọc followers theo khoảng: nhập min/max followers
- Nút "Xóa bộ lọc" reset tất cả filter/sort nâng cao
- Toolbar lọc/sort nằm giữa StatCards và phần thêm tài khoản
- Field `addedAt` lưu timestamp khi thêm tài khoản (giữ lại khi update token)
- Nút Home reset đầy đủ: bao gồm sort, followers range
- Sort mới/cũ dùng `lastCheck` làm fallback cho tài khoản cũ chưa có `addedAt`

### Cập nhật stats tự động
- Thêm `cacheTick` counter — tự động cập nhật stats khi fetch posts/insights
- Stats "Chưa lấy posts/insights" cập nhật ngay sau khi fetch thủ công trên từng card
- Không cần refresh trang để thấy thay đổi

## v0.8.3 — 2026-05-05

### Thông báo hoàn thành nạp hàng loạt
- Sau khi nạp token xong, hiện banner tổng kết: "X thành công, Y thất bại / Z token"
- Banner màu xanh nếu toàn bộ OK, vàng nếu có lỗi
- Nút X để đóng banner

### Fix nút Home
- Nút Home giờ reset đầy đủ: đóng panel nạp hàng loạt, xóa text token, xóa log

## v0.8.2 — 2026-05-05

### Hot-reload Update
- Electron load dist/ trực tiếp từ thư mục source (`E:\Antigravity\threads-doctor\dist`)
- Nút "Cập nhật" restart app (app.relaunch) để load bản build mới
- Không cần rebuild .exe khi sửa code — chỉ cần `npm run build` rồi nhấn "Cập nhật"
- Fallback: nếu chạy trên browser thì reload trang

## v0.8.1 — 2026-05-05

### Phân trang
- Luôn hiện thông tin phân trang (kể cả chỉ 1 trang)
- Hiển thị chi tiết: "Trang X/Y · Hiển thị 1–20/50"
- Dropdown chọn số tài khoản/trang: 10, 20, 50, 100 (lưu vào localStorage)

### Hiển thị version
- Header subtitle hiện version: "Quản lý tài khoản Threads · vX.Y.Z"
- Footer hiện: "Threads Doctor vX.Y.Z · 2026"

### Nút Cập nhật
- Footer có nút "Cập nhật" — mở thư mục release chứa file .exe mới
- Dùng Electron IPC + preload script (contextBridge) để gọi shell.openPath

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
