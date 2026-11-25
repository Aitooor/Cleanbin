import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { getAccountState } from './users.js';
import { normalizeEmail } from '../../shared/validation.js';
import type { ApiTokenInfo, UserRole } from '../../shared/types.js';

export const MAX_API_TOKENS_PER_USER = 20;
export const MAX_API_TOKEN_NAME_LENGTH = 80;

interface ApiTokenRow {
  id: string;
  email: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export class ApiTokenValidationError extends Error {}
export class ApiTokenLimitError extends Error {}

function hashApiToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function rowToInfo(row: ApiTokenRow): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

export async function listApiTokens(email: string): Promise<ApiTokenInfo[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const db = await getDb();
  const rows = await db.query<ApiTokenRow>(
    'SELECT * FROM api_tokens WHERE email = ? ORDER BY created_at DESC',
    [normalized]
  );
  return rows.map(rowToInfo);
}

export async function createApiToken(
  email: string,
  rawName: string
): Promise<{ token: string; item: ApiTokenInfo }> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new ApiTokenValidationError('Valid account email is required');

  const name = rawName.trim();
  if (!name) throw new ApiTokenValidationError('Token label is required');
  if (name.length > MAX_API_TOKEN_NAME_LENGTH) {
    throw new ApiTokenValidationError(`Token label cannot exceed ${MAX_API_TOKEN_NAME_LENGTH} characters`);
  }

  const rawToken = `cb_${crypto.randomBytes(24).toString('base64url')}`;
  const tokenPrefix = rawToken.slice(0, 10);
  const tokenHash = hashApiToken(rawToken);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const db = await getDb();
  await db.transaction(async (tx) => {
    const countRow = await tx.queryOne<{ total: number | string }>(
      'SELECT COUNT(*) AS total FROM api_tokens WHERE email = ?',
      [normalized]
    );
    if (Number(countRow?.total ?? 0) >= MAX_API_TOKENS_PER_USER) {
      throw new ApiTokenLimitError(`Maximum of ${MAX_API_TOKENS_PER_USER} active API tokens reached`);
    }

    await tx.execute(
      `INSERT INTO api_tokens (id, email, name, token_prefix, token_hash, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [id, normalized, name, tokenPrefix, tokenHash, createdAt]
    );
  });

  return {
    token: rawToken,
    item: {
      id,
      name,
      tokenPrefix,
      createdAt,
      lastUsedAt: null,
    },
  };
}

export async function revokeApiToken(email: string, id: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized || !id) return false;
  const db = await getDb();
  const res = await db.execute('DELETE FROM api_tokens WHERE id = ? AND email = ?', [id, normalized]);
  return res.changes > 0;
}

export async function revokeUserApiTokens(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const db = await getDb();
  await db.execute('DELETE FROM api_tokens WHERE email = ?', [normalized]);
}

export async function authenticateApiToken(
  rawToken: string
): Promise<{ email: string; role: UserRole; tokenId: string } | null> {
  const trimmed = rawToken.trim();
  if (!trimmed.startsWith('cb_') || trimmed.length < 20 || trimmed.length > 128) {
    return null;
  }

  const hash = hashApiToken(trimmed);
  const db = await getDb();
  const row = await db.queryOne<ApiTokenRow>(
    'SELECT * FROM api_tokens WHERE token_hash = ?',
    [hash]
  );
  if (!row) return null;

  const account = await getAccountState(row.email);
  if (!account || account.status !== 'active') {
    return null;
  }

  const nowMs = Date.now();
  const lastMs = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (!lastMs || Number.isNaN(lastMs) || nowMs - lastMs >= 60_000) {
    await db
      .execute('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [
        new Date(nowMs).toISOString(),
        row.id,
      ])
      .catch(() => {});
  }

  return {
    email: account.email,
    role: account.role,
    tokenId: row.id,
  };
}
