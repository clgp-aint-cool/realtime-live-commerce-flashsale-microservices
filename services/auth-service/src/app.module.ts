import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PgService } from './common/pg.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AuthController],
  providers: [PgService, AuthService],
})
export class AppModule {}
