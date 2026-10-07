import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { PgService } from '../common/pg.service';
import { SellerRow } from '../schema';
import { hashToken } from './tokens';

type SellerRequest = Request & { seller?: SellerRow };

// MVP: người bán đăng nhập bằng token cấp lúc đăng ký (Authorization: Bearer lcs_...).
// DB chỉ lưu SHA-256 của token. Thay bằng OIDC/Keycloak khi có hệ thống tài khoản.
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(private readonly pg: PgService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SellerRequest>();
    const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    if (!match) throw new UnauthorizedException('Thiếu Authorization: Bearer <seller token>');
    const { rows } = await this.pg.query<SellerRow>('SELECT * FROM sellers WHERE token_hash = $1', [hashToken(match[1])]);
    if (rows.length === 0) throw new UnauthorizedException('Seller token không hợp lệ');
    req.seller = rows[0];
    return true;
  }
}

export const CurrentSeller = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SellerRow => ctx.switchToHttp().getRequest<SellerRequest>().seller!,
);
