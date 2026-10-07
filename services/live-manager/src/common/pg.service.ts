import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

// Khóa advisory dùng chung để nhiều replica không chạy migration cùng lúc.
const MIGRATION_LOCK_ID = 742001;

@Injectable()
export class PgService implements OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  readonly pool = new Pool({
    connectionString: env('DATABASE_URL'),
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  async migrate(sql: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      await client.query(sql);
      this.logger.log('Migration xong');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
