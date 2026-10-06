# live-commerce-app

Repo mã nguồn cho team dev của dự án Interactive Live Commerce. Dev chỉ push code vào repo này; việc triển khai do repo `live-commerce-infra` và ArgoCD đảm nhiệm.

## Cấu trúc

```
live-commerce-app/
├─ services/
│  ├─ chat-service/        # Socket.io + Redis adapter        (cổng 3001)
│  ├─ product-service/     # sản phẩm, nạp tồn kho vào Redis  (cổng 3002)
│  ├─ order-service/       # Redis Lua + PostgreSQL           (cổng 3003)
│  └─ moderation-service/  # nhận webhook từ AWS              (cổng 3004)
├─ web/                    # React: IVS Player + chat + nút Mua
├─ docs/                   # luồng CI/CD, quy ước
├─ .github/workflows/      # ci.yml, build-and-deploy.yml
├─ docker-compose.yml      # Redis + PostgreSQL cho dev cục bộ
└─ .env.example
```

Mỗi service hiện là bản placeholder (HTTP server nhỏ có `/healthz`) để pipeline và Kubernetes chạy được ngay. Thay bằng code NestJS/React thật khi có.

## Chạy cục bộ

```bash
cp .env.example .env
docker compose up -d          # Redis + PostgreSQL
cd services/chat-service && npm start
```

## Luồng triển khai

Xem [docs/ci-cd-flow.md](docs/ci-cd-flow.md). Tóm tắt: PR chạy `ci.yml`; merge vào `main` thì `build-and-deploy.yml` build image, đẩy lên Harbor và cập nhật tag trong repo infra cho môi trường dev; ArgoCD tự sync.
