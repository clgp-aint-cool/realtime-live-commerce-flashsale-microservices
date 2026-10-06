# moderation-service

Nhận webhook cảnh báo từ AWS, ghi log, thông báo vào phòng chat. Cổng 3004.

- Endpoint kiểm tra sức khỏe: `GET /healthz` (Kubernetes dùng cho readiness/liveness probe)
- Cấu hình: biến môi trường (xem `.env.example` ở thư mục gốc repo)
- Image: `<HARBOR_REGISTRY>/live-commerce/moderation-service:<git-sha-8-ký-tự>`
