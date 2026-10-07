import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { createRedis } from './common/redis';

// Redis adapter: tin nhắn emit ở pod này được phát qua Redis pub/sub tới mọi pod khác,
// nên người xem ở pod A thấy tin nhắn của người xem ở pod B.
export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pub = createRedis();
    const sub = pub.duplicate();
    this.clients = [pub, sub];
    await Promise.all([pub.ping(), sub.ping()]);
    this.adapterConstructor = createAdapter(pub, sub);
    this.redisLogger.log('Đã kết nối Redis adapter');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async dispose(): Promise<void> {
    await super.dispose();
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
