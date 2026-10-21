import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

// Khóa advisory dùng chung để nhiều replica không chạy migration cùng lúc.
const MIGRATION_LOCK_ID = 742001;
// Migration lúc khởi động gặp lỗi kết nối thì thử lại nền, giãn dần tới mức này.
const MIGRATION_RETRY_MAX_MS = 30_000;

// Lỗi mạng (ECONNRESET, ECONNREFUSED, timeout: không có SQLSTATE) hoặc DB đang tắt / quá tải / từ chối kết nối.
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; severity?: string };
  return !e.severity || /^(08|53|57P)/.test(e.code ?? '');
}
// Slave lỗi kết nối thì bỏ qua trong khoảng này, đọc từ master thay vì chờ timeout ở mỗi request.
const READ_DOWN_MS = 30_000;

export type Query = <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;

interface ReadPool {
  host: string;
  pool: Pool;
  downUntil: number;
}

// DATABASE_READ_HOSTS="192.168.7.16,192.168.7.172:5432": slave (streaming replica) dùng chung user/mật khẩu/db với
// DATABASE_URL, chỉ đổi host. Trống thì mọi query đọc đi master như cũ.
function readUrls(primary: string): { host: string; url: string }[] {
  return (process.env.DATABASE_READ_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
    .map((host) => {
      const url = new URL(primary);
      url.host = host.includes(':') ? host : `${host}:${url.port || 5432}`;
      return { host, url: url.toString() };
    });
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
  private readonly readPools: ReadPool[] = readUrls(env('DATABASE_URL')).map(({ host, url }) => ({
    host,
    pool: new Pool({
      connectionString: url,
      max: Number(process.env.PG_READ_POOL_MAX ?? process.env.PG_POOL_MAX ?? 10),
      connectionTimeoutMillis: 2000,
    }),
    downUntil: 0,
  }));
  private next = 0;

  constructor() {
    // Kết nối rảnh trong pool bị đóng (DB restart, firewall reset): pool phát 'error'. Không có listener thì Node coi là
    // uncaught exception và process thoát, nên chỉ log; request sau sẽ mở kết nối mới.
    this.pool.on('error', (err) => this.logger.warn(`Kết nối PostgreSQL rảnh bị đóng: ${err.message}`));
    for (const r of this.readPools) {
      r.pool.on('error', (err) => this.logger.warn(`Kết nối rảnh tới slave ${r.host} bị đóng: ${err.message}`));
    }
    if (this.readPools.length) this.logger.log(`Đọc qua slave: ${this.readPools.map((r) => r.host).join(', ')}`);
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  /** Cùng kiểu với reader() nhưng đọc master: cho chỗ cần dữ liệu vừa ghi. */
  primary(): Query {
    return (sql, params = []) => this.query(sql, params);
  }

  /**
   * Hàm query trên một slave (xoay vòng), dùng cho các đọc chịu được trễ replication vài ms.
   * Gọi một lần cho mỗi request để các query trong request cùng đọc một slave (cùng một thời điểm dữ liệu).
   * Slave lỗi kết nối thì đánh dấu hỏng READ_DOWN_MS và đọc từ master. Lỗi SQL thì ném ra như query thường.
   */
  reader(): Query {
    const now = Date.now();
    const alive = this.readPools.filter((r) => r.downUntil <= now);
    if (alive.length === 0) return this.primary();
    const r = alive[this.next++ % alive.length];
    return async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => {
      try {
        return await r.pool.query<T>(sql, params);
      } catch (err) {
        // Lỗi gì cũng chạy lại ở master (lỗi SQL thật sẽ lỗi lại ở master và được ném ra từ đó).
        // Lỗi kết nối/xác thực/quá tải hoặc slave đang tắt (08, 28, 3D, 53, 57P, lỗi mạng không có SQLSTATE) thì
        // bỏ slave này READ_DOWN_MS. 40001 (query bị hủy vì xung đột với replication) chỉ chạy lại, không bỏ slave.
        const e = err as Error & { code?: string; severity?: string };
        if (!e.severity || /^(08|28|3D|53|57P)/.test(e.code ?? '')) {
          r.downUntil = Date.now() + READ_DOWN_MS;
          this.logger.warn(`Slave ${r.host} lỗi (${e.message}), đọc từ master ${READ_DOWN_MS / 1000}s`);
        }
        return this.query<T>(sql, params);
      }
    };
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
    await Promise.all([this.pool.end(), ...this.readPools.map((r) => r.pool.end())]);
  }
}
