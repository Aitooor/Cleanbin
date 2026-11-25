import crypto from 'node:crypto';

const INVITE_TOKEN_BYTES = 32;
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export interface InviteToken {
  token: string;
  hash: string;
  expiresAt: string;
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateInviteToken(): InviteToken {
  const token = crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
  return {
    token,
    hash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };
}

export function buildSetupUrl(token: string, requestOrigin?: string): string {
  const base = (process.env.APP_URL?.trim() || requestOrigin || '').replace(/\/+$/, '');
  return `${base}/setup?token=${encodeURIComponent(token)}`;
}
