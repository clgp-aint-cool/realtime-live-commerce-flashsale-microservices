# Luồng CI/CD (GitOps với ArgoCD)

```
Dev ──PR──> live-commerce-app ──(ci.yml: lint, test, docker build)
                  │ merge vào main
                  ▼
        build-and-deploy.yml
          1. build image theo từng service thay đổi
          2. push lên Harbor, tag = 8 ký tự đầu của commit SHA
          3. sửa tag trong live-commerce-infra (overlay dev) rồi push
                  ▼
        live-commerce-infra (nguồn sự thật)
                  ▼
        ArgoCD phát hiện thay đổi -> sync vào cluster (dev tự động)
                  ▼
        Lên prod: chạy workflow "promote" bên repo infra
                  -> tạo Pull Request sao chép tag dev sang overlay prod
                  -> review + merge -> ArgoCD sync prod (thủ công)
```

## Biến và secret cần tạo trên GitHub (repo live-commerce-app)

| Tên | Loại | Ý nghĩa |
|---|---|---|
| `HARBOR_REGISTRY` | Variable | Địa chỉ Harbor, ví dụ `harbor.example.local` |
| `INFRA_REPO` | Variable | `<ORG>/live-commerce-infra` |
| `HARBOR_USERNAME` | Secret | Robot account của Harbor (quyền push) |
| `HARBOR_PASSWORD` | Secret | Mật khẩu/token của robot account |
| `INFRA_REPO_TOKEN` | Secret | Token có quyền ghi vào repo infra |

## Runner
Các workflow dùng `runs-on: [self-hosted, linux]` (GitHub runner tự host trong Internal Tools). Runner cần có Docker, Node, jq và truy cập được Harbor.
