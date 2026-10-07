# Cách live-manager quản lý phiên live và cách người xem chuyển phiên

Tài liệu này giải thích:
- live-manager lưu phiên live như thế nào;
- khi người xem nhảy từ phiên này sang phiên khác thì frontend và backend làm gì;
- vì sao chỉ cần đổi `sessionId` là video, chat, giỏ hàng và đơn hàng cùng đổi theo.

API chi tiết, OBS và IAM xem ở [live-manager.md](live-manager.md).

## 1. Mô hình dữ liệu: người bán, kênh IVS và phiên live

```
seller (1) ──── (1) kênh IVS  ──── playback_url, channel_arn, ingest_endpoint, stream_key_arn
   │
   └── (n) live_sessions ──── (n) session_products (sản phẩm + tồn kho ban đầu)
```

| Khái niệm | Lưu ở đâu | Vòng đời |
|---|---|---|
| **Người bán** (`sellers`) | PostgreSQL | Tạo một lần qua `POST /api/sellers`, đồng thời tạo **một kênh IVS riêng**. |
| **Kênh IVS** | AWS IVS (hoặc Redis khi `IVS_MODE=mock`) | Cố định theo người bán. `playback_url` và `channel_arn` được lưu vào bảng `sellers` ngay lúc tạo và không đổi. |
| **Phiên live** (`live_sessions`) | PostgreSQL, `id` là UUID | Người bán mở phiên mới cho mỗi buổi bán (`POST /api/sessions`) và đóng khi xong (`POST /api/sessions/:id/end`). |
| **Tồn kho trong phiên** | Redis `live:{sessionId}:p:<productId>:stock` | Nạp khi mở phiên, xóa khi kết thúc. |
| **Phòng chat** | chat-service, tên phòng = `sessionId` | Tồn tại khi có người join. |

Hai quy tắc quan trọng:

1. **`playback_url` thuộc về kênh của người bán, không thuộc về phiên.** Bảng `live_sessions` không có cột `playback_url`. Khi cần, live-manager lấy nó bằng `JOIN` sang bảng `sellers` ([lives.service.ts](../services/live-manager/src/lives/lives.service.ts), hằng `LIVE_SELECT`):
   ```sql
   SELECT s.id, s.title, s.status, ..., se.channel_arn, se.playback_url
   FROM live_sessions s JOIN sellers se ON se.id = s.seller_id
   ```
2. **Mỗi người bán chỉ có một phiên `OPEN` tại một thời điểm**, vì một kênh IVS chỉ phát được một luồng. Cơ sở dữ liệu tự đảm bảo điều này bằng partial unique index ([schema.ts](../services/live-manager/src/schema.ts)):
   ```sql
   CREATE UNIQUE INDEX live_sessions_one_open_per_seller ON live_sessions (seller_id) WHERE status = 'OPEN';
   ```
   Mở phiên thứ hai khi phiên cũ chưa kết thúc sẽ vi phạm index này, và API trả `409`. Cách này đúng kể cả khi chạy nhiều replica, vì không phụ thuộc vào kiểm tra trong code.

Hệ quả:
- **Hai phiên của hai người bán khác nhau** có hai `playback_url` khác nhau, vì là hai kênh khác nhau.
- **Hai phiên của cùng một người bán** ở hai thời điểm khác nhau dùng chung một `playback_url`. Phiên cũ đã `ENDED` nên không ai xem nhầm.

## 2. Vòng đời một phiên

```
Người bán                         live-manager                           Redis / IVS / chat-service
   │ POST /api/sessions {title, products}  │
   │──────────────────────────────────────►│ BEGIN
   │                                       │ INSERT live_sessions (status OPEN)
   │                                       │ INSERT session_products
   │                                       │ MULTI: SET live:{id}:seller, live:{id}:p:*:stock ──► Redis
   │                                       │ COMMIT  (phiên chỉ hiện ra khi kho đã sẵn sàng)
   │◄────────────────────── {sessionId} ───│
   │ OBS/ffmpeg đẩy luồng vào ingest ──────────────────────────────────────────────► kênh IVS: LIVE
   │ POST /api/sessions/:id/pin            │ UPDATE pinned_product_id
   │──────────────────────────────────────►│ PutMetadata(channel_arn) ─────────────────► IVS (gắn vào video)
   │                                       │ emit(room=sessionId, 'pin') ──────────────► chat-service
   │ POST /api/sessions/:id/end            │ UPDATE status = 'ENDED'
   │──────────────────────────────────────►│ DEL live:{id}:* ──────────────────────────► Redis (hết bán)
   │                                       │ emit(room=sessionId, 'session_ended') ────► chat-service
```

- Nếu ghi Redis lỗi, transaction PostgreSQL bị rollback và các khóa Redis đã ghi được xóa. Vì vậy không có phiên "mồ côi" nào thiếu tồn kho.
- Sau khi kết thúc, xóa khóa Redis làm Lua script ở order-service không còn thấy tồn kho, nên mọi đơn mới của phiên bị từ chối.
- `streamState` (`LIVE`/`OFFLINE`) và `viewerCount` không lưu trong DB.
  - live-manager gọi `ListStreams` một lần cho toàn region, rồi tra theo `channel_arn`.
  - Kết quả được cache 5 giây và các request đồng thời dùng chung một lần gọi.

## 3. Người xem chuyển từ phiên A sang phiên B

Toàn bộ việc "chuyển phiên" diễn ra ở **trình duyệt**. Backend **không giữ trạng thái "người xem đang ở phiên nào"**: không có session phía server, không có API "switch". Mỗi request chỉ đơn giản là "cho tôi thông tin phiên X".

### Các bước

```
Trình duyệt                                     Kong        live-manager         IVS CDN / chat-service
1. Bấm thẻ phiên B (href = #/live/<B>)
2. hashchange → useRoute() parse ra sessionId=B
3. <LivePage key={B}> : React hủy LivePage(A), dựng LivePage(B) mới
   ├─ cleanup A: player.delete(), socket.disconnect(), clearInterval
4. GET /api/lives/B ───────────────────────────► /api/lives ─► SELECT ... WHERE s.id = B
                                                              JOIN sellers → playback_url của người bán B
   ◄──────────── {playbackUrl: URL_B, products, pinnedProductId, status, streamState} ─
5. <Player playbackUrl=URL_B>: sdk.create(), player.load(URL_B) ───────────────────► tải HLS của kênh B
6. useChatRoom(room=B): io() kết nối mới, emit('join', {room: B}) ──────────────────► chat-service: join phòng B
                                                                                       ◄─ lịch sử chat phòng B
7. Poll GET /api/lives/B mỗi 2 giây (tồn kho), lọc đơn của tôi theo sessionId = B
```

### Mã nguồn tương ứng

| Bước | File | Chi tiết |
|---|---|---|
| 1 | [LivesPage.tsx](../web/src/pages/LivesPage.tsx) | Mỗi thẻ là `<a href={href.live(sessionId)}>`, nên link chia sẻ hoặc mở lại được. Danh sách tự làm mới mỗi 5 giây từ `GET /api/lives`. |
| 2 | [router.ts](../web/src/router.ts) | Hash router: `#/live/<uuid>` thành `{page:'live', sessionId}`. |
| 3 | [App.tsx](../web/src/App.tsx) | `<LivePage key={route.sessionId} …/>`: **`key` đổi thì React unmount component cũ và mount component mới**. Mọi state của phiên A (sản phẩm ghim, toast, tim, đơn hàng…) bị bỏ, không bị lẫn sang B. |
| 4 | [lives.service.ts](../services/live-manager/src/lives/lives.service.ts) `detail()` | Một truy vấn theo `sessionId` trả về `playbackUrl` (qua JOIN), sản phẩm, tồn kho Redis và trạng thái phiên. |
| 5 | [Player.tsx](../web/src/components/Player.tsx) | `useEffect(…, [playbackUrl])`: URL đổi thì cleanup gọi `player.delete()` (ngắt tải HLS cũ) rồi tạo player mới và `load(URL_B)`. |
| 6 | [Chat.tsx](../web/src/components/Chat.tsx) `useChatRoom` | `useEffect(…, [room])`: đóng socket cũ, mở socket mới, `join` phòng `B`. Phía server ([chat.gateway.ts](../services/chat-service/src/chat.gateway.ts)) nếu cùng một socket join phòng khác thì tự `leave` phòng cũ. |
| 7 | [LivePage.tsx](../web/src/pages/LivePage.tsx) | Mọi lời gọi đều mang `sessionId`: `api.live(B)`, `api.order(token, B, productId)`, lọc `orders` theo `sessionId`. |

## 4. Tại sao chỉ cần đổi `sessionId` là đổi được video?

**a. `sessionId` là khóa duy nhất của mọi thứ trong phiên.** Từ một UUID, backend suy ra được toàn bộ:

| Từ `sessionId` | Suy ra | Ở đâu |
|---|---|---|
| `live_sessions.seller_id` → `sellers.playback_url` | video cần phát | PostgreSQL (JOIN) |
| `sellers.channel_arn` | trạng thái LIVE, số người xem, kênh nhận PutMetadata | IVS `ListStreams` / `PutMetadata` |
| `live:{sessionId}:*` | tồn kho, ai đã mua | Redis (order-service dùng chung khóa này) |
| phòng `sessionId` | chat, sự kiện `pin`, `session_ended` | chat-service |
| `orders.session_id` | đơn hàng của phiên | order-service |

Frontend không cần biết kênh IVS, ARN hay người bán nào. Nó chỉ cần `sessionId`, mọi thứ còn lại backend trả về.

**b. Playback URL của IVS là một địa chỉ HLS công khai, không gắn với người xem.** Mỗi kênh IVS có một URL cố định dạng:

```
https://<id>.<region>.playback.live-video.net/api/video/v1/<region>.<account>.channel.<channelId>.m3u8
```

- Đây là file playlist HLS phân phối qua CDN của IVS. Bất kỳ player nào `load()` URL này đều nhận cùng luồng hình của kênh đó.
- Không cần đăng nhập, không có kết nối "giữ chỗ" với server. Vì vậy chuyển kênh chỉ là hủy player cũ và tải một playlist khác, giống đổi `src` của thẻ `<video>`.
- Muốn giới hạn người xem thì IVS có *private channel* (playback token ký bằng khóa riêng). MVP này dùng kênh public.

**c. Backend stateless, mỗi request độc lập.** live-manager không nhớ người xem nào đang ở đâu. Vì vậy:
- chạy nhiều replica live-manager sau Kong không cần sticky session;
- tải lại trang, mở hai tab hai phiên, hay gửi link `#/live/<id>` cho người khác đều chạy giống nhau.

**d. Tách "kênh" (hạ tầng, tốn thời gian tạo) khỏi "phiên" (nghiệp vụ, tạo tức thì).**
- Tạo kênh IVS mất một lời gọi AWS và có giới hạn số kênh, nên chỉ làm một lần cho mỗi người bán.
- Phiên chỉ là vài dòng trong PostgreSQL và vài khóa Redis, mở và đóng bao nhiêu lần cũng được.
- Người bán dùng **cùng một server và stream key OBS** cho mọi buổi live, không phải cấu hình lại.

## 5. Trường hợp đặc biệt

| Tình huống | Điều gì xảy ra |
|---|---|
| Phiên đã `ENDED` mà người xem vẫn mở link | `GET /api/lives/:id` vẫn trả về (kèm `status: 'ENDED'`), giao diện khóa nút mua. Phiên `ENDED` không nằm trong `GET /api/lives`. |
| Đang xem thì người bán kết thúc phiên | Sự kiện `session_ended` đến ngay qua socket, ngoài ra lần poll 2 giây cũng thấy `status: 'ENDED'`. |
| Phiên mở nhưng chưa có OBS phát | Có `playbackUrl` nhưng playlist chưa có dữ liệu: player báo "Kênh chưa phát hoặc đã dừng", `streamState: 'OFFLINE'`. |
| Ghim sản phẩm từ phiên khác lọt vào | Payload timed metadata có `sessionId`; `onPin` bỏ qua nếu khác phiên đang xem. Phiên cũ của cùng người bán (chung kênh) cũng không ghim nhầm sang phiên mới. |
| `sessionId` không hợp lệ | `ParseUUIDPipe` trả `400`; UUID không tồn tại trả `404`. |
| `IVS_MODE=mock` | Mọi kênh mock có cùng `playback_url` = `MOCK_PLAYBACK_URL` (luồng demo của AWS) và luôn coi như `LIVE`. Cơ chế chuyển phiên y hệt; chỉ là các phiên phát cùng một video. |

## 6. Những gì người xem **không** nhận được

`GET /api/lives` và `GET /api/lives/:id` chỉ trả `sessionId`, tiêu đề, tên người bán, `playbackUrl`, trạng thái, số người xem, sản phẩm. Không trả `channel_arn`, `ingest_endpoint` hay stream key, nên biết `playbackUrl` chỉ xem được, không phát được lên kênh. Stream key chỉ người bán có Bearer token mới lấy được qua `GET /api/sellers/me/stream-key`.
