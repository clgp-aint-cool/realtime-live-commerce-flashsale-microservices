import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ChatStore } from './chat.store';

@Controller()
export class HealthController {
  constructor(private readonly store: ChatStore) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', service: 'chat-service' };
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
