import crypto from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConfig } from '../config.js';
import type { SessionRole } from '../../shared/types.js';

export const SESSION_COOKIE_NAME = 'auth-token';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_FAILURES = 5;

export interface SessionPayload {
  email: string;
  role: SessionRole;
  sid: string;
  exp: number;
  isApiToken?: boolean;
}

export type AuthChallengePurpose = 'totp' | 'setup';

export interface AuthChallengePayload {
  jti: string;
  email: string;
  purpose: AuthChallengePurpose;
  exp: number;
}

// Tracks failed verification attempts per challenge ID (jti) so brute-forcing
// a 6-digit TOTP code burns the challenge after 5 wrong tries.
const challengeFailures = new Map<string, { count: number; expiresAt: number }>();

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured');
  }
  return secret;
}

function signEncodedPayload(encodedPayload: string): string {
  const secret = getAuthSecret();
  return toBase64Url(crypto.createHmac('sha256', secret).update(encodedPayload).digest());
}

function verifySignedPayload(token: string | undefined | null): string | null {
  if (!token) return null;
  let secret: string;
  try {
    secret = getAuthSecret();
  } catch {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  let provided: Buffer;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  return encodedPayload;
}

export function createSessionToken(email: string, role: SessionRole, sid: string): string {
  const payload: SessionPayload = {
    email,
    role,
    sid,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signEncodedPayload(encodedPayload)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  const encodedPayload = verifySignedPayload(token);
  if (!encodedPayload) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf-8')) as SessionPayload;
    if (!payload || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAuthChallenge(email: string, purpose: AuthChallengePurpose): string {
  const payload: AuthChallengePayload = {
    jti: crypto.randomUUID(),
    email,
    purpose,
    exp: Math.floor(Date.now() / 1000) + AUTH_CHALLENGE_TTL_SECONDS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signEncodedPayload(encodedPayload)}`;
}

function pruneChallengeFailures(now: number): void {
  for (const [key, entry] of challengeFailures) {
    if (entry.expiresAt <= now) challengeFailures.delete(key);
  }
}

export function verifyAuthChallenge(
  token: string | undefined | null,
  purpose?: AuthChallengePurpose
): AuthChallengePayload | null {
  const encodedPayload = verifySignedPayload(token);
  if (!encodedPayload) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf-8')) as AuthChallengePayload;
    if (!payload || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) return null;
    if (purpose && payload.purpose !== purpose) return null;

    if (payload.jti) {
      pruneChallengeFailures(Date.now());
      const fail = challengeFailures.get(payload.jti);
      if (fail && fail.count >= MAX_CHALLENGE_FAILURES) return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function recordChallengeFailure(jti: string | undefined): void {
  if (!jti) return;
  const now = Date.now();
  pruneChallengeFailures(now);
  const current = challengeFailures.get(jti);
  if (current) {
    current.count += 1;
  } else {
    challengeFailures.set(jti, { count: 1, expiresAt: now + AUTH_CHALLENGE_TTL_SECONDS * 1000 });
  }
}

export function clearChallengeState(jti: string | undefined): void {
  if (!jti) return;
  challengeFailures.set(jti, {
    count: MAX_CHALLENGE_FAILURES,
    expiresAt: Date.now() + AUTH_CHALLENGE_TTL_SECONDS * 1000,
  });
}

function shouldUseSecureCookie(c: Context): boolean {
  if (process.env.COOKIE_SECURE === '0') return false;
  if (process.env.COOKIE_SECURE === '1') return true;
  const host = resolveHost(c).split(':')[0].toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return getConfig().nodeEnv === 'production' || resolveOrigin(c).startsWith('https://');
}

export function setSessionCookie(c: Context, email: string, role: SessionRole, sid: string): void {
  const token = createSessionToken(email, role, sid);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: shouldUseSecureCookie(c),
    sameSite: 'Lax',
    path: '/',
  });
}

export function getRawSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

export function resolveHost(c: Context): string {
  const trustProxy = getConfig().trustProxy;
  if (trustProxy) {
    const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
    if (forwardedHost) return forwardedHost;
  }
  const hostHeader = c.req.header('host')?.trim();
  if (hostHeader) return hostHeader;
  try {
    return new URL(c.req.url).host || 'localhost';
  } catch {
    return 'localhost';
  }
}

export function resolveOrigin(c: Context): string {
  const configured = process.env.PASSKEY_ORIGIN?.trim();
  if (configured) return configured;

  const trustProxy = getConfig().trustProxy;
  const forwardedProto = trustProxy ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() : undefined;
  let proto = forwardedProto;
  if (!proto) {
    try {
      proto = new URL(c.req.url).protocol.replace(':', '') || 'http';
    } catch {
      proto = 'http';
    }
  }
  return `${proto}://${resolveHost(c)}`;
}

export function resolveRpID(c: Context): string {
  const configured = process.env.PASSKEY_RP_ID?.trim();
  if (configured) return configured;
  return resolveHost(c).split(':')[0];
}

export function getClientIp(c: Context): string {
  if (getConfig().trustProxy) {
    const cfIp = c.req.header('cf-connecting-ip')?.trim();
    if (cfIp) return cfIp;
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  const realIp = c.req.header('x-real-ip')?.trim();
  return realIp || 'local';
}
