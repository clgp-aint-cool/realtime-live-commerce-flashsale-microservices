import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createRedis } from './common/redis';
import { ChatMessage, MessageLevel, MessageType } from './chat.types';

const HISTORY_SIZE = 50;
const historyKey = (room: string) => `chat:{${room}}:history`;

// Lưu 50 tin nhắn gần nhất của mỗi phòng trong Redis để người mới vào thấy ngữ cảnh.
@Injectable()
export class ChatStore implements OnModuleDestroy {
  private readonly redis = createRedis();

  build(room: string, type: MessageType, level: MessageLevel, username: string, text: string): ChatMessage {
    return { id: randomUUID(), room, type, level, username, text, ts: Date.now() };
  }

  async save(msg: ChatMessage): Promise<void> {
    await this.redis
      .multi()
      .lpush(historyKey(msg.room), JSON.stringify(msg))
      .ltrim(historyKey(msg.room), 0, HISTORY_SIZE - 1)
      .exec();
  }

  async history(room: string): Promise<ChatMessage[]> {
    const items = await this.redis.lrange(historyKey(room), 0, HISTORY_SIZE - 1);
    return items.map((i) => JSON.parse(i) as ChatMessage).reverse();
  }

  ping() {
    return this.redis.ping();
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
