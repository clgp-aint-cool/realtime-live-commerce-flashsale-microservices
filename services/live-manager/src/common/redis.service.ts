import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from './env';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env('REDIS_URL'), { maxRetriesPerRequest: 3 });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
