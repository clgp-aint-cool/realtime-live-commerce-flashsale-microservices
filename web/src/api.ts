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
  avatarUrl: string | null;
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
  seller: { id: string; name: string; avatarUrl: string | null };
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
  avatarUrl: string | null;
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

// URL upload do server ký (presigned PUT lên S3 của CMC Cloud). Ảnh không đi qua backend, không lưu vào DB.
export interface ImageUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  publicUrl: string;
  expiresIn: number;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
const put = (body: unknown, headers: Record<string, string>): RequestInit => ({ ...post(body, headers), method: 'PUT' });
const fileInfo = (file: File) => ({ contentType: file.type, size: file.size });

// Xin URL ký từ backend rồi PUT file thẳng lên S3. Trả về URL công khai để lưu vào sản phẩm/hồ sơ.
export async function uploadImage(file: File, presign: (file: File) => Promise<ImageUpload>): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new ApiError(400, undefined, 'Chỉ nhận ảnh JPEG, PNG hoặc WebP');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, undefined, `Ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  const target = await presign(file);
  const res = await fetch(target.uploadUrl, { method: target.method, headers: target.headers, body: file }).catch(() => null);
  if (!res?.ok) throw new ApiError(res?.status ?? 0, undefined, 'Upload ảnh lên kho lưu trữ thất bại');
  return target.publicUrl;
}

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
  userAvatarUpload: (token: string, file: File) => request<ImageUpload>('/api/auth/me/avatar/upload', post(fileInfo(file), bearer(token))),
  setUserAvatar: (token: string, avatarUrl: string | null) => request<User>('/api/auth/me/avatar', put({ avatarUrl }, bearer(token))),

  // Người bán (Bearer token cấp khi đăng ký)
  me: (token: string) => request<SellerProfile>('/api/sellers/me', { headers: bearer(token) }),
  streamKey: (token: string) => request<{ streamKey: string }>('/api/sellers/me/stream-key', { headers: bearer(token) }),
  resetStreamKey: (token: string) => request<{ streamKey: string }>('/api/sellers/me/stream-key/reset', post({}, bearer(token))),
  obsProfile: async (token: string) => {
    const res = await raw('/api/sellers/me/obs-profile', { headers: bearer(token) });
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'obs-profile.zip';
    return { name, blob: await res.blob() };
  },
  sellerUpload: (token: string, kind: 'avatar' | 'product', file: File) =>
    request<ImageUpload>('/api/sellers/me/uploads', post({ kind, ...fileInfo(file) }, bearer(token))),
  setSellerAvatar: (token: string, avatarUrl: string | null) =>
    request<SellerProfile>('/api/sellers/me/avatar', put({ avatarUrl }, bearer(token))),
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
