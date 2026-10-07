import { BadRequestException, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SellerRow } from '../schema';
import { CurrentSeller, SellerGuard } from '../sellers/seller.guard';
import { SessionProductInput, SessionsService } from './sessions.service';

const MAX_PRODUCTS = 20;
const MAX_STOCK = 1_000_000;

function parseProducts(value: unknown): SessionProductInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PRODUCTS) {
    throw new BadRequestException(`products phải có 1-${MAX_PRODUCTS} phần tử`);
  }
  const items = value.map((v) => ({ productId: Number(v?.productId), stock: Number(v?.stock) }));
  for (const i of items) {
    if (!Number.isInteger(i.productId) || i.productId <= 0) throw new BadRequestException('productId không hợp lệ');
    if (!Number.isInteger(i.stock) || i.stock < 0 || i.stock > MAX_STOCK) {
      throw new BadRequestException(`stock phải là số nguyên 0..${MAX_STOCK}`);
    }
  }
  if (new Set(items.map((i) => i.productId)).size !== items.length) throw new BadRequestException('productId bị trùng');
  return items;
}

@Controller('api/sessions')
@UseGuards(SellerGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  // Tạo phiên live: { "title": "...", "products": [{ "productId": 1, "stock": 100 }] }
  @Post()
  create(@CurrentSeller() seller: SellerRow, @Body() body: { title?: unknown; products?: unknown }) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (title.length < 3 || title.length > 120) throw new BadRequestException('title dài 3-120 ký tự');
    return this.sessions.create(seller, title, parseProducts(body?.products));
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentSeller() seller: SellerRow, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.end(seller, id);
  }

  // { "productId": 1 } để ghim, { "productId": null } để bỏ ghim.
  @Post(':id/pin')
  @HttpCode(200)
  pin(@CurrentSeller() seller: SellerRow, @Param('id', ParseUUIDPipe) id: string, @Body() body: { productId?: unknown }) {
    const productId = body?.productId === null ? null : Number(body?.productId);
    if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
      throw new BadRequestException('productId không hợp lệ');
    }
    return this.sessions.pin(seller, id, productId);
  }
}
