# realtime-live-commerce-flashsale-microservices

> Livestream bán hàng: AWS IVS + OBS, chat realtime (Socket.io + Redis), flash sale trừ kho nguyên tử (Redis Lua), kiểm duyệt AI, microservices NestJS + React, Kong gateway.

Repo mã nguồn cho team dev của dự án Interactive Live Commerce. Dev chỉ push code vào repo này; việc triển khai do repo `live-commerce-hybrid-k8s-gitops-observability-dr` và ArgoCD đảm nhiệm.

## Cấu trúc

```
realtime-live-commerce-flashsale-microservices/
├─ services/                 # NestJS 11 + TypeScript, Node 22
│  ├─ chat-service/          # Socket.io + Redis adapter            (cổng 3001)
│  ├─ product-service/       # danh mục sản phẩm                    (cổng 3002)
│  ├─ order-service/         # Redis Lua trừ kho theo phiên + PostgreSQL (cổng 3003)
│  ├─ moderation-service/    # nhận webhook từ AWS, báo vào chat    (cổng 3004)
│  ├─ live-manager/          # người bán, kênh IVS, stream key, profile OBS, phiên live, ghim, sản phẩm của shop (cổng 3005)
│  └─ auth-service/          # tài khoản người mua: đăng ký, đăng nhập, JWT (cổng 3006)
├─ web/                      # React + Vite: danh sách live, trang xem, đăng nhập, đơn hàng, trang người bán, admin (nginx, cổng 80)
├─ deploy/kong/kong.yml      # route Kong cho compose, giống kong-routes.yaml trên K8s
├─ tests/e2e/                # test end-to-end (Node + socket.io-client)
├─ tests/k6/                 # test tải mua hàng trong phiên live
├─ docs/                     # luồng CI/CD, quy ước, test cục bộ
├─ docker-compose.yml        # chạy full app + Kong + test
└─ .env.example
```

## Chạy toàn bộ app cục bộ

```bash
cp .env.example .env          # tùy chọn: mặc định đã chạy được
make up                       # = docker compose up -d --build
open http://localhost:8000    # danh sách phiên live; #/login tài khoản người mua, #/orders đơn hàng, #/admin đăng ký người bán, #/seller trang người bán
make test                     # e2e: 88 kiểm tra (tạo người bán mới: với IVS_MODE=aws là kênh IVS thật)
make loadtest                 # k6: 5.000 request, tồn kho 100 => đúng 100 đơn
```

Người bán, OBS, IVS, IAM: [docs/live-manager.md](docs/live-manager.md). Quản lý phiên live và chuyển phiên (playbackUrl theo phiên): [docs/live-sessions.md](docs/live-sessions.md).
Chi tiết (kiến trúc compose, API, hợp đồng webhook, checklist trước khi lên K8s): [docs/local-testing.md](docs/local-testing.md).

## Dev một service

```bash
make infra                                   # chỉ PostgreSQL + Redis
cd services/order-service && npm install && npm run dev   # đọc ../../.env
cd web && npm install && npm run dev         # Vite proxy /api, /ws sang Kong :8000
```

## Luồng triển khai

Xem [docs/ci-cd-flow.md](docs/ci-cd-flow.md). Tóm tắt: PR chạy `ci.yml`; merge vào `main` thì `build-and-deploy.yml` build image, đẩy lên Harbor và cập nhật tag trong repo infra cho môi trường dev; ArgoCD tự sync.
