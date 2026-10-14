import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PgService } from './common/pg.service';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),
  image_url   TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO products (sku, name, description, price, image_url) VALUES
  ('TSHIRT-01', 'Áo thun Live Commerce', 'Cotton 100%, chỉ bán trong phiên live', 99000, 'https://picsum.photos/seed/tshirt/400/400'),
  ('MUG-01', 'Cốc sứ phiên bản giới hạn', 'Dung tích 350ml', 59000, 'https://picsum.photos/seed/mug/400/400'),
  ('CAP-01', 'Mũ lưỡi trai', 'Một cỡ, có khóa điều chỉnh', 129000, 'https://picsum.photos/seed/cap/400/400')
ON CONFLICT (sku) DO NOTHING;
-- NULL = sản phẩm dùng chung (seed); có giá trị = sản phẩm do người bán đó tự thêm.
ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id UUID;
CREATE INDEX IF NOT EXISTS products_seller_idx ON products (seller_id, id);
`;

export interface NewProduct {
  sellerId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
}

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  seller_id: string | null;
}

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(private readonly pg: PgService) {}

  async onModuleInit() {
    await this.pg.migrate(MIGRATION);
  }

  // sellerId: chỉ trả sản phẩm dùng chung + sản phẩm của người bán đó. Đọc master vì người bán vừa thêm sản phẩm
  // là xem lại ngay. Danh mục chung (trang web, live-manager tải lại khi thiếu id) đọc slave.
  async list(sellerId?: string) {
    const { rows } = sellerId
      ? await this.pg.query<ProductRow>('SELECT * FROM products WHERE seller_id IS NULL OR seller_id = $1 ORDER BY id', [sellerId])
      : await this.pg.reader()<ProductRow>('SELECT * FROM products ORDER BY id');
    return rows.map((row) => this.toDto(row));
  }

  async create(input: NewProduct) {
    const sku = `S-${randomBytes(5).toString('hex').toUpperCase()}`;
    const imageUrl = input.imageUrl || `https://picsum.photos/seed/${sku}/400/400`;
    const { rows } = await this.pg.query<ProductRow>(
      `INSERT INTO products (sku, name, description, price, image_url, seller_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sku, input.name, input.description, input.price, imageUrl, input.sellerId],
    );
    return this.toDto(rows[0]);
  }

  async get(id: number) {
    const { rows } = await this.pg.query<ProductRow>('SELECT * FROM products WHERE id = $1', [id]);
    if (rows.length === 0) throw new NotFoundException(`Không có sản phẩm ${id}`);
    return this.toDto(rows[0]);
  }

  private toDto(row: ProductRow) {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      price: row.price,
      imageUrl: row.image_url,
      sellerId: row.seller_id,
    };
  }
}
