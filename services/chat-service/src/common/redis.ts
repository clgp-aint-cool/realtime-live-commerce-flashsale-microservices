import { Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';

const logger = new Logger('Redis');
let closing = false;

// Sau failover Palo Alto, socket cũ có thể treo: PA mới không có session nên gói bị drop
// mà không có RST, ioredis vẫn tưởng đang kết nối. Các tuỳ chọn dưới đây giúp client
// phát hiện và tự kết nối lại thay vì chờ vô hạn.
export const REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 3,
  connectTimeout: 5_000,
  commandTimeout: 2_000, // lệnh (kể cả PING của /readyz) không treo quá 2s
  keepAlive: 10_000, // TCP keepalive sau 10s rảnh
  retryStrategy: (times) => Math.min(times * 500, 5_000), // không bao giờ bỏ cuộc
};

const WATCHDOG_INTERVAL_MS = 10_000;
const WATCHDOG_MAX_FAILS = 3;

// Gắn cho mọi client Redis:
// - watchdog: PING lỗi 3 lần liên tiếp (~30s) thì ngắt socket và kết nối lại. Keepalive không
//   cứu được socket còn dữ liệu chưa ACK, phải chờ TCP retransmit ~15 phút nên cần watchdog.
// - client đóng hẳn ngoài ý muốn (status "end") thì thoát process để kubelet khởi động lại container.
export function guardRedis<T extends Redis>(client: T): T {
  let fails = 0;
  const timer = setInterval(async () => {
    if (client.status !== 'ready') return; // đang reconnect, retryStrategy lo
    try {
      await client.ping();
      fails = 0;
    } catch (err) {
      if (++fails < WATCHDOG_MAX_FAILS) return;
      logger.warn(`PING Redis lỗi ${fails} lần liên tiếp (${(err as Error).message}), ngắt và kết nối lại`);
      fails = 0;
      client.disconnect(true);
    }
  }, WATCHDOG_INTERVAL_MS);
  timer.unref();

  client.on('end', () => {
    clearInterval(timer);
    if (closing) return;
    logger.error('Kết nối Redis đã đóng hẳn, thoát để kubelet khởi động lại container');
    process.exit(1);
  });
  return client;
}

// Dùng thay cho client.quit() khi shutdown để sự kiện "end" không làm process thoát với mã lỗi.
export const quitRedis = (client: Redis) => {
  closing = true;
  return client.quit();
};

export const createRedis = () => guardRedis(new Redis(env('REDIS_URL'), REDIS_OPTIONS));
