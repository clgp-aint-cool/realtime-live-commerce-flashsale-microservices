import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatStore } from './chat.store';
import { HealthController } from './health.controller';
import { InternalController } from './internal.controller';

@Module({
  controllers: [HealthController, InternalController],
  providers: [ChatStore, ChatGateway],
})
export class AppModule {}
