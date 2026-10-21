import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ChatStore } from './chat.store';

@Controller()
export class HealthController {
  constructor(private readonly store: ChatStore) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', service: 'chat-service' };
  }

  // Liveness có kiểm tra Redis, là lưới an toàn nếu client vẫn kẹt sau failover firewall.
  // Probe cho phép lỗi liên tục ~3 phút (failureThreshold 9 × 20s) rồi kubelet mới restart container.
  @Get('livez')
  async livez() {
    try {
      await this.store.ping();
      return { status: 'ok' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
  }

  @Get('readyz')
  async readyz() {
    try {
      await this.store.ping();
      return { status: 'ready' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
  }
}
