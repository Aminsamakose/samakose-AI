import crypto from 'node:crypto';
import { env } from './env';

/* ---------- passwords: scrypt with per-user salt ---------- */
const N = 1 << 15, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw: string, salt: Buffer, n = N) => new Promise<Buffer>((res, rej) =>
  crypto.scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N: n, r: R, p: P, maxmem: 128 * n * R * 2 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the work, so a missing user takes as long as a wrong password.
  const parts = (stored ?? '').split('$');
  const salt = parts[0] === 'scrypt' ? Buffer.from(parts[2], 'base64') : crypto.randomBytes(16);
  const n = parts[0] === 'scrypt' ? Number(parts[1]) : N;
  const expected = parts[0] === 'scrypt' ? Buffer.from(parts[3], 'base64') : crypto.randomBytes(KEYLEN);
  const key = await scrypt(pw, salt, n);
  return !!stored && key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const COMMON = ['password1234', 'password12345', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'samakose1234', 'welcome12345', 'administrator'];
export function passwordProblems(pw: string, email?: string, name?: string): string[] {
  const p: string[] = [];
  if (pw.length < 12) p.push('Use at least 12 characters');
  if (pw.length > 128) p.push('Use at most 128 characters');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) p.push('Include letters and numbers');
  if (COMMON.includes(pw.toLowerCase())) p.push('That password is too common');
  const flat = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const local = (email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (local.length >= 4 && flat.includes(local)) p.push('Do not include your email name');
  const nm = (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (nm.length >= 4 && flat.includes(nm)) p.push('Do not include your name');
  return p;
}

/* ---------- tokens ---------- */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
export const hmacHex = (algo: 'sha256' | 'sha512', key: string, data: string | Buffer) => crypto.createHmac(algo, key).update(data).digest('hex');
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- encryption at rest for small secrets (MFA seeds) ---------- */
const key = () => crypto.createHash('sha256').update('enc:' + env.sessionSecret).digest();
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function decrypt(blob: string): string {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

/* ---------- TOTP (RFC 6238) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totp(secret, at + w * 30_000), c));
}
/* ---------- Recovery codes (one-time, shown once, stored as hashes) ---------- */
const RC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const RECOVERY_CODE_COUNT = 10;
export function newRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10); let s = '';
    for (const x of b) s += RC[x % 32];
    return s.slice(0, 5) + '-' + s.slice(5);
  });
}
export const isRecoveryCode = (s: string) => /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(s.trim());
export const hashRecoveryCode = (s: string) => sha256('recovery:' + s.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
export const otpauthUrl = (email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent('Business Doctor:' + email)}?secret=${secret}&issuer=Business%20Doctor&digits=6&period=30`;
