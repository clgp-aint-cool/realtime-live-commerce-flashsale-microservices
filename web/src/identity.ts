import { useSyncExternalStore } from 'react';
import { api, AuthSession, User } from './api';

// Tài khoản người mua: JWT + thông tin user lưu trong localStorage, đồng bộ giữa các tab.
const AUTH_KEY = 'lc.auth';
const RETURN_KEY = 'lc.returnTo';

function read(): AuthSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as AuthSession | null;
    return value?.token && value.user ? value : null;
  } catch {
    return null;
  }
}

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

window.addEventListener('storage', (e) => {
  if (e.key !== AUTH_KEY) return;
  current = read();
  emit();
});

export const auth = {
  get: () => current,
  set(session: AuthSession | null) {
    current = session;
    if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_KEY);
    emit();
  },
  logout: () => auth.set(null),
  // Kiểm tra lại token khi mở app: hết hạn/bị xóa tài khoản thì đăng xuất.
  async refresh() {
    if (!current) return;
    try {
      const user: User = await api.currentUser(current.token);
      auth.set({ token: current.token, user });
    } catch (err) {
      if ((err as { status?: number }).status === 401) auth.logout();
    }
  },
  // Trang cần đăng nhập: nhớ trang hiện tại để quay lại sau khi đăng nhập.
  requireLogin() {
    sessionStorage.setItem(RETURN_KEY, location.hash || '#/');
    location.hash = '#/login';
  },
  takeReturnTo() {
    const to = sessionStorage.getItem(RETURN_KEY) ?? '#/';
    sessionStorage.removeItem(RETURN_KEY);
    return to === '#/login' ? '#/' : to;
  },
};

export function useAuth(): AuthSession | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

// Tên chat của khách chưa đăng nhập. Đã đăng nhập thì dùng tên hiển thị của tài khoản.
function stored(key: string, create: () => string): string {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = create();
  localStorage.setItem(key, value);
  return value;
}

export const defaultUsername = () => current?.user.displayName ?? stored('lc.username', () => `Khách-${Math.floor(1000 + Math.random() * 9000)}`);
export const saveUsername = (name: string) => localStorage.setItem('lc.username', name);
