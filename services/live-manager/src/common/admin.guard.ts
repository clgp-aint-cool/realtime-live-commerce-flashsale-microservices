import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from './env';

// Bảo vệ API quản trị bằng header x-admin-token (MVP, chưa có hệ thống đăng nhập).
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly token = Buffer.from(env('ADMIN_TOKEN'));

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = Buffer.from(String(req.headers['x-admin-token'] ?? ''));
    if (provided.length !== this.token.length || !timingSafeEqual(provided, this.token)) {
      throw new UnauthorizedException('Sai x-admin-token');
    }
    return true;
  }
}
