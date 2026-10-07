# web

React (Vite), phục vụ bằng nginx (cổng 80). Hash routes:

| Route | Trang |
|---|---|
| `#/` | Danh sách phiên đang live (`GET /api/lives`: tiêu đề, người bán, số người xem) |
| `#/live/<sessionId>` | Trang xem: IVS Player (playbackUrl lấy theo phiên), sản phẩm của phiên, nút Mua, chat theo phòng `sessionId`, sản phẩm ghim (timed metadata + socket) |
| `#/seller` | Kênh người bán (đăng nhập bằng token `lcs_…`): server/stream key, tải profile OBS, đặt lại key, mở/kết thúc phiên, ghim sản phẩm |
| `#/admin` | Quản trị: đăng ký người bán (tạo kênh IVS), token hiện một lần |

## Cấu hình runtime (biến môi trường của container)

| Biến | Ý nghĩa |
|---|---|
| `IVS_PLAYER_SDK_URL` | URL script IVS Player SDK (mặc định bản 1.57.0 trên CDN của AWS) |

Không còn `IVS_PLAYBACK_URL` cố định. Khi khởi động, `docker/40-runtime-config.sh` sinh `/config.js`, nên cùng một image chạy được cho dev và prod.

## Chạy dev

```bash
docker compose up -d      # ở thư mục gốc repo: chạy backend + Kong (cổng 8000)
cd web && npm install && npm run dev   # Vite proxy /api, /ws sang Kong
```
