import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { liveKeys } from './common/live-keys';
import { PgService } from './common/pg.service';
import { RedisService } from './common/redis.service';
import { RELEASE_LUA, RESERVE, RESERVE_LUA } from './live-stock.scripts';

// Bảng orders bản MVP cũ (theo sale_id) được đổi tên thay vì xóa, để không mất dữ liệu khi nâng cấp.
const MIGRATION = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'sale_id') THEN
    ALTER TABLE orders RENAME TO orders_flashsale_legacy;
    ALTER INDEX IF EXISTS orders_user_idx RENAME TO orders_flashsale_legacy_user_idx;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL,
  seller_id   UUID NOT NULL,
  product_id  INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  status      TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_session_product_user_key UNIQUE (session_id, product_id, user_id)
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders (seller_id, created_at DESC);
`;

type LiveStockRedis = RedisService & {
  reserve(stock: string, buyers: string, seller: string, userId: string, qty: number): Promise<[number, string]>;
  release(stock: string, buyers: string, userId: string, qty: number): Promise<number>;
};

interface OrderRow {
  id: string;
  session_id: string;
  seller_id: string;
  product_id: number;
  user_id: string;
  quantity: number;
  status: string;
  created_at: Date;
}

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);
  private readonly redis: LiveStockRedis;

  constructor(
    private readonly pg: PgService,
    redis: RedisService,
  ) {
    // defineCommand dùng EVALSHA, tự nạp lại script nếu Redis bị restart.
    redis.defineCommand('reserve', { numberOfKeys: 3, lua: RESERVE_LUA });
    redis.defineCommand('release', { numberOfKeys: 2, lua: RELEASE_LUA });
    this.redis = redis as LiveStockRedis;
  }

  async onModuleInit() {
    await this.pg.migrate(MIGRATION);
  }

  async create(sessionId: string, productId: number, userId: string, quantity: number) {
    const stock = liveKeys.stock(sessionId, productId);
    const buyers = liveKeys.buyers(sessionId, productId);
    const [code, sellerId] = await this.redis.reserve(stock, buyers, liveKeys.seller(sessionId), userId, quantity);

    if (code === RESERVE.NOT_ACTIVE) throw new NotFoundException('Sản phẩm không được bán trong phiên live này (hoặc phiên đã kết thúc)');
    if (code === RESERVE.ALREADY_BOUGHT) throw new ConflictException({ code: 'ALREADY_BOUGHT', message: 'Bạn đã mua sản phẩm này trong phiên live' });
    if (code === RESERVE.SOLD_OUT) throw new ConflictException({ code: 'SOLD_OUT', message: 'Hết hàng' });

    try {
      const { rows } = await this.pg.query<OrderRow>(
        `INSERT INTO orders (session_id, seller_id, product_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [sessionId, sellerId, productId, userId, quantity],
      );
      return this.toDto(rows[0]);
    } catch (err) {
      // Redis đã trừ kho nhưng DB lỗi: trả lại tồn kho để không "mất" hàng.
      this.logger.error(`Ghi đơn thất bại, hoàn tồn kho: ${(err as Error).message}`);
      await this.redis
        .release(stock, buyers, userId, quantity)
        .catch((e: Error) => this.logger.error(`Hoàn tồn kho thất bại: ${e.message}`));
      throw new InternalServerErrorException('Không ghi được đơn hàng, vui lòng thử lại');
    }
  }

  async listByUser(userId: string) {
    const { rows } = await this.pg.query<OrderRow>(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId],
    );
    return rows.map((r) => this.toDto(r));
  }

  // Dùng để kiểm chứng test tải: số đơn trong DB phải bằng đúng tồn kho ban đầu của phiên.
  async stats(sessionId: string, productId?: number) {
    const params: unknown[] = [sessionId];
    let where = 'session_id = $1';
    if (productId !== undefined) {
      params.push(productId);
      where += ' AND product_id = $2';
    }
    const { rows } = await this.pg.query<{ orders: string; quantity: string | null }>(
      `SELECT count(*) AS orders, sum(quantity) AS quantity FROM orders WHERE ${where}`,
      params,
    );
    return { sessionId, productId: productId ?? null, orders: Number(rows[0].orders), quantity: Number(rows[0].quantity ?? 0) };
  }

  private toDto(r: OrderRow) {
    return {
      id: Number(r.id),
      sessionId: r.session_id,
      sellerId: r.seller_id,
      productId: r.product_id,
      userId: r.user_id,
      quantity: r.quantity,
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
