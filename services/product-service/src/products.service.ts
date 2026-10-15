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
-- Sản phẩm dùng chung cho mọi shop mới: hàng anime mẫu, cùng ảnh với shop demo (scripts/seed-demo.cjs).
-- DB cũ có 3 sản phẩm áo/cốc/mũ: đổi tại chỗ (giữ id vì orders.product_id tham chiếu), chỉ khi chưa bị sửa.
UPDATE products SET sku = 'ANIME-FIGURE-01', name = 'Figure 1/7 Frieren - Sousou no Frieren',
  description = 'Scale 1/7, cao 24cm, hàng chính hãng Good Smile', price = 3290000,
  image_url = 'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png'
  WHERE sku = 'TSHIRT-01' AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'ANIME-FIGURE-01');
UPDATE products SET sku = 'ANIME-NENDO-01', name = 'Nendoroid Anya Forger - Spy x Family',
  description = 'Kèm 3 biểu cảm, đậu phộng mini', price = 990000,
  image_url = 'https://s4.anilist.co/file/anilistcdn/character/large/b138100-4Li0tWRCa5bQ.png'
  WHERE sku = 'MUG-01' AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'ANIME-NENDO-01');
UPDATE products SET sku = 'ANIME-GUNPLA-01', name = 'Gunpla HG Gundam Aerial - Witch from Mercury',
  description = 'High Grade 1/144, kèm khiên Bit', price = 390000,
  image_url = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx139274-0NJTOKWHdDew.png'
  WHERE sku = 'CAP-01' AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'ANIME-GUNPLA-01');
INSERT INTO products (sku, name, description, price, image_url) VALUES
  ('ANIME-FIGURE-01', 'Figure 1/7 Frieren - Sousou no Frieren', 'Scale 1/7, cao 24cm, hàng chính hãng Good Smile', 3290000,
   'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png'),
  ('ANIME-NENDO-01', 'Nendoroid Anya Forger - Spy x Family', 'Kèm 3 biểu cảm, đậu phộng mini', 990000,
   'https://s4.anilist.co/file/anilistcdn/character/large/b138100-4Li0tWRCa5bQ.png'),
  ('ANIME-GUNPLA-01', 'Gunpla HG Gundam Aerial - Witch from Mercury', 'High Grade 1/144, kèm khiên Bit', 390000,
   'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx139274-0NJTOKWHdDew.png'),
  ('ANIME-MANGA-01', 'Chainsaw Man tập 1-11 trọn bộ phần 1', 'Bản tiếng Việt, kèm bookmark', 495000,
   'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105778-euxXZEIfDY2u.png'),
  ('ANIME-LN-01', 'Light novel Re:Zero tập 1-15', 'Bản tiếng Việt, bìa áo', 1650000,
   'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx85737-WkWOr5EgwPyo.jpg'),
  ('ANIME-GOODS-01', 'Standee acrylic Frieren & Fern', 'Cao 15cm, đế rời', 180000,
   'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg')
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
