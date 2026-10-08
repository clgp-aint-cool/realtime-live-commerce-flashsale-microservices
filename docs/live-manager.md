# live-manager: người bán dùng OBS, kênh IVS riêng, phiên live

Cách phiên live được lưu và cách người xem chuyển phiên (đổi playbackUrl): [live-sessions.md](live-sessions.md).

## 1. Luồng

```
Admin ──POST /api/sellers──► live-manager ──CreateChannel (+ recording config dùng chung)──► AWS IVS
                               │  lưu sellers(channel_arn, ingest_endpoint, playback_url, stream_key_arn)
Người bán (#/seller, token lcs_…)
   ├─ GET  /api/sellers/me/stream-key      ──GetStreamKey──► IVS   (chỉ người bán, Cache-Control: no-store)
   ├─ POST /api/sellers/me/stream-key/reset ──StopStream, DeleteStreamKey, CreateStreamKey──► IVS
   ├─ GET  /api/sellers/me/obs-profile     ──zip profile OBS đã điền server + key
   ├─ POST /api/sessions {title, products}  ──► PostgreSQL + nạp kho Redis live:{sessionId}:p:<id>:stock
   ├─ POST /api/sessions/:id/pin           ──PutMetadata──► IVS (timed metadata) + socket "pin"
   └─ POST /api/sessions/:id/end           ──► xóa kho Redis + socket "session_ended"
OBS ──RTMPS──► rtmps://<ingestEndpoint>:443/app/ + stream key ──► IVS ──HLS──► người xem
Người xem (#/live/<sessionId>) ── GET /api/lives/:id (playbackUrl theo phiên) + chat phòng = sessionId
                               └─ POST /api/orders {sessionId, productId, userId} ──► order-service (Lua theo phiên)
```

Nguyên tắc bảo mật:

- DB chỉ lưu **ARN** của stream key. Giá trị key lấy bằng `GetStreamKey` mỗi lần người bán cần, không cache, không log.
- `/api/lives*` (công khai) chỉ trả tiêu đề, người bán, `playbackUrl`, trạng thái, số người xem, sản phẩm. Không có key, ingest endpoint hay channel ARN (e2e kiểm tra điều này).
- Token người bán `lcs_…` chỉ hiện một lần lúc admin đăng ký; DB lưu SHA-256.
- `/internal/*` (tra phiên theo channelArn cho moderation) không được Kong định tuyến và yêu cầu `x-internal-token`.

## 2. API

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/api/sellers` | `x-admin-token` | `{"name"}` → `{seller, token}`. Tạo kênh IVS; DB lỗi thì xóa kênh vừa tạo |
| GET | `/api/sellers/me` | Bearer | `ingestServer`, `playbackUrl`, `hasStreamKey`, `currentSessionId` |
| GET | `/api/sellers/me/stream-key` | Bearer | `{streamKey}` |
| POST | `/api/sellers/me/stream-key/reset` | Bearer | Ngắt luồng đang phát, xóa key cũ, tạo key mới → `{streamKey}` |
| GET | `/api/sellers/me/obs-profile` | Bearer | file zip |
| GET | `/api/sellers/me/products` | Bearer | sản phẩm dùng chung + sản phẩm của shop (`sellerId`) |
| POST | `/api/sellers/me/products` | Bearer | `{"name","price","description"?,"imageUrl"?}` → sản phẩm mới. Giá 1.000-1.000.000.000đ; ảnh trống = ảnh ngẫu nhiên |
| POST | `/api/sessions` | Bearer | `{"title","products":[{"productId","stock"}]}` (1-20 sản phẩm). 409 nếu còn phiên mở |
| POST | `/api/sessions/:id/pin` | Bearer | `{"productId": 1 \| null}` → `{metadata: sent\|not_broadcasting\|throttled\|error, socket}`. 429 nếu < 200 ms từ lần trước |
| POST | `/api/sessions/:id/end` | Bearer | |
| GET | `/api/lives` | công khai | phiên đang mở + `viewerCount`, `streamState` (ListStreams, cache 5 s) |
| GET | `/api/lives/:id` | công khai | + `products` (tồn kho Redis), `pinnedProductId`, `status` |
| GET | `/internal/channels/open-session?channelArn=` | `x-internal-token` | cho moderation-service |

Giới hạn IVS được tôn trọng:

- **PutMetadata**: payload ≤ 1 KB (payload thực tế ~100 byte, vẫn kiểm tra); ≤ 5 lần/giây/kênh. Rate limit bằng `SET ratelimit:metadata:<channelArn> PX 200 NX` trong Redis nên đúng cả khi nhiều replica.
- Kênh chưa phát thì PutMetadata trả `ChannelNotBroadcasting`. Khi đó ghim vẫn được lưu và đẩy qua socket, kết quả là `metadata: "not_broadcasting"`.
- **ListStreams** trả toàn bộ stream của region. Kết quả được cache 5 giây và các request đồng thời dùng chung một lời gọi. IVS lỗi thì dùng dữ liệu cũ, không làm hỏng trang.

Trang xem nhận ghim theo hai đường. Timed metadata (`TEXT_METADATA_CUE`) đồng bộ với khung hình. Socket `pin` phục vụ người mới vào và trường hợp chưa phát. Cả hai đường cùng đặt một trạng thái nên không bị trùng.

## 3. Profile OBS (⚠ chưa kiểm chứng định dạng)

Zip `LiveCommerce-<tên>.zip` gồm thư mục profile và hướng dẫn `DOC-TOI.txt`:

| File | Nội dung |
|---|---|
| `basic.ini` | Tên profile; Output Advanced, x264; 1280×720 @ 30 fps |
| `service.json` | `rtmp_custom`: `server` = `rtmps://<ingest>:443/app/`, `key` = stream key hiện tại |
| `streamEncoder.json` | CBR 3500 kbps, keyframe 2 s, preset veryfast, profile main, tune zerolatency (khuyến nghị của IVS cho STANDARD/LOW latency) |

Cách thử trên máy bạn:

1. OBS ▸ **Profile ▸ Import** ▸ chọn thư mục đã giải nén (thư mục chứa `basic.ini`).
2. **Profile** ▸ chọn profile vừa import ▸ **Settings ▸ Stream**: kiểm tra Service = Custom, Server/Stream Key đã điền.
3. Bấm **Start Streaming**. Trang `#/seller` chuyển sang `LIVE` sau tối đa ~5 giây.

Nếu bản OBS không đọc được profile (định dạng thay đổi giữa các phiên bản), dùng cách thủ công: Settings ▸ Stream ▸ Service **Custom…**, dán Server và Stream Key từ trang người bán (có nút Chép). Sau khi **Đặt lại key**, profile cũ hết hiệu lực, cần tải lại hoặc dán key mới.

> File zip chứa stream key: đừng gửi qua chat/email, xóa sau khi import.

## 4. IAM user quyền tối thiểu + Sealed Secrets

Policy mẫu: [iam-live-manager-policy.json](iam-live-manager-policy.json). Thay `<ACCOUNT_ID>` và `<RECORDING_CONFIGURATION_ID>`. Region mặc định là `ap-northeast-1` (Tokyo). IVS không có ở `ap-southeast-1` (Singapore).

- Chỉ gồm những API code thật sự gọi: `CreateChannel` (+`TagResource` vì kênh được gắn tag `app=live-commerce`, `sellerId`), `DeleteChannel` (rollback khi đăng ký lỗi), `GetStreamKey`, `CreateStreamKey`, `DeleteStreamKey`, `StopStream`, `PutMetadata`, `ListStreams`.
- Không cấp `GetStream` vì danh sách số người xem lấy từ `ListStreams` (một lời gọi cho mọi kênh).
- Kiểm thử policy bằng IAM Policy Simulator trước khi dùng. Muốn chặt hơn: thêm điều kiện `aws:ResourceTag/app = live-commerce`.

```bash
aws iam create-user --user-name live-manager-cmc
aws iam put-user-policy --user-name live-manager-cmc --policy-name ivs-live-manager \
  --policy-document file://docs/iam-live-manager-policy.json
aws iam create-access-key --user-name live-manager-cmc   # chỉ chạy một lần, đưa thẳng vào kubeseal
```

```bash
kubectl create secret generic live-manager-aws -n live-commerce-dev --dry-run=client -o yaml \
  --from-literal=AWS_ACCESS_KEY_ID=... --from-literal=AWS_SECRET_ACCESS_KEY=... \
  --from-literal=ADMIN_TOKEN=... --from-literal=INTERNAL_API_TOKEN=... --from-literal=DATABASE_URL=... \
  | kubeseal --format yaml > apps/live-manager/overlays/dev/sealed-secret.yaml
```

Sau này có thể đặt một Lambda `channel-manager` sau API Gateway (IAM role thay cho access key dài hạn). Khi đó CMC chỉ gọi một endpoint có xác thực. Chỉ cần viết thêm một lớp thay cho `AwsIvsGateway`; các phần còn lại giữ nguyên vì đều đi qua interface `IvsGateway`.

## 5. Biến môi trường live-manager

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 3005 | |
| `DATABASE_URL`, `REDIS_URL` | | bắt buộc |
| `ADMIN_TOKEN` | | bắt buộc, đăng ký người bán |
| `PRODUCT_SERVICE_URL`, `CHAT_SERVICE_URL` | | bắt buộc |
| `INTERNAL_API_TOKEN` | | gọi chat `/internal` và bảo vệ `/internal` của live-manager |
| `IVS_MODE` | `aws` | `mock` = không gọi AWS, trạng thái lưu trong Redis (compose mặc định `mock`) |
| `AWS_REGION` | `ap-northeast-1` | |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | | từ SealedSecret |
| `IVS_RECORDING_CONFIGURATION_ARN` | | recording configuration dùng chung, gắn vào mọi kênh (để trống = không ghi hình) |
| `IVS_CHANNEL_TYPE`, `IVS_LATENCY_MODE` | `STANDARD`, `LOW` | |
| `IVS_STREAMS_CACHE_MS` | 5000 | cache ListStreams |
| `MOCK_PLAYBACK_URL`, `MOCK_INGEST_ENDPOINT` | luồng demo AWS | chỉ khi `IVS_MODE=mock` |

Chạy với IVS thật ở local: đặt `IVS_MODE=aws` và các biến `AWS_*`, `IVS_RECORDING_CONFIGURATION_ARN` trong `.env`, rồi `docker compose up -d live-manager`.
