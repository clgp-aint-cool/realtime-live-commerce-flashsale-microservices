# Lối tắt cho docker compose. Xem docs/local-testing.md.
.PHONY: up down reset logs ps test loadtest infra

up:          ## Build và chạy toàn bộ app: http://localhost:8000
	docker compose up -d --build

down:        ## Dừng app (giữ dữ liệu PostgreSQL)
	docker compose down

reset:       ## Dừng và xóa cả dữ liệu
	docker compose down -v

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

test:        ## Test end-to-end: 66 kiểm tra (người bán, phiên live, đơn, chat 2 pod, ghim, moderation)
	docker compose --profile test run --rm --build e2e

loadtest:    ## k6: tạo phiên live, 5.000 request tranh 100 sản phẩm
	docker compose --profile loadtest run --rm k6

infra:       ## Chỉ chạy PostgreSQL + Redis để dev service bằng `npm run dev`
	docker compose up -d postgres redis
