# product-service

Sản phẩm và nạp tồn kho vào Redis khi mở phiên Flash Sale. Cổng 3002.

- Endpoint kiểm tra sức khỏe: `GET /healthz` (Kubernetes dùng cho readiness/liveness probe)
- Cấu hình: biến môi trường (xem `.env.example` ở thư mục gốc repo)
- Image: `<HARBOR_REGISTRY>/live-commerce/product-service:<git-sha-8-ký-tự>`
