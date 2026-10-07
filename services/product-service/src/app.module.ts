import { Module } from '@nestjs/common';
import { PgService } from './common/pg.service';
import { HealthController } from './health.controller';
import { InternalProductsController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [HealthController, ProductsController, InternalProductsController],
  providers: [PgService, ProductsService],
})
export class AppModule {}
