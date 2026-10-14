import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

// Khóa advisory dùng chung để nhiều replica không chạy migration cùng lúc.
const MIGRATION_LOCK_ID = 742001;
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
  });
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
    await Promise.all([this.pool.end(), ...this.readPools.map((r) => r.pool.end())]);
  }
}
