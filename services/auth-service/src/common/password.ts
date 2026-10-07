import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'node:crypto';

// scrypt (có sẵn trong Node): lưu dạng scrypt$N$r$p$salt$hash để sau này tăng tham số vẫn kiểm tra được mật khẩu cũ.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

const derive = (password: string, salt: Buffer, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hash giả để thời gian phản hồi giống nhau dù username có tồn tại hay không.
export const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));
