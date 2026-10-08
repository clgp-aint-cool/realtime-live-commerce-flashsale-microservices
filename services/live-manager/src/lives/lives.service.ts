import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProductClient } from '../common/clients';
import { liveKeys } from '../common/live-keys';
import { PgService } from '../common/pg.service';
import { RedisService } from '../common/redis.service';
import { isDemoChannel, IvsGateway, StreamInfo } from '../ivs/ivs.gateway';

interface LiveRow {
  id: string;
  title: string;
  seller_id: string;
  seller_name: string;
  channel_arn: string;
  playback_url: string;
  pinned_product_id: number | null;
  started_at: Date;
  status: 'OPEN' | 'ENDED';
}

const LIVE_SELECT = `
  SELECT s.id, s.title, s.status, s.pinned_product_id, s.started_at,
         se.id AS seller_id, se.name AS seller_name, se.channel_arn, se.playback_url
  FROM live_sessions s JOIN sellers se ON se.id = s.seller_id`;

// Thông tin công khai cho người xem: KHÔNG có stream key, ingest endpoint hay channel ARN.
@Injectable()
export class LivesService {
  private readonly logger = new Logger(LivesService.name);
  private streamsCache: { at: number; byArn: Map<string, StreamInfo> } | null = null;
  // ListStreams có giới hạn TPS và trả về toàn bộ stream của region: cache ngắn, dùng chung mọi request.
  private readonly streamsTtlMs = Number(process.env.IVS_STREAMS_CACHE_MS ?? 5000);
  private inflight: Promise<Map<string, StreamInfo>> | null = null;

  constructor(
    private readonly pg: PgService,
    private readonly redis: RedisService,
    private readonly ivs: IvsGateway,
    private readonly products: ProductClient,
  ) {}

  async list() {
    const { rows } = await this.pg.query<LiveRow>(`${LIVE_SELECT} WHERE s.status = 'OPEN' ORDER BY s.started_at DESC LIMIT 100`);
    const streams = await this.streams();
    return rows.map((r) => this.summary(r, streams.get(r.channel_arn)));
  }

  async detail(sessionId: string) {
    const { rows } = await this.pg.query<LiveRow>(`${LIVE_SELECT} WHERE s.id = $1`, [sessionId]);
    if (rows.length === 0) throw new NotFoundException('Không có phiên live này');
    const row = rows[0];
    const [streams, items] = await Promise.all([
      this.streams(),
      this.pg.query<{ product_id: number; initial_stock: number }>(
        'SELECT product_id, initial_stock FROM session_products WHERE session_id = $1 ORDER BY position',
        [sessionId],
      ),
    ]);
    const catalog = await this.products.catalog(items.rows.map((i) => i.product_id));
    const stocks = items.rows.length
      ? await this.redis.mget(...items.rows.map((i) => liveKeys.stock(sessionId, i.product_id)))
      : [];
    return {
      ...this.summary(row, streams.get(row.channel_arn)),
      status: row.status,
      pinnedProductId: row.pinned_product_id,
      products: items.rows.map((i, idx) => ({
        ...(catalog.get(i.product_id) ?? { id: i.product_id, name: `Sản phẩm ${i.product_id}` }),
        initialStock: i.initial_stock,
        stock: stocks[idx] === null ? 0 : Number(stocks[idx]),
      })),
    };
  }

  // Dùng nội bộ: moderation-service tra phiên đang mở theo channel ARN để báo vào đúng phòng chat.
  async openSessionByChannel(channelArn: string) {
    const { rows } = await this.pg.query<LiveRow>(
      `${LIVE_SELECT} WHERE se.channel_arn = $1 AND s.status = 'OPEN'`,
      [channelArn],
    );
    if (rows.length === 0) throw new NotFoundException('Kênh không có phiên đang mở');
    return { sessionId: rows[0].id, sellerId: rows[0].seller_id };
  }

  private summary(r: LiveRow, stream: StreamInfo | undefined) {
    if (isDemoChannel(r.channel_arn)) stream = { channelArn: r.channel_arn, state: 'LIVE', viewerCount: 0 };
    return {
      sessionId: r.id,
      title: r.title,
      seller: { id: r.seller_id, name: r.seller_name },
      playbackUrl: r.playback_url,
      streamState: stream?.state ?? 'OFFLINE',
      viewerCount: stream?.viewerCount ?? 0,
      startedAt: r.started_at,
    };
  }

  private async streams(): Promise<Map<string, StreamInfo>> {
    if (this.streamsCache && Date.now() - this.streamsCache.at < this.streamsTtlMs) return this.streamsCache.byArn;
    this.inflight ??= this.ivs
      .listLiveStreams()
      .then((list) => {
        const byArn = new Map(list.map((s) => [s.channelArn, s]));
        this.streamsCache = { at: Date.now(), byArn };
        return byArn;
      })
      .catch((err: Error) => {
        // IVS lỗi không được làm sập trang danh sách: dùng dữ liệu cũ (hoặc rỗng).
        this.logger.warn(`ListStreams lỗi: ${err.message}`);
        return this.streamsCache?.byArn ?? new Map<string, StreamInfo>();
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
