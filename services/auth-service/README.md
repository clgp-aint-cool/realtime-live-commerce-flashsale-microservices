# auth-service

Tài khoản người mua: đăng ký, đăng nhập, xác thực token. Port `3006`, Kong route `/api/auth`.

## API

| Method | Path | Body / Header | Kết quả |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `{username, password, displayName?}` | `201 {token, user}` · `409` trùng username |
| POST | `/api/auth/login` | `{username, password}` | `200 {token, user}` · `401` sai · `429` quá nhiều lần sai |
| GET | `/api/auth/me` | `Authorization: Bearer <token>` | `200 user` · `401` token hỏng/hết hạn/user đã bị xóa |
| GET | `/healthz`, `/readyz` | | liveness / kiểm tra PostgreSQL |

- `username`: 3-32 ký tự `[a-z0-9_.]` (tự chuyển chữ thường). `password`: 8-128 ký tự. `displayName`: 2-32 ký tự, mặc định = username.
- `user = {id, username, displayName, createdAt}`, `id` dạng `usr_<uuid>`.

## Thiết kế

- Mật khẩu băm **scrypt** (`scrypt$N$r$p$salt$hash`), so sánh `timingSafeEqual`; username không tồn tại vẫn chạy scrypt với hash giả để không lộ qua thời gian phản hồi.
- Token là **JWT HS256** tự ký bằng `node:crypto`, hạn 7 ngày, claims `{sub, name, iat, exp}`. order-service dùng chung `JWT_SECRET` để xác minh token offline, không cần gọi sang auth-service.
- Chống dò mật khẩu: tối đa 10 lần sai / 15 phút / username. Bộ đếm nằm trong bộ nhớ **mỗi pod**, khi scale nhiều replica nên chuyển sang Redis.
- Bảng `users` tự migrate khi khởi động, dùng advisory lock `742006`.

## Env

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | PostgreSQL dùng chung |
| `JWT_SECRET` | ✓ | ≥ 32 ký tự, phải giống order-service. Tạo bằng `openssl rand -hex 32`. Trên K8s để trong Sealed Secret |
| `PORT` | | mặc định `3006` |
