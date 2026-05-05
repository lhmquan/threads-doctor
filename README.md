# Threads Doctor

Bảng điều khiển chẩn đoán & quản lý tài khoản Threads (Meta): theo dõi trạng thái token, phát hiện cảnh báo, và quản lý danh sách tài khoản.

## Stack
- React 18 + Vite
- TailwindCSS
- lucide-react (icons)

## Cài đặt
```bash
npm install
npm run dev
```

Mở http://localhost:5173

## Scripts
- `npm run dev` — chạy dev server
- `npm run build` — build production
- `npm run preview` — preview bản build

## Ghi chú
- Dữ liệu hiện tại là mock trong `src/App.jsx`. Thay bằng Threads Graph API khi tích hợp thật.
- **Không hardcode access token** trong mã nguồn. Sử dụng biến môi trường hoặc backend an toàn.
