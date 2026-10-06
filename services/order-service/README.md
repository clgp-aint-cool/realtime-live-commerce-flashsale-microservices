# order-service

Đặt hàng: Redis Lua trừ tồn kho nguyên tử, ghi đơn vào PostgreSQL. Cổng 3003.

- Endpoint kiểm tra sức khỏe: `GET /healthz` (Kubernetes dùng cho readiness/liveness probe)
- Cấu hình: biến môi trường (xem `.env.example` ở thư mục gốc repo)
- Image: `<HARBOR_REGISTRY>/live-commerce/order-service:<git-sha-8-ký-tự>`
