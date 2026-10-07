# moderation-service

Nhận webhook cảnh báo moderation hình ảnh từ Lambda bridge trên AWS (qua VPN → Palo Alto → NodePort), ghi log vào PostgreSQL, thông báo vào phòng chat. Idempotent theo `eventId`. Cổng 3004.

- Hợp đồng webhook: [docs/local-testing.md](../../docs/local-testing.md#5-hợp-đồng-webhook-moderation-lambda-bridge--moderation-service)
- `GET /healthz`, `GET /readyz`
- Image: `<HARBOR_REGISTRY>/live-commerce/moderation-service:<git-sha-8-ký-tự>`
