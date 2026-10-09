import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ChatClient, ProductClient } from './common/clients';
import { ObjectStorage } from './common/object-storage';
import { PgService } from './common/pg.service';
import { RedisService } from './common/redis.service';
import { HealthController } from './health.controller';
import { AwsIvsGateway } from './ivs/aws-ivs.gateway';
import { IvsGateway } from './ivs/ivs.gateway';
import { MockIvsGateway } from './ivs/mock-ivs.gateway';
import { InternalController, LivesController } from './lives/lives.controller';
import { LivesService } from './lives/lives.service';
import { MIGRATION } from './schema';
import { SellersController } from './sellers/sellers.controller';
import { SellersService } from './sellers/sellers.service';
import { SessionsController } from './sessions/sessions.controller';
import { SessionsService } from './sessions/sessions.service';

@Module({
  controllers: [HealthController, SellersController, SessionsController, LivesController, InternalController],
  providers: [
    PgService,
    RedisService,
    ProductClient,
    ChatClient,
    ObjectStorage,
    {
      provide: IvsGateway,
      inject: [RedisService],
      useFactory: (redis: RedisService) => {
        const mode = process.env.IVS_MODE ?? 'aws';
        if (mode === 'mock') return new MockIvsGateway(redis);
        if (mode === 'aws') return new AwsIvsGateway();
        throw new Error(`IVS_MODE không hợp lệ: ${mode} (aws | mock)`);
      },
    },
    SellersService,
    SessionsService,
    LivesService,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly pg: PgService,
    private readonly ivs: IvsGateway,
  ) {}

  async onModuleInit() {
    await this.pg.migrate(MIGRATION);
    new Logger('LiveManager').log(`IVS mode: ${this.ivs.mode}`);
  }
}
