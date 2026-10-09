import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectStorage } from '../common/object-storage';
import { PgService } from '../common/pg.service';
import { ingestServer, IvsGateway } from '../ivs/ivs.gateway';
import { SellerRow } from '../schema';
import { buildObsProfileZip } from './obs-profile';
import { hashToken, newSellerToken } from './tokens';

const isNotFound = (err: unknown) => (err as Error)?.name === 'ResourceNotFoundException';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly pg: PgService,
    private readonly ivs: IvsGateway,
    private readonly storage: ObjectStorage,
  ) {}

  // Đăng ký người bán: tạo kênh IVS riêng (gắn recording configuration dùng chung), lưu ARN/endpoint/playback URL.
  // Token đăng nhập chỉ trả về MỘT lần ở đây.
  async register(name: string) {
    const id = randomUUID();
    const channel = await this.ivs.createChannel(`lc-seller-${id}`, { app: 'live-commerce', sellerId: id });
    const token = newSellerToken();
    try {
      await this.pg.query(
        `INSERT INTO sellers (id, name, token_hash, channel_arn, ingest_endpoint, playback_url, stream_key_arn)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, name, hashToken(token), channel.channelArn, channel.ingestEndpoint, channel.playbackUrl, channel.streamKeyArn],
      );
    } catch (err) {
      // Không để lại kênh IVS "mồ côi" (vẫn tính phí khi có người stream vào).
      await this.ivs.deleteChannel(channel.channelArn).catch((e: Error) =>
        this.logger.error(`Không xóa được kênh ${channel.channelArn}: ${e.message}`),
      );
      throw err;
    }
    this.logger.log(`Đăng ký người bán ${id} (${name}), kênh ${channel.channelArn}`);
    const { rows } = await this.pg.query<SellerRow>('SELECT * FROM sellers WHERE id = $1', [id]);
    return { seller: await this.profile(rows[0]), token };
  }

  async profile(seller: SellerRow) {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id FROM live_sessions WHERE seller_id = $1 AND status = 'OPEN'`,
      [seller.id],
    );
    return {
      id: seller.id,
      name: seller.name,
      avatarUrl: seller.avatar_url,
      channelArn: seller.channel_arn,
      ingestServer: ingestServer(seller.ingest_endpoint),
      playbackUrl: seller.playback_url,
      hasStreamKey: seller.stream_key_arn !== null,
      currentSessionId: rows[0]?.id ?? null,
      ivsMode: this.ivs.mode,
    };
  }

  // Thư mục trên S3 của từng người bán: client không tự chọn được đường dẫn.
  static readonly avatarPrefix = (sellerId: string) => `avatars/sellers/${sellerId}`;
  static readonly productPrefix = (sellerId: string) => `products/${sellerId}`;

  uploadImage(seller: SellerRow, kind: unknown, contentType: unknown, size: unknown) {
    if (kind !== 'avatar' && kind !== 'product') throw new BadRequestException('kind phải là avatar hoặc product');
    const prefix = kind === 'avatar' ? SellersService.avatarPrefix(seller.id) : SellersService.productPrefix(seller.id);
    return this.storage.presignImage(prefix, contentType, size);
  }

  // Gán avatar sau khi trình duyệt đã PUT xong lên S3. null = bỏ avatar. Ảnh cũ bị xóa khỏi bucket.
  async setAvatar(seller: SellerRow, url: unknown) {
    const prefix = SellersService.avatarPrefix(seller.id);
    if (url !== null && (typeof url !== 'string' || !this.storage.owns(url, prefix))) {
      throw new BadRequestException('avatarUrl phải là ảnh vừa upload qua /api/sellers/me/uploads');
    }
    const { rows } = await this.pg.query<SellerRow>(
      `UPDATE sellers SET avatar_url = $2 WHERE id = $1 RETURNING *`,
      [seller.id, url],
    );
    if (seller.avatar_url && seller.avatar_url !== url) await this.storage.remove(seller.avatar_url, prefix);
    return this.profile(rows[0]);
  }

  async streamKey(seller: SellerRow): Promise<string> {
    if (!seller.stream_key_arn) throw new ConflictException('Chưa có stream key, hãy bấm "Đặt lại key"');
    return this.ivs.getStreamKeyValue(seller.stream_key_arn);
  }

  // Đặt lại key: dừng stream đang dùng key cũ, xóa key cũ, tạo key mới.
  // Khóa dòng seller (FOR UPDATE) để hai lần bấm đồng thời không tạo hai key.
  async resetStreamKey(seller: SellerRow): Promise<string> {
    const client = await this.pg.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<SellerRow>('SELECT * FROM sellers WHERE id = $1 FOR UPDATE', [seller.id]);
      const current = rows[0];

      await this.ivs.stopStream(current.channel_arn);
      if (current.stream_key_arn) {
        await this.ivs.deleteStreamKey(current.stream_key_arn).catch((err) => {
          if (!isNotFound(err)) throw err;
        });
        // Key cũ đã bị xóa trên IVS: ghi nhận ngay để nếu tạo key mới lỗi thì người bán bấm lại được.
        await client.query('UPDATE sellers SET stream_key_arn = NULL WHERE id = $1', [seller.id]);
      }

      let newArn: string;
      try {
        newArn = await this.ivs.createStreamKey(current.channel_arn);
      } catch (err) {
        await client.query('COMMIT');
        this.logger.error(`CreateStreamKey lỗi cho seller ${seller.id}: ${(err as Error).message}`);
        throw new BadGatewayException('Đã xóa key cũ nhưng chưa tạo được key mới, vui lòng bấm lại');
      }
      await client.query('UPDATE sellers SET stream_key_arn = $2 WHERE id = $1', [seller.id, newArn]);
      await client.query('COMMIT');
      this.logger.log(`Seller ${seller.id} đã đặt lại stream key`);
      return this.ivs.getStreamKeyValue(newArn);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async obsProfile(seller: SellerRow) {
    return buildObsProfileZip(seller.name, seller.ingest_endpoint, await this.streamKey(seller));
  }
}
