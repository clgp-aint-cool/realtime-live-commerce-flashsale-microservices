import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

// Khóa advisory dùng chung để nhiều replica không chạy migration cùng lúc.
const MIGRATION_LOCK_ID = 742006;
// Migration lúc khởi động gặp lỗi kết nối thì thử lại nền, giãn dần tới mức này.
const MIGRATION_RETRY_MAX_MS = 30_000;

// Lỗi mạng (ECONNRESET, ECONNREFUSED, timeout: không có SQLSTATE) hoặc DB đang tắt / quá tải / từ chối kết nối.
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; severity?: string };
  return !e.severity || /^(08|53|57P)/.test(e.code ?? '');
}

@Injectable()
export class PgService implements OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  readonly pool = new Pool({
    connectionString: env('DATABASE_URL'),
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Firewall drop gói (không reset) thì báo lỗi sau mức này thay vì treo request theo TCP timeout.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5000),
  });
  private migrationPending = false;
  private closed = false;

  constructor() {
    // Kết nối rảnh trong pool bị đóng (DB restart, firewall reset): pool phát 'error'. Không có listener thì Node coi là
    // uncaught exception và process thoát, nên chỉ log; request sau sẽ mở kết nối mới.
    this.pool.on('error', (err) => this.logger.warn(`Kết nối PostgreSQL rảnh bị đóng: ${err.message}`));
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  /**
   * Chạy migration lúc khởi động. Không kết nối được PostgreSQL thì không ném lỗi (ném ra sẽ làm process thoát và pod
   * rơi vào CrashLoopBackOff suốt thời gian DB đứt) mà thử lại ở nền với backoff. Trong lúc chờ, ping() báo lỗi nên
   * /readyz trả 503 và pod không nhận traffic. Lỗi SQL (migration sai) vẫn ném ra như cũ.
   */
  async migrate(sql: string): Promise<void> {
    try {
      await this.runMigration(sql);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      this.migrationPending = true;
      this.logger.warn(`Chưa kết nối được PostgreSQL (${(err as Error).message}), sẽ chạy lại migration ở nền`);
      this.retryMigration(sql, 1);
    }
  }

  private retryMigration(sql: string, attempt: number) {
    const delay = Math.min(1000 * 2 ** attempt, MIGRATION_RETRY_MAX_MS);
    // unref: timer không giữ process lại khi pod đang tắt.
    setTimeout(async () => {
      if (this.closed) return;
      try {
        await this.runMigration(sql);
        this.migrationPending = false;
      } catch (err) {
        if (!isConnectionError(err)) {
          this.logger.error(`Migration lỗi, pod sẽ không Ready: ${(err as Error).message}`);
          return;
        }
        this.logger.warn(`Vẫn chưa kết nối được PostgreSQL (lần ${attempt}: ${(err as Error).message})`);
        this.retryMigration(sql, attempt + 1);
      }
    }, delay).unref();
  }

  private async runMigration(sql: string): Promise<void> {
    const client = await this.pool.connect();
    let failed: Error | undefined;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      await client.query(sql);
      this.logger.log('Migration xong');
    } catch (err) {
      failed = err as Error;
      throw err;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
      // Truyền lỗi để pool hủy kết nối hỏng thay vì trả lại pool.
      client.release(failed);
    }
  }

  async ping(): Promise<void> {
    if (this.migrationPending) throw new Error('Migration chưa chạy xong (đang chờ PostgreSQL)');
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    this.closed = true;
    await this.pool.end();
  }
}
