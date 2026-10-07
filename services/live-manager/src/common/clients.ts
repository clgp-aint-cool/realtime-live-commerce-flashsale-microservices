import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { env } from './env';

const TIMEOUT_MS = 3000;

export interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  sellerId: string | null; // null = sản phẩm dùng chung
}

// Danh mục sản phẩm lấy từ product-service, cache ngắn để trang xem live poll không dồn tải.
@Injectable()
export class ProductClient {
  private readonly baseUrl = env('PRODUCT_SERVICE_URL').replace(/\/$/, '');
  private cache: { at: number; products: Map<number, CatalogProduct> } | null = null;
  private readonly ttlMs = 30_000;

  private readonly token = process.env.INTERNAL_API_TOKEN;

  // ids: các sản phẩm cần có. Thiếu id nào (vd. vừa được thêm ở replica khác) thì tải lại ngay, không chờ hết TTL.
  async catalog(ids: number[] = []): Promise<Map<number, CatalogProduct>> {
    const cached = this.cache;
    if (cached && Date.now() - cached.at < this.ttlMs && ids.every((id) => cached.products.has(id))) return cached.products;
    const list = await this.get<CatalogProduct[]>('/api/products');
    this.cache = { at: Date.now(), products: new Map(list.map((p) => [p.id, p])) };
    return this.cache.products;
  }

  forSeller(sellerId: string) {
    return this.get<CatalogProduct[]>(`/api/products?sellerId=${encodeURIComponent(sellerId)}`);
  }

  async create(sellerId: string, input: Record<string, unknown>): Promise<CatalogProduct> {
    const res = await fetch(`${this.baseUrl}/internal/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.token ? { 'x-internal-token': this.token } : {}) },
      body: JSON.stringify({ ...input, sellerId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as CatalogProduct & { message?: unknown };
    // Lỗi kiểm tra dữ liệu của product-service trả nguyên cho người bán.
    if (res.status === 400) throw new BadRequestException(body.message ?? 'Dữ liệu sản phẩm không hợp lệ');
    if (!res.ok) throw new Error(`product-service trả về ${res.status}`);
    this.cache = null;
    return body;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`product-service trả về ${res.status}`);
    return (await res.json()) as T;
  }
}

// Đẩy sự kiện realtime (ghim sản phẩm, kết thúc phiên) vào phòng chat của phiên.
@Injectable()
export class ChatClient {
  private readonly logger = new Logger(ChatClient.name);
  private readonly baseUrl = env('CHAT_SERVICE_URL').replace(/\/$/, '');
  private readonly token = process.env.INTERNAL_API_TOKEN;

  async emit(room: string, event: 'pin' | 'session_ended', data: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/rooms/${encodeURIComponent(room)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.token ? { 'x-internal-token': this.token } : {}) },
        body: JSON.stringify({ event, data }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`chat-service trả về ${res.status}`);
      return true;
    } catch (err) {
      this.logger.warn(`Không gửi được sự kiện ${event} vào chat: ${(err as Error).message}`);
      return false;
    }
  }
}
