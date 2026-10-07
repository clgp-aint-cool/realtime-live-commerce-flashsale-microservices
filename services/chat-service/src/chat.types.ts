export type MessageType = 'user' | 'system';
export type MessageLevel = 'info' | 'alert';

export interface ChatMessage {
  id: string;
  room: string;
  type: MessageType;
  level: MessageLevel;
  username: string;
  text: string;
  ts: number;
}

// Phòng = sessionId của phiên live (UUID 36 ký tự) hoặc tên phòng tự do.
export const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const ROOM_EVENTS = ['pin', 'session_ended'] as const;
export type RoomEvent = (typeof ROOM_EVENTS)[number];
export const MAX_TEXT_LENGTH = 500;
export const MAX_USERNAME_LENGTH = 32;
