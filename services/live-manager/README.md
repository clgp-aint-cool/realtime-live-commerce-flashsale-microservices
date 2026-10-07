# live-manager

Người bán, kênh AWS IVS (một kênh + một stream key mỗi người bán), profile OBS, phiên live, tồn kho theo phiên, ghim sản phẩm (PutMetadata). Cổng 3005.

- `IVS_MODE=mock` chạy không cần AWS; `IVS_MODE=aws` cần IAM user theo `docs/iam-live-manager-policy.json`.
- Chi tiết API, bảo mật stream key, OBS, IAM, biến môi trường: [docs/live-manager.md](../../docs/live-manager.md)
- `GET /healthz`, `GET /readyz`
- Image: `<HARBOR_REGISTRY>/live-commerce/live-manager:<git-sha-8-ký-tự>`
