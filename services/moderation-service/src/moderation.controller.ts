import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { parseEvent } from './moderation.types';
import { WebhookSecretGuard } from './webhook.guard';

@Controller()
@UseGuards(WebhookSecretGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // Lambda bridge gọi endpoint này (qua VPN -> Palo Alto -> NodePort moderation-webhook).
  @Post('webhooks/moderation')
  @HttpCode(200)
  async webhook(@Body() body: unknown) {
    const event = parseEvent(body);
    if (typeof event === 'string') throw new BadRequestException(event);
    const result = await this.moderation.handle(event);
    if (result === 'notify_failed') {
      throw new HttpException({ eventId: event.eventId, result }, HttpStatus.BAD_GATEWAY);
    }
    return { eventId: event.eventId, result };
  }

  @Get('api/moderation/events')
  events() {
    return this.moderation.recent();
  }
}
