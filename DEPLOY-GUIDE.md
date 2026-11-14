# Hướng dẫn Deploy Xem Cùng (Không tốn băng thông video)

Kiến trúc 3 phần để xem phim thoải mái mà **không bị khoá băng thông 5 GB** như Render cũ:

1. **Cloudflare Workers (Free)**: Proxy toàn bộ video HLS (`.m3u8`, `.ts`, `.vtt`). Miễn phí 100.000 request/ngày, không giới hạn băng thông (egress).
2. **Backend Spring Boot (Koyeb / Hugging Face Spaces / Render tài khoản mới)**: Chỉ lo WebSocket đồng bộ phòng, chat, PIN, tìm kiếm phim (chỉ tốn vài KB/phút).
3. **Vercel (Free)**: Host giao diện Frontend React/Vite (100 GB băng thông/tháng).

---

## Phần 1: Tạo Cloudflare Worker (`xem-cung-hls`)

### Cách A — Làm trực tiếp trên web Cloudflare (dễ nhất, không cần gõ lệnh)
1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Ở menu trái, chọn **Compute (Workers) → Workers & Pages → Create → Create Worker**.
3. Đặt tên Worker là `xem-cung-hls` → bấm **Deploy**.
4. Bấm nút **Edit code** (góc trên bên phải).
5. Xoá toàn bộ code mẫu bên trái, copy toàn bộ nội dung file `D:\xem-cung\worker\src\index.js` dán vào.
6. Bấm **Deploy** (góc trên bên phải).
7. Copy URL của Worker vừa tạo (ví dụ: `https://xem-cung-hls.ten-cua-ban.workers.dev`).
   - Kiểm tra nhanh bằng cách mở URL đó trên trình duyệt: thấy `{"ok":true,"service":"xem-cung-hls-worker"}` là thành công!

### Cách B — Deploy bằng dòng lệnh trên máy
```powershell
cd D:\xem-cung\worker
npx wrangler login
npx wrangler deploy
```

---

## Phần 2: Deploy Backend Java

> **Lưu ý:** Không dùng lại workspace Render cũ đang bị `Suspended`. Bạn có thể chọn **Koyeb (Free)**, **Hugging Face Spaces (Docker Free)**, hoặc một **tài khoản Render mới**.

### Ví dụ với Koyeb (Free, không cần thẻ khi dùng gói Nano/Eco tuỳ thời điểm) hoặc Render tài khoản mới:
1. Tạo Web Service mới kết nối với GitHub repo: **`truongquangquoc2011/xem-cung`**, nhánh **`main`**.
2. Kiểu build / Runtime: **Docker** (dùng sẵn `Dockerfile` ở thư mục gốc của repo).
3. Port: **`8080`**.
4. Thêm **Environment Variables**:
   - `HLS_PROXY_URL` = URL Cloudflare Worker ở Phần 1 (ví dụ `https://xem-cung-hls.ten-cua-ban.workers.dev`)
   - `ALLOWED_ORIGINS` = `*` *(sau khi deploy xong Vercel ở Phần 3, bạn có thể đổi thành link Vercel thật, ví dụ `https://xem-cung.vercel.app`)*
5. Bấm **Deploy** và chờ build xong (~3–5 phút).
6. Copy URL Backend (ví dụ `https://xem-cung-api.onrender.com` hoặc `https://xxx.koyeb.app`).
   - Kiểm tra nhanh bằng cách mở `https://<URL-BACKEND>/api/rooms` thấy trả về JSON danh sách phòng là OK!

---

## Phần 3: Deploy Frontend lên Vercel

1. Đăng nhập [vercel.com](https://vercel.com/) → **Add New… → Project**.
2. Chọn repo **`truongquangquoc2011/xem-cung`** → bấm **Import**.
3. Ở mục **Root Directory**, bấm **Edit** và chọn thư mục **`frontend`**.
   - **Framework Preset**: tự động nhận là `Vite`.
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Mở mục **Environment Variables**, thêm **2 biến**:
   - `VITE_API_URL` = URL Backend ở Phần 2 (không có dấu `/` ở cuối)
   - `VITE_HLS_PROXY_URL` = URL Cloudflare Worker ở Phần 1 (không có dấu `/` ở cuối)
5. Bấm **Deploy** và chờ ~1 phút.
6. Mở link `.vercel.app` để sử dụng!

---

## Kiểm tra cuối cùng sau khi deploy xong
- Mở F12 → tab **Network** khi phát một bộ phim trong **Kho phim**:
  - Các request tìm kiếm, tạo phòng, WebSocket sẽ gọi về **URL Backend** (Phần 2).
  - Các request `.m3u8` / `/master` và `/seg` (video `.ts`) sẽ gọi về **URL Cloudflare Worker** (`*.workers.dev`) → Backend hoàn toàn không gánh băng thông video nữa!
