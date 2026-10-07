import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatClient, ProductClient } from '../common/clients';
import { liveKeys } from '../common/live-keys';
import { PgService } from '../common/pg.service';
import { RedisService } from '../common/redis.service';
import { IvsGateway, PutMetadataResult } from '../ivs/ivs.gateway';
import { SellerRow, SessionRow } from '../schema';

export interface SessionProductInput {
  productId: number;
  stock: number;
}

// Giới hạn của IVS PutMetadata: payload tối đa 1 KB, 5 lần/giây mỗi kênh.
const METADATA_MAX_BYTES = 1024;
const METADATA_MIN_INTERVAL_MS = 200;

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly pg: PgService,
    private readonly redis: RedisService,
    private readonly ivs: IvsGateway,
    private readonly products: ProductClient,
    private readonly chat: ChatClient,
  ) {}

  async create(seller: SellerRow, title: string, items: SessionProductInput[]) {
    const catalog = await this.products.catalog(items.map((i) => i.productId));
    const missing = items.filter((i) => !catalog.has(i.productId)).map((i) => i.productId);
    if (missing.length) throw new BadRequestException(`Sản phẩm không tồn tại: ${missing.join(', ')}`);
    // Chỉ bán được sản phẩm dùng chung hoặc sản phẩm của chính mình.
    const foreign = items.filter((i) => ![null, seller.id].includes(catalog.get(i.productId)!.sellerId)).map((i) => i.productId);
    if (foreign.length) throw new BadRequestException(`Sản phẩm của người bán khác: ${foreign.join(', ')}`);

    const id = randomUUID();
    const client = await this.pg.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO live_sessions (id, seller_id, title) VALUES ($1, $2, $3)', [id, seller.id, title]);
      for (const [position, item] of items.entries()) {
        await client.query(
          'INSERT INTO session_products (session_id, product_id, initial_stock, position) VALUES ($1, $2, $3, $4)',
          [id, item.productId, item.stock, position],
        );
      }
      // Nạp tồn kho vào Redis trước khi commit: phiên chỉ hiện ra khi kho đã sẵn sàng.
      const multi = this.redis.multi().set(liveKeys.seller(id), seller.id);
      for (const item of items) {
        multi.set(liveKeys.stock(id, item.productId), item.stock).set(liveKeys.initial(id, item.productId), item.stock);
      }
      await multi.exec();
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.clearStock(id, items.map((i) => i.productId)).catch(() => undefined);
      if (isUniqueViolation(err)) throw new ConflictException('Bạn đang có một phiên live chưa kết thúc');
      throw err;
    } finally {
      client.release();
    }
    this.logger.log(`Seller ${seller.id} mở phiên ${id}: ${items.length} sản phẩm`);
    return this.ownSession(seller, id);
  }

  async end(seller: SellerRow, sessionId: string) {
    const { rows } = await this.pg.query<SessionRow>(
      `UPDATE live_sessions SET status = 'ENDED', ended_at = now()
       WHERE id = $1 AND seller_id = $2 AND status = 'OPEN' RETURNING *`,
      [sessionId, seller.id],
    );
    if (rows.length === 0) throw new NotFoundException('Không có phiên đang mở này');
    // Xóa kho trong Redis => order-service từ chối mọi đơn mới của phiên.
    await this.clearStock(sessionId, await this.productIds(sessionId));
    await this.chat.emit(sessionId, 'session_ended', { sessionId });
    return { sessionId, status: 'ENDED' };
  }

  // Ghim sản phẩm: gửi timed metadata qua IVS (đồng bộ với hình) và đẩy qua socket (cho người mới vào / khi
  // kênh chưa phát). Lưu lại trong DB để trang xem live biết sản phẩm đang ghim.
  async pin(seller: SellerRow, sessionId: string, productId: number | null) {
    const session = await this.openSession(seller, sessionId);
    if (productId !== null && !(await this.productIds(sessionId)).includes(productId)) {
      throw new BadRequestException('Sản phẩm không thuộc phiên live này');
    }

    // Giới hạn 5 lần/giây/kênh: tối thiểu 200 ms giữa hai lần ghim (dùng chung cho mọi replica qua Redis).
    const allowed = await this.redis.set(`ratelimit:metadata:${seller.channel_arn}`, '1', 'PX', METADATA_MIN_INTERVAL_MS, 'NX');
    if (!allowed) throw new HttpException('Ghim quá nhanh (tối đa 5 lần/giây)', HttpStatus.TOO_MANY_REQUESTS);

    const payload = JSON.stringify({ type: 'pin', sessionId, productId, ts: Date.now() });
    if (Buffer.byteLength(payload) > METADATA_MAX_BYTES) throw new BadRequestException('Metadata vượt 1 KB');

    await this.pg.query('UPDATE live_sessions SET pinned_product_id = $2 WHERE id = $1', [session.id, productId]);
    let metadata: PutMetadataResult | 'error';
    try {
      metadata = await this.ivs.putMetadata(seller.channel_arn, payload);
    } catch {
      metadata = 'error';
    }
    const socket = await this.chat.emit(sessionId, 'pin', { sessionId, productId });
    return { sessionId, pinnedProductId: productId, metadata, socket };
  }

  async ownSession(seller: SellerRow, sessionId: string) {
    const { rows } = await this.pg.query<SessionRow>('SELECT * FROM live_sessions WHERE id = $1 AND seller_id = $2', [
      sessionId,
      seller.id,
    ]);
    if (rows.length === 0) throw new NotFoundException('Không có phiên này');
    const s = rows[0];
    return { sessionId: s.id, title: s.title, status: s.status, pinnedProductId: s.pinned_product_id, startedAt: s.started_at };
  }

  private async openSession(seller: SellerRow, sessionId: string): Promise<SessionRow> {
    const { rows } = await this.pg.query<SessionRow>(
      `SELECT * FROM live_sessions WHERE id = $1 AND seller_id = $2 AND status = 'OPEN'`,
      [sessionId, seller.id],
    );
    if (rows.length === 0) throw new NotFoundException('Không có phiên đang mở này');
    return rows[0];
  }

  private async productIds(sessionId: string): Promise<number[]> {
    const { rows } = await this.pg.query<{ product_id: number }>(
      'SELECT product_id FROM session_products WHERE session_id = $1',
      [sessionId],
    );
    return rows.map((r) => r.product_id);
  }

  private async clearStock(sessionId: string, productIds: number[]) {
    const keys = [liveKeys.seller(sessionId)];
    for (const p of productIds) keys.push(liveKeys.stock(sessionId, p), liveKeys.initial(sessionId, p), liveKeys.buyers(sessionId, p));
    await this.redis.del(...keys);
  }
}
