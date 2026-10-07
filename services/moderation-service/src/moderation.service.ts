import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChatClient } from './chat.client';
import { PgService } from './common/pg.service';
import { LiveManagerClient } from './live-manager.client';
import { ModerationEvent } from './moderation.types';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS moderation_events (
  event_id      TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  action        TEXT NOT NULL,
  channel_arn   TEXT NOT NULL,
  labels        JSONB NOT NULL,
  thumbnail_url TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS moderation_events_received_idx ON moderation_events (received_at DESC);
`;

export type HandleResult = 'notified' | 'duplicate' | 'notify_failed';

@Injectable()
export class ModerationService implements OnModuleInit {
  private readonly logger = new Logger(ModerationService.name);
  private readonly defaultRoom = process.env.CHAT_ROOM ?? 'main';

  constructor(
    private readonly pg: PgService,
    private readonly chat: ChatClient,
    private readonly liveManager: LiveManagerClient,
  ) {}

  async onModuleInit() {
    await this.pg.migrate(MIGRATION);
  }

  // Idempotent theo eventId: lưu sự kiện, chỉ thông báo vào chat nếu chưa thông báo thành công.
  // Nếu gọi chat lỗi thì trả notify_failed để Lambda retry; lần retry sẽ thông báo lại.
  async handle(event: ModerationEvent): Promise<HandleResult> {
    await this.pg.query(
      `INSERT INTO moderation_events (event_id, type, action, channel_arn, labels, thumbnail_url, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.type, event.action, event.channelArn, JSON.stringify(event.labels), event.thumbnailUrl, event.occurredAt],
    );
    this.logger.warn(
      `Moderation event ${event.eventId}: ${event.type}/${event.action} labels=${event.labels.map((l) => l.name).join(',')}`,
    );

    // Chỉ một request "giành" được quyền thông báo (tránh hai lần retry đồng thời cùng gửi).
    const claimed = await this.pg.query(
      'UPDATE moderation_events SET notified = true WHERE event_id = $1 AND notified = false RETURNING event_id',
      [event.eventId],
    );
    if (claimed.rowCount === 0) return 'duplicate';

    try {
      // Ưu tiên room trong payload, sau đó phiên đang mở của kênh, cuối cùng là phòng mặc định.
      const room = event.room ?? (await this.liveManager.openSessionId(event.channelArn)) ?? this.defaultRoom;
      await this.chat.systemMessage(room, this.describe(event), 'alert');
      return 'notified';
    } catch (err) {
      this.logger.error(`Không thông báo được vào chat: ${(err as Error).message}`);
      await this.pg.query('UPDATE moderation_events SET notified = false WHERE event_id = $1', [event.eventId]);
      return 'notify_failed';
    }
  }

  async recent(limit = 50) {
    const { rows } = await this.pg.query(
      'SELECT * FROM moderation_events ORDER BY received_at DESC LIMIT $1',
      [limit],
    );
    return rows;
  }

  private describe(event: ModerationEvent): string {
    const labels = event.labels.map((l) => `${l.name} (${l.confidence.toFixed(0)}%)`).join(', ');
    const action =
      event.action === 'STREAM_STOPPED'
        ? 'Buổi live đã bị tạm dừng'
        : 'Hệ thống đã ghi nhận cảnh báo';
    return `⚠️ ${action} do phát hiện nội dung hình ảnh không phù hợp${labels ? `: ${labels}` : ''}.`;
  }
}
