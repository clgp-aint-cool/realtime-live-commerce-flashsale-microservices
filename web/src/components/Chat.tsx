import { FormEvent, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { auth, defaultUsername, saveUsername } from '../identity';
import { avatarColor, initials } from '../ui';
import { SendIcon } from './Icons';

export interface ChatMessage {
  id: string;
  room: string;
  type: 'user' | 'system';
  level: 'info' | 'alert';
  username: string;
  text: string;
  ts: number;
}

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_MESSAGES = 200;

export interface RoomEvents {
  onAlert: (msg: string) => void;
  onPin?: (data: { productId: number | null }) => void;
  onSessionEnded?: () => void;
}

// room = sessionId của phiên live: mỗi phiên một phòng chat riêng.
export function useChatRoom(room: string, events: RoomEvents) {
  const [username, setUsername] = useState(defaultUsername);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [instance, setInstance] = useState('');
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const usernameRef = useRef(username);
  usernameRef.current = username;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    // Cùng origin với web; Kong định tuyến /ws tới chat-service. Chỉ websocket => không cần sticky session.
    const socket = io({ path: '/ws', transports: ['websocket'] });
    socketRef.current = socket;

    const join = () =>
      socket.emit('join', { room, username: usernameRef.current }, (ack: Ack<{ instance: string; history: ChatMessage[] }>) => {
        if (!ack.ok) return setError(ack.error);
        setInstance(ack.data.instance);
        setMessages(ack.data.history);
      });

    socket.on('connect', () => {
      setConnected(true);
      setError('');
      join();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => setError(`Mất kết nối chat: ${err.message}`));
    socket.on('message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
      if (msg.type === 'system' && msg.level === 'alert') eventsRef.current.onAlert(msg.text);
    });
    socket.on('pin', (data: { productId: number | null }) => eventsRef.current.onPin?.(data));
    socket.on('session_ended', () => eventsRef.current.onSessionEnded?.());

    return () => {
      socket.disconnect();
    };
  }, [room]);

  const send = (text: string) =>
    new Promise<boolean>((resolve) => {
      if (!socketRef.current) return resolve(false);
      socketRef.current.emit('message', { text }, (ack: Ack<ChatMessage>) => {
        setError(ack.ok ? '' : ack.error);
        resolve(ack.ok);
      });
    });

  const rename = (name: string) => {
    const value = name.trim().slice(0, 32);
    if (!value) return;
    setUsername(value);
    saveUsername(value);
    socketRef.current?.emit('join', { room, username: value }, () => undefined);
  };

  return { username, messages, connected, instance, error, send, rename };
}

type Room = ReturnType<typeof useChatRoom>;

// Tin nhắn nổi trên video (kiểu TikTok/Shopee Live), mờ dần ở mép trên.
export function ChatFeed({ chat }: { chat: Room }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages]);

  return (
    <div className="chat-feed" ref={listRef}>
      {chat.messages.map((m) =>
        m.type === 'user' ? (
          <div key={m.id} className="bubble">
            <span className="bubble-avatar" style={{ background: avatarColor(m.username) }}>
              {initials(m.username)}
            </span>
            <span>
              <b>{m.username}</b> {m.text}
            </span>
          </div>
        ) : (
          <div key={m.id} className={`bubble system ${m.level}`}>
            {m.text}
          </div>
        ),
      )}
    </div>
  );
}

export function ChatComposer({ chat }: { chat: Room }) {
  const [text, setText] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (value && (await chat.send(value))) setText('');
  };

  const rename = () => {
    if (auth.get()) return; // đã đăng nhập: tên chat = tên hiển thị của tài khoản
    const name = prompt('Tên hiển thị trong chat', chat.username);
    if (name) chat.rename(name);
  };

  return (
    <div className="composer-wrap">
      {chat.error && <div className="chat-error">{chat.error}</div>}
      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className="name-chip"
          onClick={rename}
          title={`Đổi tên hiển thị${chat.instance ? ` · pod ${chat.instance}` : ''}`}
        >
          <span className={chat.connected ? 'dot online' : 'dot'} />
          {chat.username}
        </button>
        <input
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder={chat.connected ? 'Bình luận…' : 'Đang kết nối chat…'}
          disabled={!chat.connected}
        />
        <button className="icon-btn send" disabled={!chat.connected || !text.trim()} aria-label="Gửi">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
