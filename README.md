# 🍿 Xem Cùng — Web xem phim chung

Tạo phòng, gửi link cho bạn bè, cả phòng xem **cùng một video, đồng bộ thời gian**
(ai bấm play / pause / tua thì mọi người theo), vừa xem vừa **chat realtime**.

- **Frontend:** React 18 + TypeScript + Vite
- **Backend:** Java 17+ / Spring Boot 3.5, WebSocket (STOMP)
- **Nguồn video:** YouTube, Kho phim (qua API), link mp4 / m3u8 (HLS)

## Chạy thử

Cần **Java 17+** và **Node.js 18+**. Không cần cài Maven (đã có `mvnw`).

```bash
# Terminal 1: backend (cổng 8080)
cd backend
./mvnw spring-boot:run        # Windows: mvnw.cmd spring-boot:run

# Terminal 2: frontend (cổng 5173)
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173, tạo phòng, rồi mở thêm tab ẩn danh hoặc trình duyệt khác và dán link mời để thử nhiều người.

## Gán API phim của bạn

Có 2 cách:

**Cách 1: dùng class có sẵn.** Sửa `backend/src/main/resources/application.yml`:

```yaml
movies:
  provider: custom
  custom:
    base-url: https://api-cua-ban.example.com
```

`CustomMovieProvider.java` sẽ gọi:

| Request | Trả về (JSON) |
|---|---|
| `GET {base-url}/movies?q=&page=1` | `{ items: [{id, title, year, poster}], page, totalPages }` |
| `GET {base-url}/movies/{id}` | `{ id, title, description, year, poster, episodes: [{name, url}] }` |

`url` của tập phim là link `.mp4` hoặc `.m3u8` phát trực tiếp được.
Nếu API của bạn có format khác, sửa 2 hàm `search()` và `detail()` trong
`CustomMovieProvider.java`: đọc JSON thành `JsonNode` rồi map sang `MoviePage` / `MovieDetail`.
Xem `ArchiveOrgMovieProvider.java` làm mẫu.

**Cách 2: viết provider riêng.** Tạo class `implements MovieProvider`, gắn
`@ConditionalOnProperty(name = "movies.provider", havingValue = "ten-cua-ban")`.

Mặc định (`provider: archive`), kho phim lấy từ **Internet Archive**, bộ sưu tập phim thuộc phạm vi công cộng (public domain).

## Kiến trúc

```
React (Vite)                         Spring Boot
┌────────────────────┐   REST    ┌──────────────────────────────┐
│ HomePage           │──────────▶│ RoomController   /api/rooms  │
│ RoomPage           │           │ MovieController  /api/movies │──▶ MovieProvider
│  ├ VideoPlayer     │           │                              │     ├ ArchiveOrg…
│  │  ├ YouTube      │  STOMP    │ RoomSocketController         │     └ Custom…
│  │  └ <video>+hls  │◀────────▶ │  /app/room/{id}/join|control │
│  ├ SourcePicker    │  /ws      │  /topic/room/{id}  (broadcast)│
│  └ Chat            │           │ RoomService (in-memory)      │
└────────────────────┘           └──────────────────────────────┘
```

### Luồng WebSocket

1. Client kết nối `/ws`, subscribe `/topic/room/{id}` và `/user/queue/snapshot`.
2. Gửi `/app/room/{id}/join {name}`. Server trả **snapshot** (trạng thái phát, lịch sử chat, thành viên) cho riêng người đó, và báo cả phòng có người vào.
3. Khi ai đó play / pause / tua / chọn video: gửi `/app/room/{id}/control {action, position, source?}`. Server cập nhật trạng thái rồi phát `STATE` cho cả phòng.
4. Chat: gửi `/app/room/{id}/chat {text}`. Server phát `CHAT`.

### Thuật toán đồng bộ (`frontend/src/hooks/usePlaybackSync.ts`)

- Server lưu `{playing, position, updatedAt}`. Vị trí hiện tại = `position + (now − updatedAt)` nếu đang phát.
- Client đo **chênh lệch đồng hồ** với server qua `/api/time` (lấy mẫu có RTT nhỏ nhất), nên mọi máy tính ra cùng một vị trí.
- Nhận `STATE` thì lệch hơn 0,75 giây sẽ tua, và phát hoặc dừng cho khớp.
- Cứ 2 giây kiểm tra lệch một lần: lệch hơn 2 giây thì tự sửa (trường hợp mạng chậm hay buffer).
- **Chống vòng lặp:** sự kiện từ trình phát mà khớp với trạng thái phòng (sai số dưới 1,5 giây) thì không gửi lại server, và bỏ qua sự kiện trong 1 giây sau khi chính client vừa điều khiển trình phát.
- Trình duyệt chặn tự phát thì hiện nút "Bấm để xem cùng mọi người".

## Giới hạn hiện tại (hướng phát triển)

- Phòng lưu **trong RAM**: khởi động lại server thì mất phòng. Có thể thêm Redis hoặc database.
- Ai trong phòng cũng điều khiển được. Có thể thêm quyền chủ phòng.
- Không có tài khoản hay đăng nhập. Có thể thêm Spring Security + JWT.
- Simple broker chỉ chạy 1 server. Muốn chạy nhiều server thì dùng RabbitMQ hoặc ActiveMQ làm STOMP relay.
- Có thể thêm voice/video call bằng WebRTC.
