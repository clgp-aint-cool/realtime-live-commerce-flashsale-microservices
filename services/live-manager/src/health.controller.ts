import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PgService } from './common/pg.service';
import { RedisService } from './common/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly pg: PgService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', service: 'live-manager' };
  }

  @Get('readyz')
  async readyz() {
    try {
      await Promise.all([this.pg.ping(), this.redis.ping()]);
      return { status: 'ready' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
  }
}
