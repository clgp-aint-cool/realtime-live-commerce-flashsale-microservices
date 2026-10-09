import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { ProductClient } from '../common/clients';
import { SellerRow } from '../schema';
import { CurrentSeller, SellerGuard } from './seller.guard';
import { SellersService } from './sellers.service';

@Controller('api/sellers')
export class SellersController {
  constructor(
    private readonly sellers: SellersService,
    private readonly products: ProductClient,
  ) {}

  // Chỉ admin được đăng ký người bán (mỗi người bán tạo một kênh IVS => có chi phí).
  @Post()
  @UseGuards(AdminGuard)
  register(@Body() body: { name?: unknown }) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 60) throw new BadRequestException('name dài 2-60 ký tự');
    return this.sellers.register(name);
  }

  @Get('me')
  @UseGuards(SellerGuard)
  me(@CurrentSeller() seller: SellerRow) {
    return this.sellers.profile(seller);
  }

  // Danh mục người bán dùng khi mở phiên: sản phẩm dùng chung + sản phẩm tự thêm.
  @Get('me/products')
  @UseGuards(SellerGuard)
  myProducts(@CurrentSeller() seller: SellerRow) {
    return this.products.forSeller(seller.id);
  }

  // Thêm sản phẩm vào danh mục riêng: { name, price, description?, imageUrl? }. product-service kiểm tra dữ liệu.
  @Post('me/products')
  @UseGuards(SellerGuard)
  addProduct(@CurrentSeller() seller: SellerRow, @Body() body: Record<string, unknown>) {
    const { name, price, description, imageUrl } = body ?? {};
    return this.products.create(seller.id, { name, price, description, imageUrl });
  }

  // Xin URL upload ảnh lên S3: { kind: 'avatar' | 'product', contentType, size }.
  // Trả { uploadUrl, headers, publicUrl }: trình duyệt PUT file vào uploadUrl, sau đó dùng publicUrl
  // làm imageUrl khi thêm sản phẩm, hoặc gửi PUT /api/sellers/me/avatar.
  @Post('me/uploads')
  @UseGuards(SellerGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  upload(@CurrentSeller() seller: SellerRow, @Body() body: { kind?: unknown; contentType?: unknown; size?: unknown }) {
    return this.sellers.uploadImage(seller, body?.kind, body?.contentType, body?.size);
  }

  @Put('me/avatar')
  @UseGuards(SellerGuard)
  setAvatar(@CurrentSeller() seller: SellerRow, @Body() body: { avatarUrl?: unknown }) {
    return this.sellers.setAvatar(seller, body?.avatarUrl ?? null);
  }

  // Stream key chỉ trả cho chính người bán, không bao giờ xuất hiện trong API công khai.
  @Get('me/stream-key')
  @UseGuards(SellerGuard)
  @Header('Cache-Control', 'no-store')
  async streamKey(@CurrentSeller() seller: SellerRow) {
    return { streamKey: await this.sellers.streamKey(seller) };
  }

  @Post('me/stream-key/reset')
  @UseGuards(SellerGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reset(@CurrentSeller() seller: SellerRow) {
    return { streamKey: await this.sellers.resetStreamKey(seller) };
  }

  @Get('me/obs-profile')
  @UseGuards(SellerGuard)
  async obsProfile(@CurrentSeller() seller: SellerRow, @Res() res: Response) {
    const { filename, data } = await this.sellers.obsProfile(seller);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(data));
  }
}
