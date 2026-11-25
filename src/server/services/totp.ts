import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;

export const TOTP_ISSUER = 'Cleanbin';

function normalizeSecret(secret: string): string {
  return secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = normalizeSecret(secret);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(SECRET_BYTES));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

export function generateTotp(secret: string, timestampMs: number = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(decodeBase32(secret), counter);
}

function safeEqualCodes(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Returns the matched 30-second time step so callers can record it and prevent
// replaying the same 6-digit code within the acceptance window.
export function verifyTotpStep(
  secret: string,
  code: string,
  window: number = TOTP_WINDOW,
  nowMs: number = Date.now()
): number | null {
  const normalized = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;

  let key: Buffer;
  try {
    key = decodeBase32(secret);
  } catch {
    return null;
  }

  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateStep = counter + offset;
    if (safeEqualCodes(hotp(key, candidateStep), normalized)) {
      return candidateStep;
    }
  }
  return null;
}

export function verifyTotp(secret: string, code: string, window: number = TOTP_WINDOW): boolean {
  return verifyTotpStep(secret, code, window) !== null;
}

export function groupSecret(secret: string): string {
  return normalizeSecret(secret)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const params = new URLSearchParams({
    secret: normalizeSecret(secret),
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
