import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PgService } from './common/pg.service';

@Controller()
export class HealthController {
  constructor(private readonly pg: PgService) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', service: 'moderation-service' };
  }

  @Get('readyz')
  async readyz() {
    try {
      await this.pg.ping();
      return { status: 'ready' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
  }
}
