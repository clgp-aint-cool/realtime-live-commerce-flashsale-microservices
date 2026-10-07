import { createHmac, timingSafeEqual } from 'node:crypto';

// Bản sao từ auth-service (dùng chung JWT_SECRET). order-service chỉ cần verifyJwt.
export interface UserClaims {
  sub: string; // id người dùng, dạng usr_<uuid>
  name: string; // tên hiển thị
  iat: number;
  exp: number;
}

const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

const sign = (secret: string, input: string) => createHmac('sha256', secret).update(input).digest();

export function signJwt(secret: string, claims: Omit<UserClaims, 'iat' | 'exp'>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = `${HEADER}.${b64(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }))}`;
  return `${body}.${b64(sign(secret, body))}`;
}

export function verifyJwt(secret: string, token: string): UserClaims | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature || header !== HEADER) return null;
  const expected = sign(secret, `${header}.${payload}`);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as UserClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}
