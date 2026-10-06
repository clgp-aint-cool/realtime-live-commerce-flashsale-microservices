# chat-service

Chat real-time (Socket.io + Redis adapter). Gốc: micro-live-chat của nelsonwenner/stream-live-system. Cổng 3001.

- Endpoint kiểm tra sức khỏe: `GET /healthz` (Kubernetes dùng cho readiness/liveness probe)
- Cấu hình: biến môi trường (xem `.env.example` ở thư mục gốc repo)
- Image: `<HARBOR_REGISTRY>/live-commerce/chat-service:<git-sha-8-ký-tự>`
