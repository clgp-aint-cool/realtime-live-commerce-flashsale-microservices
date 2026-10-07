export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  sellerId: string | null; // null = sản phẩm dùng chung
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: User;
}

export interface NewProduct {
  name: string;
  price: number;
  description: string;
  imageUrl: string;
}

export interface LiveProduct extends Product {
  stock: number;
  initialStock: number;
}

export interface LiveSummary {
  sessionId: string;
  title: string;
  seller: { id: string; name: string };
  playbackUrl: string;
  streamState: 'LIVE' | 'OFFLINE';
  viewerCount: number;
  startedAt: string;
}

export interface LiveDetail extends LiveSummary {
  status: 'OPEN' | 'ENDED';
  pinnedProductId: number | null;
  products: LiveProduct[];
}

export interface SellerProfile {
  id: string;
  name: string;
  channelArn: string;
  ingestServer: string;
  playbackUrl: string;
  hasStreamKey: boolean;
  currentSessionId: string | null;
  ivsMode: string;
}

export interface Order {
  id: number;
  sessionId: string;
  sellerId: string;
  productId: number;
  userId: string;
  quantity: number;
  status: string;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function raw(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText;
    throw new ApiError(res.status, body.code, message);
  }
  return res;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => (await raw(path, init)).json() as Promise<T>;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers,
});

export const api = {
  products: () => request<Product[]>('/api/products'),
  lives: () => request<LiveSummary[]>('/api/lives'),
  live: (sessionId: string) => request<LiveDetail>(`/api/lives/${sessionId}`),
  // Người mua (JWT từ auth-service). order-service lấy userId từ token.
  register: (username: string, password: string, displayName: string) =>
    request<AuthSession>('/api/auth/register', post({ username, password, displayName })),
  login: (username: string, password: string) => request<AuthSession>('/api/auth/login', post({ username, password })),
  currentUser: (token: string) => request<User>('/api/auth/me', { headers: bearer(token) }),
  order: (token: string, sessionId: string, productId: number) =>
    request<Order>('/api/orders', post({ sessionId, productId, quantity: 1 }, bearer(token))),
  myOrders: (token: string) => request<Order[]>('/api/orders', { headers: bearer(token) }),

  // Người bán (Bearer token cấp khi đăng ký)
  me: (token: string) => request<SellerProfile>('/api/sellers/me', { headers: bearer(token) }),
  streamKey: (token: string) => request<{ streamKey: string }>('/api/sellers/me/stream-key', { headers: bearer(token) }),
  resetStreamKey: (token: string) => request<{ streamKey: string }>('/api/sellers/me/stream-key/reset', post({}, bearer(token))),
  obsProfile: async (token: string) => {
    const res = await raw('/api/sellers/me/obs-profile', { headers: bearer(token) });
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'obs-profile.zip';
    return { name, blob: await res.blob() };
  },
  myProducts: (token: string) => request<Product[]>('/api/sellers/me/products', { headers: bearer(token) }),
  addProduct: (token: string, product: NewProduct) => request<Product>('/api/sellers/me/products', post(product, bearer(token))),
  createSession: (token: string, title: string, products: { productId: number; stock: number }[]) =>
    request<{ sessionId: string }>('/api/sessions', post({ title, products }, bearer(token))),
  endSession: (token: string, sessionId: string) => request(`/api/sessions/${sessionId}/end`, post({}, bearer(token))),
  pin: (token: string, sessionId: string, productId: number | null) =>
    request<{ metadata: string; socket: boolean }>(`/api/sessions/${sessionId}/pin`, post({ productId }, bearer(token))),

  // Quản trị
  registerSeller: (adminToken: string, name: string) =>
    request<{ seller: SellerProfile; token: string }>('/api/sellers', post({ name }, { 'x-admin-token': adminToken })),
};

export const formatVnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';
