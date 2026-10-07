import { Injectable, Logger } from '@nestjs/common';

const TIMEOUT_MS = 3000;

// Tra phiên live đang mở của một kênh IVS => phòng chat cần cảnh báo (room = sessionId).
@Injectable()
export class LiveManagerClient {
  private readonly logger = new Logger(LiveManagerClient.name);
  private readonly baseUrl = process.env.LIVE_MANAGER_URL?.replace(/\/$/, '');
  private readonly token = process.env.INTERNAL_API_TOKEN;

  async openSessionId(channelArn: string): Promise<string | null> {
    if (!this.baseUrl || !channelArn) return null;
    try {
      const res = await fetch(
        `${this.baseUrl}/internal/channels/open-session?channelArn=${encodeURIComponent(channelArn)}`,
        { headers: this.token ? { 'x-internal-token': this.token } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`live-manager trả về ${res.status}`);
      return ((await res.json()) as { sessionId: string }).sessionId;
    } catch (err) {
      this.logger.warn(`Không tra được phiên của ${channelArn}: ${(err as Error).message}`);
      return null;
    }
  }
}
