import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from './env';
import { guardRedis, quitRedis, REDIS_OPTIONS } from './redis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env('REDIS_URL'), REDIS_OPTIONS);
    guardRedis(this);
  }

  async onModuleDestroy() {
    await quitRedis(this);
  }
}
