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

  // Liveness có kiểm tra Redis, là lưới an toàn nếu client vẫn kẹt sau failover firewall.
  // Probe cho phép lỗi liên tục ~3 phút (failureThreshold 9 × 20s) rồi kubelet mới restart container.
  // Không kiểm tra PostgreSQL: pool pg tự tạo lại kết nối.
  @Get('livez')
  async livez() {
    try {
      await this.redis.ping();
      return { status: 'ok' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
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
