import { Injectable } from '@nestjs/common';
import { env } from './common/env';

const TIMEOUT_MS = 3000;

@Injectable()
export class ChatClient {
  private readonly baseUrl = env('CHAT_SERVICE_URL').replace(/\/$/, '');
  private readonly token = process.env.INTERNAL_API_TOKEN;

  async systemMessage(room: string, text: string, level: 'info' | 'alert'): Promise<void> {
    const res = await fetch(`${this.baseUrl}/internal/rooms/${encodeURIComponent(room)}/system-messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { 'x-internal-token': this.token } : {}),
      },
      body: JSON.stringify({ text, level }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`chat-service trả về ${res.status}`);
  }
}
