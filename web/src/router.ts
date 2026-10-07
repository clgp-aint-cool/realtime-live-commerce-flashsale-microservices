import { useEffect, useState } from 'react';

export type Route =
  | { page: 'lives' }
  | { page: 'live'; sessionId: string }
  | { page: 'seller' }
  | { page: 'admin' }
  | { page: 'login' }
  | { page: 'orders' };

// Hash router: nginx không cần cấu hình fallback, link chia sẻ được (#/live/<sessionId>).
function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const live = /^\/live\/([0-9a-f-]{36})$/i.exec(path);
  if (live) return { page: 'live', sessionId: live[1] };
  if (path === '/seller') return { page: 'seller' };
  if (path === '/admin') return { page: 'admin' };
  if (path === '/login') return { page: 'login' };
  if (path === '/orders') return { page: 'orders' };
  return { page: 'lives' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const href = {
  lives: '#/',
  live: (sessionId: string) => `#/live/${sessionId}`,
  seller: '#/seller',
  admin: '#/admin',
  login: '#/login',
  orders: '#/orders',
};
