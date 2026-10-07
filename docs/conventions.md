# Quy ước làm việc

- Nhánh: `main` được bảo vệ, mọi thay đổi qua Pull Request.
- Commit: theo Conventional Commits (`feat:`, `fix:`, `chore:`...).
- Tag image: 8 ký tự đầu của commit SHA, **không dùng `latest`**.
- Mọi service dùng NestJS + TypeScript, Node 22. Mỗi service có Dockerfile riêng, cổng cố định: chat 3001, product 3002, order 3003, moderation 3004, web 80.
- Mọi service phải có `GET /healthz`.
- Không commit secret. Secret của Kubernetes được quản lý trong repo infra (Sealed Secrets).
