import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ChatGateway } from './chat.gateway';
import { ChatStore } from './chat.store';
import { MAX_TEXT_LENGTH, ROOM_EVENTS, ROOM_PATTERN, RoomEvent } from './chat.types';

// API nội bộ cho các service khác (moderation-service, live-manager) đẩy thông báo hệ thống vào phòng chat.
// Kong không định tuyến /internal ra ngoài; nếu đặt INTERNAL_API_TOKEN thì bắt buộc header x-internal-token.
@Controller('internal')
export class InternalController {
  private readonly token = process.env.INTERNAL_API_TOKEN ? Buffer.from(process.env.INTERNAL_API_TOKEN) : null;

  constructor(
    private readonly gateway: ChatGateway,
    private readonly store: ChatStore,
  ) {}

  @Post('rooms/:room/system-messages')
  @HttpCode(202)
  async systemMessage(
    @Param('room') room: string,
    @Body() body: { text?: unknown; level?: unknown },
    @Headers('x-internal-token') token?: string,
  ) {
    this.authorize(room, token);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_TEXT_LENGTH) throw new BadRequestException('text không hợp lệ');
    const level = body?.level === 'alert' ? 'alert' : 'info';

    const msg = this.store.build(room, 'system', level, 'Hệ thống', text);
    await this.gateway.broadcast(msg);
    return msg;
  }

  // { "event": "pin" | "session_ended", "data": {...} } -> socket.emit(event, data) tới cả phòng.
  @Post('rooms/:room/events')
  @HttpCode(202)
  roomEvent(
    @Param('room') room: string,
    @Body() body: { event?: unknown; data?: unknown },
    @Headers('x-internal-token') token?: string,
  ) {
    this.authorize(room, token);
    if (!ROOM_EVENTS.includes(body?.event as RoomEvent)) throw new BadRequestException('event không hợp lệ');
    const data = body?.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
    if (JSON.stringify(data).length > 1024) throw new BadRequestException('data quá lớn');
    this.gateway.emitEvent(room, body.event as RoomEvent, data);
    return { room, event: body.event };
  }

  private authorize(room: string, token: string | undefined) {
    if (this.token) {
      const provided = Buffer.from(token ?? '');
      if (provided.length !== this.token.length || !timingSafeEqual(provided, this.token)) {
        throw new UnauthorizedException();
      }
    }
    if (!ROOM_PATTERN.test(room)) throw new BadRequestException('room không hợp lệ');
  }
}
