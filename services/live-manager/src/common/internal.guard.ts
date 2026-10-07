import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// API nội bộ giữa các service (Kong không route /internal ra ngoài).
// Nếu đặt INTERNAL_API_TOKEN thì bắt buộc header x-internal-token.
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly token = process.env.INTERNAL_API_TOKEN ? Buffer.from(process.env.INTERNAL_API_TOKEN) : null;

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const provided = Buffer.from(String(req.headers['x-internal-token'] ?? ''));
    if (provided.length !== this.token.length || !timingSafeEqual(provided, this.token)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
