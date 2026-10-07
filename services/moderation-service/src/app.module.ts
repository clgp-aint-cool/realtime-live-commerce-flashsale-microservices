import { Module } from '@nestjs/common';
import { ChatClient } from './chat.client';
import { PgService } from './common/pg.service';
import { HealthController } from './health.controller';
import { LiveManagerClient } from './live-manager.client';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  controllers: [HealthController, ModerationController],
  providers: [PgService, ChatClient, LiveManagerClient, ModerationService],
})
export class AppModule {}
