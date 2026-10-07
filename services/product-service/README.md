# product-service

Danh mục sản phẩm (PostgreSQL, tự seed 3 sản phẩm). Cổng 3002. Tồn kho bán trong phiên live do live-manager nạp vào Redis, không nằm ở đây.

- Cột `seller_id`: `NULL` = sản phẩm dùng chung, có giá trị = sản phẩm người bán tự thêm qua live-manager (`POST /internal/products`, cần `x-internal-token`, Kong không route).
- `GET /healthz` (liveness), `GET /readyz` (PostgreSQL)
- API và biến môi trường: [docs/local-testing.md](../../docs/local-testing.md)
- Image: `<HARBOR_REGISTRY>/live-commerce/product-service:<git-sha-8-ký-tự>`
