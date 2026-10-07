# order-service

Đặt hàng trong phiên live. Cổng 3003.

1. Lua script (`src/live-stock.scripts.ts`) chạy nguyên tử trong Redis trên khóa `live:{sessionId}:...`: kiểm tra sản phẩm có bán trong phiên, user đã mua chưa, còn hàng không, rồi trừ kho và trả về `sellerId`.
2. Ghi đơn vào PostgreSQL kèm `session_id`, `seller_id` (`UNIQUE (session_id, product_id, user_id)`).
3. Nếu ghi DB lỗi: Lua hoàn kho (chỉ khi khóa kho của phiên vẫn còn).

- Người mua: có `Authorization: Bearer <jwt>` (do auth-service cấp, xác minh offline bằng `JWT_SECRET`) thì `userId` = `sub` của token. Không có token thì là khách (`ALLOW_GUEST_ORDERS`, mặc định `true`), `userId` dạng `usr_…` bị từ chối 403.
- Khóa Redis trong `src/common/live-keys.ts` phải giữ giống `live-manager/src/common/live-keys.ts`.
- `GET /healthz`, `GET /readyz`
- API và biến môi trường: [docs/local-testing.md](../../docs/local-testing.md)
- Image: `<HARBOR_REGISTRY>/live-commerce/order-service:<git-sha-8-ký-tự>`
