import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ObjectStorage } from './common/object-storage';
import { PgService } from './common/pg.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AuthController],
  providers: [PgService, ObjectStorage, AuthService],
})
export class AppModule {}
