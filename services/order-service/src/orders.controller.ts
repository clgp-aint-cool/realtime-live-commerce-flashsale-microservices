import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { env } from './common/env';
import { verifyJwt } from './common/jwt';
import { OrdersService } from './orders.service';

const MAX_QUANTITY = 5;
const USER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CreateOrderBody {
  sessionId?: unknown;
  productId?: unknown;
  userId?: unknown;
  quantity?: unknown;
}

function validUserId(value: unknown): string {
  if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) {
    throw new BadRequestException('userId không hợp lệ (1-64 ký tự chữ, số, _ . : -)');
  }
  return value;
}

function validSessionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BadRequestException('sessionId không hợp lệ');
  return value.toLowerCase();
}

const JWT_SECRET = env('JWT_SECRET');
// Khách chưa đăng nhập (userId tự sinh ở trình duyệt). Bật cho local/e2e/k6, tắt trên production.
const ALLOW_GUEST = process.env.ALLOW_GUEST_ORDERS !== 'false';

// Có Bearer token => userId lấy từ token (bỏ qua userId client gửi).
// Không có token => chỉ chấp nhận userId khách, và không được mạo danh tài khoản thật (usr_...).
function resolveUser(authorization: string | undefined, guestUserId: unknown): string {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (match) {
    const claims = verifyJwt(JWT_SECRET, match[1]);
    if (!claims) throw new UnauthorizedException('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
    return claims.sub;
  }
  if (!ALLOW_GUEST) throw new UnauthorizedException('Vui lòng đăng nhập để mua hàng');
  const userId = validUserId(guestUserId);
  if (userId.startsWith('usr_')) throw new ForbiddenException('userId của tài khoản phải đi kèm Bearer token');
  return userId;
}

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateOrderBody, @Headers('authorization') authorization?: string) {
    const productId = Number(body?.productId);
    const quantity = body?.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(productId) || productId <= 0) throw new BadRequestException('productId không hợp lệ');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new BadRequestException(`quantity phải từ 1 đến ${MAX_QUANTITY}`);
    }
    const sessionId = validSessionId(body?.sessionId);
    return this.orders.create(sessionId, productId, resolveUser(authorization, body?.userId), quantity);
  }

  @Get()
  list(@Query('userId') userId: unknown, @Headers('authorization') authorization?: string) {
    return this.orders.listByUser(resolveUser(authorization, userId));
  }

  @Get('stats')
  stats(@Query('sessionId') sessionId: unknown, @Query('productId', new ParseIntPipe({ optional: true })) productId?: number) {
    return this.orders.stats(validSessionId(sessionId), productId);
  }
}
