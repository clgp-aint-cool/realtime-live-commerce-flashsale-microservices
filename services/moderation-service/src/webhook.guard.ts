import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from './common/env';

// Lambda bridge trên AWS gửi kèm header x-webhook-secret. So sánh hằng thời gian để tránh timing attack.
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly secret = Buffer.from(env('WEBHOOK_SHARED_SECRET'));

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = Buffer.from(String(req.headers['x-webhook-secret'] ?? ''));
    if (provided.length !== this.secret.length || !timingSafeEqual(provided, this.secret)) {
      throw new UnauthorizedException('Sai x-webhook-secret');
    }
    return true;
  }
}
