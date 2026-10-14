# Test toàn bộ app bằng docker compose (trước khi lên Kubernetes)

## 1. Compose mô phỏng K8s như thế nào

```
                 :8000                                              :3004 (≈ NodePort moderation-webhook)
Trình duyệt ──► Kong (DB-less) ──/api/products──────────────► product-service ─────┐       ▲
                     │──/api/auth───────────────────────────► auth-service ────────┤
                     │──/api/sellers,/api/sessions,/api/lives► live-manager ×2 ──────┼─► PostgreSQL
                     │──/api/orders─────────────────────────► order-service ×2 ─────┼─► Redis (kho theo phiên, Lua, pub/sub chat, mock IVS)
                     │──/ws (WebSocket)─────────────────────► chat-service ×2 ──────┘
                     └──/───────────────────────────────────► web (nginx)
live-manager ── POST /internal/products (sản phẩm của shop) ─► product-service
live-manager ──► AWS IVS (IVS_MODE=aws) | Redis (IVS_MODE=mock, mặc định compose)
live-manager, moderation ── POST /internal/rooms/... ─► chat-service ;  moderation ── GET /internal/channels/open-session ─► live-manager
AWS Lambda bridge (giả lập bởi e2e) ──► moderation-service
```

| K8s | Compose |
|---|---|
| Ingress `kong-routes` (strip-path=false) | `deploy/kong/kong.yml`, cùng path, `strip_path: false` |
| Deployment `replicas: 2` cho chat, order, live-manager | `deploy.replicas: 2`: kiểm chứng Redis adapter, Lua và rate limit PutMetadata xuyên instance |
| Service NodePort `moderation-webhook` | cổng `3004` mở ra host |
| ConfigMap + SealedSecret | biến môi trường trong `docker-compose.yml` / `.env` |
| readiness/liveness `/healthz` | `HEALTHCHECK` trong Dockerfile + `depends_on: service_healthy` |
| DBaaS PostgreSQL, Redis | container `postgres:16-alpine`, `redis:7-alpine` |

Mỗi service tự tạo bảng khi khởi động (`CREATE TABLE IF NOT EXISTS`, có `pg_advisory_lock` để nhiều replica không chạy migration cùng lúc), nên không cần Job migration riêng. order-service gặp bảng `orders` kiểu cũ (flash sale, có cột `sale_id`) sẽ đổi tên thành `orders_flashsale_legacy` rồi tạo bảng mới.

## 2. Lệnh

```bash
make up         # build + chạy; http://localhost:8000 (#/admin đăng ký người bán, #/seller trang người bán)
make test       # e2e
make loadtest   # k6 (đổi tham số: STOCK=50 REQUESTS=10000 VUS=300 make loadtest)
make logs
make reset      # xóa sạch dữ liệu
```

Demo tay: `#/admin` → đăng ký người bán (nhập `ADMIN_TOKEN`, token người bán chỉ hiện một lần) → `#/seller` dán token → tạo phiên, chọn sản phẩm + tồn kho → mở link người xem `#/live/<sessionId>` ở tab khác → mua, chat, ghim sản phẩm từ tab người bán.

Ở `IVS_MODE=mock` mọi kênh phát luồng demo công khai của AWS. Muốn dùng kênh thật cho từng người bán và OBS: xem [live-manager.md](live-manager.md).

## 3. Bộ test e2e kiểm tra gì (88 kiểm tra)

1. Gateway: Kong trả trang web, `/config.js`; `/internal/*` không tới được service (rơi về `index.html`).
2. Product: danh mục đã seed, 404; route flash sale cũ không còn.
2b. Tài khoản: đăng ký → `usr_…` + token; trùng username → 409; mật khẩu ngắn/username sai → 400; sai mật khẩu hoặc user không tồn tại → 401; `/me` với token bị sửa → 401; xem đơn của `usr_…` không có token → 403.
3. Người bán: đăng ký cần `x-admin-token`; Bearer sai → 401; lấy stream key; **đặt lại key** → key mới khác key cũ, ARN đổi; zip profile OBS có `service.json` chứa đúng server + key.
3b. Sản phẩm của shop: thêm cần Bearer; giá < 1.000đ, link ảnh không phải http(s) → 400; sản phẩm mới gắn `sellerId`, chỉ hiện trong danh mục của shop đó; shop khác mở phiên với sản phẩm này → 400; Kong không mở `/internal/products`.
4. Phiên live: validate body; còn phiên mở → 409; `/api/lives` và `/api/lives/:id` không lộ `streamKey`, ingest, channel ARN.
5. Đơn: thiếu/sai `sessionId` → 400; sản phẩm ngoài phiên → 404; mua lần 2 → 409 `ALREADY_BOUGHT`; hết hàng → 409 `SOLD_OUT`; đơn mang `sessionId`, `sellerId`.
6. Tải: 1.000 request đồng thời, tồn kho 100 ⇒ **đúng 100** đơn 201, 100 dòng PostgreSQL, Redis còn 0.
7. Chat theo phòng = `sessionId` xuyên 2 pod; ghim → sự kiện socket `pin`; ghim liên tục → 429; người bán khác không ghim/kết thúc được phiên.
8. Moderation: secret, `eventId`, chống trùng; webhook chỉ có `channelArn` → cảnh báo vào đúng phòng của phiên đang mở.
9. Kết thúc phiên: socket `session_ended`, phiên biến khỏi `/api/lives`, mua tiếp → 404.
5b. Đơn theo tài khoản: có token thì `userId` lấy từ token (bỏ qua body); `GET /api/orders` với token trả đúng đơn của tài khoản.

`E2E_ONLY=auth docker compose --profile test run --rm e2e` chỉ chạy mục 1, 2, 2b: không tạo người bán, dùng được khi `IVS_MODE=aws` mà không sinh kênh IVS thật.

Kết quả lần chạy gần nhất: 66/66 đạt; k6 5.004 request → 100 đơn, 0% lỗi, p95 ≈ 73 ms (MacBook, Docker Desktop).

## 4. API

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/products`, `/api/products/:id` | danh mục; `?sellerId=<uuid>` = sản phẩm dùng chung + của shop đó |
| POST | `/api/auth/register` | `{"username","password","displayName"?}` → 201 `{token, user}` / 409 `USERNAME_TAKEN` |
| POST | `/api/auth/login` | `{"username","password"}` → 200 `{token, user}` / 401 / 429 (10 lần sai / 15 phút) |
| GET | `/api/auth/me` | `Authorization: Bearer <jwt>` → user |
| * | `/api/sellers/*`, `/api/sessions/*`, `/api/lives/*` | live-manager, xem [live-manager.md](live-manager.md#2-api) |
| POST | `/api/orders` | `{"sessionId":"<uuid>","productId":1,"quantity":1}` + `Authorization: Bearer <jwt>` → 201 / 404 không bán trong phiên / 409 `SOLD_OUT` \| `ALREADY_BOUGHT`. Không token: khách với `userId` trong body (khi `ALLOW_GUEST_ORDERS=true`; `userId` dạng `usr_…` → 403) |
| GET | `/api/orders` (Bearer) hoặc `?userId=` (khách) | đơn của tài khoản / của khách |
| GET | `/api/orders/stats?sessionId=&productId=` | số đơn của phiên (`productId` tùy chọn) |
| WS | `/ws` (Socket.io, chỉ transport `websocket`) | `hello`, `join {room: sessionId, username}`, `message {text}`; server phát `message`, `pin`, `session_ended` |
| POST | `product-service:3002/internal/products` | nội bộ, `x-internal-token`, live-manager gọi khi người bán thêm sản phẩm |
| POST | `chat-service:3001/internal/rooms/:room/system-messages` | nội bộ, `x-internal-token`; Kong **không** route `/internal` |
| POST | `chat-service:3001/internal/rooms/:room/events` | nội bộ, `{"event":"pin"\|"session_ended","data":{...}}` (data ≤ 1 KB) |
| GET | `live-manager:3005/internal/channels/open-session?channelArn=` | nội bộ, cho moderation |
| GET | `/healthz` (liveness), `/readyz` (kiểm tra PostgreSQL/Redis) | mọi service |

## 5. Hợp đồng webhook moderation (Lambda bridge → moderation-service)

```http
POST /webhooks/moderation
x-webhook-secret: <WEBHOOK_SHARED_SECRET>
content-type: application/json

{
  "eventId": "id-duy-nhất-của-sự-kiện",
  "type": "IMAGE_VIOLATION",
  "action": "STREAM_STOPPED",
  "channelArn": "arn:aws:ivs:ap-southeast-1:...:channel/...",
  "labels": [{ "name": "Violence", "confidence": 97.3 }],
  "thumbnailUrl": "s3://bucket/key.jpg",
  "occurredAt": "2026-10-06T08:00:00Z",
  "room": "<tùy chọn>"
}
```

Phòng chat nhận cảnh báo: `room` nếu có, nếu không thì phiên đang mở của kênh `channelArn` (moderation hỏi live-manager `/internal/channels/open-session`), cuối cùng là `CHAT_ROOM`.

Phản hồi `200 {"result":"notified"|"duplicate"}`; `502` khi chưa báo được vào chat ⇒ Lambda nên retry với **cùng** `eventId`. `GET /api/moderation/events` (cùng header) xem 50 sự kiện gần nhất.

## 6. Biến môi trường

| Service | Biến |
|---|---|
| product | `PORT`, `DATABASE_URL`, `INTERNAL_API_TOKEN` (bảo vệ `/internal/products`), `DATABASE_READ_HOSTS` |
| order | `PORT`, `DATABASE_URL`, `REDIS_URL`, `PG_POOL_MAX` (mặc định 10), `JWT_SECRET`, `ALLOW_GUEST_ORDERS` (mặc định `true`; prod nên `false`) |
| auth | `PORT` (3006), `DATABASE_URL`, `JWT_SECRET` (≥ 32 ký tự, **giống** order-service) |
| chat | `PORT`, `REDIS_URL`, `INTERNAL_API_TOKEN` (tùy chọn) |
| moderation | `PORT`, `DATABASE_URL`, `CHAT_SERVICE_URL`, `LIVE_MANAGER_URL`, `CHAT_ROOM` (dự phòng), `WEBHOOK_SHARED_SECRET`, `INTERNAL_API_TOKEN` |
| live-manager | xem [live-manager.md](live-manager.md#5-biến-môi-trường-live-manager) |
| web | `IVS_PLAYER_SDK_URL` (playback URL lấy theo phiên từ API) |

`DATABASE_READ_HOSTS` (product, live-manager; tùy chọn): danh sách `host[:port]` các slave PostgreSQL, cách nhau dấu phẩy. Dùng chung user/mật khẩu/db với `DATABASE_URL`. Chỉ các đọc người xem poll liên tục đi slave: `GET /api/lives`, `GET /api/lives/:id`, `GET /api/products` không có `sellerId`. Slave lỗi kết nối thì đọc master 30 giây. `PG_READ_POOL_MAX` mặc định bằng `PG_POOL_MAX`. Local để trống.

## 7. Checklist khi chuyển sang repo infra (K8s)

- [ ] **live-manager**: tạo `apps/live-manager` (base + overlays): Deployment `replicas: 2`, Service cổng 3005, probe `/healthz`. `build-and-deploy.yml` đã có path filter `services/live-manager/**` và cập nhật tag image `live-manager` trong overlay.
- [ ] Kong: thêm route `/api/sellers`, `/api/sessions`, `/api/lives` → `live-manager:3005` (strip-path=false). **Không** route `/internal`.
- [ ] **SealedSecret live-manager**: `DATABASE_URL`, `ADMIN_TOKEN`, `INTERNAL_API_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (IAM user theo `docs/iam-live-manager-policy.json`). ConfigMap: `IVS_MODE=aws`, `AWS_REGION`, `IVS_RECORDING_CONFIGURATION_ARN`, `PRODUCT_SERVICE_URL`, `CHAT_SERVICE_URL`, `REDIS_URL` nếu không để trong secret.
- [ ] Các Secret khác: `DATABASE_URL` (product, order, moderation), `WEBHOOK_SHARED_SECRET` + `INTERNAL_API_TOKEN` (moderation), `INTERNAL_API_TOKEN` (chat). product **không** còn cần `ADMIN_TOKEN`, `REDIS_URL`. Thiếu biến bắt buộc thì service dừng ngay với lỗi `Thiếu biến môi trường ...`.
- [ ] `moderation-service-config`: sửa `CHAT_SERVICE_URL` theo namespace overlay (`live-commerce-dev` / `-prod`), thêm `LIVE_MANAGER_URL`, `CHAT_ROOM`. NetworkPolicy cho phép namespace `moderation` gọi chat-service và live-manager (cổng 3005), và tới PostgreSQL.
- [ ] **auth-service**: tạo `apps/auth-service` (Deployment, Service cổng 3006, probe `/healthz`), thêm vào path filter + cập nhật tag trong `build-and-deploy.yml`. Kong: route `/api/auth` → `auth-service:3006` (strip-path=false).
- [ ] **SealedSecret `JWT_SECRET`** (`openssl rand -hex 32`) dùng chung cho auth-service và order-service. ConfigMap order-service: `ALLOW_GUEST_ORDERS=false` trên prod.
- [ ] `INTERNAL_API_TOKEN` phải **giống nhau** ở chat, moderation, live-manager, product.
- [ ] Web: không cần ConfigMap `IVS_PLAYBACK_URL`/`CHAT_ROOM` nữa.
- [ ] Dữ liệu: lần deploy đầu, order-service đổi tên bảng `orders` cũ thành `orders_flashsale_legacy` (không xóa).
- [ ] Kong `/ws`: cân nhắc tăng timeout bằng annotation `konghq.com/read-timeout`, `konghq.com/write-timeout` (kết nối chat sống lâu). Cloudflare: bật WebSockets.
- [ ] Có thể đổi readinessProbe sang `/readyz`; giữ livenessProbe ở `/healthz`.
- [ ] Image chạy `USER node` (UID 1000), tương thích `runAsNonRoot`. Web (nginx) vẫn chạy root để ghi `config.js` lúc khởi động.

## 8. Giới hạn của MVP (có chủ đích)

- Người mua đăng nhập bằng tài khoản auth-service (JWT 7 ngày, chưa có refresh token/đổi mật khẩu/quên mật khẩu). Giới hạn đăng nhập sai đếm trong bộ nhớ **từng pod**. Tên trong chat chưa được xác thực (chat-service chỉ nhận tên hiển thị). Người bán dùng token `lcs_…` do admin cấp; admin dùng `ADMIN_TOKEN`.
- Người bán chưa sửa/xóa được sản phẩm đã thêm.
- Chưa có thanh toán, hủy đơn quá hạn/nhả kho.
- Tồn kho và số người xem cập nhật bằng poll (2 s trang xem, 5 s danh sách). Số người xem từ IVS ListStreams (cache 5 s).
- Profile OBS chưa kiểm chứng trên mọi phiên bản OBS (xem live-manager.md mục 3).
- Lambda `channel-manager` (thay access key dài hạn) để sau.
