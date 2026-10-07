import { Module } from '@nestjs/common';
import { PgService } from './common/pg.service';
import { RedisService } from './common/redis.service';
import { HealthController } from './health.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [HealthController, OrdersController],
  providers: [PgService, RedisService, OrdersService],
})
export class AppModule {}
