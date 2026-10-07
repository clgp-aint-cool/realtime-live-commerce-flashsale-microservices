// Hợp đồng webhook giữa Lambda bridge (AWS) và moderation-service (CMC).
export interface ModerationLabel {
  name: string;
  confidence: number;
}

export interface ModerationEvent {
  eventId: string; // id duy nhất, dùng để chống xử lý trùng khi Lambda gửi lại
  type: string; // ví dụ IMAGE_VIOLATION
  action: string; // ví dụ STREAM_STOPPED
  channelArn: string;
  labels: ModerationLabel[];
  thumbnailUrl: string;
  occurredAt: string; // ISO-8601
  room?: string; // phòng chat cần thông báo; mặc định là phiên đang mở của channelArn, rồi tới CHAT_ROOM
}

const EVENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function parseEvent(body: unknown): ModerationEvent | string {
  if (typeof body !== 'object' || body === null) return 'Body phải là JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.eventId !== 'string' || !EVENT_ID.test(b.eventId)) return 'eventId không hợp lệ';
  if (typeof b.type !== 'string' || !b.type) return 'Thiếu type';
  const occurredAt = typeof b.occurredAt === 'string' ? new Date(b.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return 'occurredAt không phải ISO-8601';
  const labels = Array.isArray(b.labels)
    ? b.labels
        .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
        .map((l) => ({ name: String(l.name ?? ''), confidence: Number(l.confidence ?? 0) }))
        .filter((l) => l.name)
    : [];
  return {
    eventId: b.eventId,
    type: b.type.slice(0, 64),
    action: typeof b.action === 'string' ? b.action.slice(0, 64) : 'NONE',
    channelArn: typeof b.channelArn === 'string' ? b.channelArn.slice(0, 256) : '',
    labels,
    thumbnailUrl: typeof b.thumbnailUrl === 'string' ? b.thumbnailUrl.slice(0, 1024) : '',
    occurredAt: occurredAt.toISOString(),
    room: typeof b.room === 'string' ? b.room : undefined,
  };
}
