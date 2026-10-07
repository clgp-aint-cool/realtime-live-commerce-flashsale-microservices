import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { InternalGuard } from './common/internal.guard';
import { ProductsService } from './products.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE = 1_000_000_000;

function sellerId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BadRequestException('sellerId không hợp lệ');
  return value.toLowerCase();
}

function text(value: unknown, field: string, min: number, max: number): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < min || v.length > max) throw new BadRequestException(`${field} dài ${min}-${max} ký tự`);
  return v;
}

function imageUrl(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '';
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new BadRequestException('imageUrl không phải URL hợp lệ');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException('imageUrl phải là http(s)');
  if (v.length > 500) throw new BadRequestException('imageUrl tối đa 500 ký tự');
  return v;
}

// Chỉ là danh mục. Tồn kho bán trong live do live-manager quản lý theo từng phiên.
@Controller('api/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query('sellerId') seller?: string) {
    return this.products.list(seller === undefined ? undefined : sellerId(seller));
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.products.get(id);
  }
}

// Người bán thêm sản phẩm qua live-manager (đã xác thực seller token). Kong không route /internal ra ngoài.
@Controller('internal/products')
@UseGuards(InternalGuard)
export class InternalProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: Record<string, unknown>) {
    const price = Number(body?.price);
    if (!Number.isInteger(price) || price < 1000 || price > MAX_PRICE) {
      throw new BadRequestException('Giá là số nguyên từ 1.000 đến 1.000.000.000 ₫');
    }
    return this.products.create({
      sellerId: sellerId(body?.sellerId),
      name: text(body?.name, 'Tên sản phẩm', 2, 80),
      description: text(body?.description ?? '', 'Mô tả', 0, 500),
      price,
      imageUrl: imageUrl(body?.imageUrl),
    });
  }
}
