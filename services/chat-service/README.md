# chat-service

Chat real-time: Socket.io (path `/ws`, chỉ transport websocket nên không cần sticky session) + Redis adapter để phát tin xuyên pod. Lưu 50 tin gần nhất mỗi phòng trong Redis. Cổng 3001.

- `POST /internal/rooms/:room/system-messages` cho moderation-service (header `x-internal-token` nếu đặt `INTERNAL_API_TOKEN`)
- `GET /healthz`, `GET /readyz`
- Image: `<HARBOR_REGISTRY>/live-commerce/chat-service:<git-sha-8-ký-tự>`
