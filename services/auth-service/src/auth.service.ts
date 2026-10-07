import { ConflictException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from './common/env';
import { signJwt, verifyJwt } from './common/jwt';
import { DUMMY_HASH, hashPassword, verifyPassword } from './common/password';
import { PgService } from './common/pg.service';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- usr_<uuid>, cũng là user_id trong bảng orders
  username      TEXT UNIQUE NOT NULL,       -- chữ thường
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
`;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
}

// Chống dò mật khẩu: tối đa 10 lần sai / 15 phút cho mỗi username (đếm trong bộ nhớ từng pod).
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret = env('JWT_SECRET');
  private readonly ttlSeconds = Number(process.env.JWT_TTL_SECONDS ?? 7 * 24 * 3600);
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly pg: PgService) {
    if (this.secret.length < 32) throw new Error('JWT_SECRET phải dài ít nhất 32 ký tự');
  }

  async onModuleInit() {
    await this.pg.migrate(MIGRATION);
  }

  async register(username: string, password: string, displayName: string) {
    const id = `usr_${randomUUID()}`;
    try {
      const { rows } = await this.pg.query<UserRow>(
        `INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, username, displayName, await hashPassword(password)],
      );
      this.logger.log(`Đăng ký người dùng ${id} (${username})`);
      return this.session(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Tên đăng nhập đã có người dùng' });
      throw err;
    }
  }

  async login(username: string, password: string) {
    this.checkThrottle(username);
    const { rows } = await this.pg.query<UserRow>('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? (await DUMMY_HASH));
    if (!user || !ok) {
      this.recordFailure(username);
      throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');
    }
    this.failures.delete(username);
    await this.pg.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return this.session(user);
  }

  async me(token: string) {
    const claims = verifyJwt(this.secret, token);
    if (!claims) throw new UnauthorizedException('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
    const { rows } = await this.pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [claims.sub]);
    if (!rows[0]) throw new UnauthorizedException('Tài khoản không còn tồn tại');
    return this.toDto(rows[0]);
  }

  private session(user: UserRow) {
    return {
      token: signJwt(this.secret, { sub: user.id, name: user.display_name }, this.ttlSeconds),
      user: this.toDto(user),
    };
  }

  private toDto(user: UserRow) {
    return { id: user.id, username: user.username, displayName: user.display_name, createdAt: user.created_at };
  }

  private checkThrottle(username: string) {
    const entry = this.failures.get(username);
    if (entry && entry.until > Date.now() && entry.count >= MAX_FAILURES) {
      throw new HttpException('Sai mật khẩu quá nhiều lần, thử lại sau 15 phút', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(username: string) {
    const entry = this.failures.get(username);
    if (!entry || entry.until <= Date.now()) {
      this.failures.set(username, { count: 1, until: Date.now() + FAILURE_WINDOW_MS });
    } else {
      entry.count++;
    }
    if (this.failures.size > 10_000) this.failures.clear(); // chặn phình bộ nhớ khi bị dò hàng loạt
  }
}
