import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { hostname } from 'node:os';
import type { Server, Socket } from 'socket.io';
import { ChatStore } from './chat.store';
import { ChatMessage, MAX_TEXT_LENGTH, MAX_USERNAME_LENGTH, ROOM_PATTERN, RoomEvent } from './chat.types';

const MIN_INTERVAL_MS = 300; // chống spam đơn giản: tối đa ~3 tin/giây mỗi kết nối

interface SocketState {
  room?: string;
  username?: string;
  lastMessageAt?: number;
}

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

// path '/ws' trùng với route của Kong (strip-path=false).
// Chỉ dùng transport websocket: không cần sticky session khi chạy nhiều pod.
@WebSocketGateway({ path: '/ws', transports: ['websocket'], cors: { origin: true } })
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);
  readonly instance = hostname();

  @WebSocketServer()
  server: Server;

  constructor(private readonly store: ChatStore) {}

  handleConnection(client: Socket) {
    client.emit('hello', { instance: this.instance });
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: unknown; username?: unknown },
  ): Promise<Ack<{ instance: string; history: ChatMessage[] }>> {
    const room = typeof body?.room === 'string' ? body.room : '';
    const username = typeof body?.username === 'string' ? body.username.trim().slice(0, MAX_USERNAME_LENGTH) : '';
    if (!ROOM_PATTERN.test(room)) return { ok: false, error: 'room không hợp lệ' };
    if (!username) return { ok: false, error: 'Thiếu username' };

    const state = client.data as SocketState;
    if (state.room && state.room !== room) await client.leave(state.room);
    state.room = room;
    state.username = username;
    await client.join(room);
    return { ok: true, data: { instance: this.instance, history: await this.store.history(room) } };
  }

  @SubscribeMessage('message')
  async message(@ConnectedSocket() client: Socket, @MessageBody() body: { text?: unknown }): Promise<Ack<ChatMessage>> {
    const state = client.data as SocketState;
    if (!state.room || !state.username) return { ok: false, error: 'Cần join phòng trước' };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return { ok: false, error: 'Tin nhắn trống' };
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: `Tối đa ${MAX_TEXT_LENGTH} ký tự` };
    const now = Date.now();
    if (state.lastMessageAt && now - state.lastMessageAt < MIN_INTERVAL_MS) {
      return { ok: false, error: 'Gửi quá nhanh' };
    }
    state.lastMessageAt = now;

    const msg = this.store.build(state.room, 'user', 'info', state.username, text);
    await this.broadcast(msg);
    return { ok: true, data: msg };
  }

  // Emit qua Redis adapter nên tới được client ở mọi pod.
  // Sự kiện realtime của phiên live (ghim sản phẩm, kết thúc phiên); qua Redis adapter tới mọi pod.
  emitEvent(room: string, event: RoomEvent, data: Record<string, unknown>): void {
    this.server.to(room).emit(event, data);
  }

  async broadcast(msg: ChatMessage): Promise<void> {
    await this.store.save(msg);
    this.server.to(msg.room).emit('message', msg);
  }
}
