import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { normalizeEmail } from '../../shared/validation.js';
import type { UserRole } from '../../shared/types.js';

export const MAX_SESSIONS_PER_USER = 20;
const REVOKED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

interface SessionRow {
  id: string;
  email: string;
  role: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface SessionRecord {
  id: string;
  email: string;
  role: UserRole;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at ?? null,
  };
}

export async function createUserSession(
  email: string,
  role: UserRole,
  userAgent: string
): Promise<SessionRecord> {
  const normalized = normalizeEmail(email);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - REVOKED_RETENTION_MS).toISOString();
  const id = crypto.randomUUID();
  const trimmedAgent = userAgent.slice(0, 400);

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.execute('DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?', [cutoffIso]);

    const active = await tx.query<SessionRow>(
      'SELECT * FROM sessions WHERE email = ? AND revoked_at IS NULL ORDER BY last_seen_at ASC',
      [normalized]
    );
    if (active.length >= MAX_SESSIONS_PER_USER) {
      const excess = active.slice(0, active.length - MAX_SESSIONS_PER_USER + 1);
      for (const item of excess) {
        await tx.execute('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso, item.id]);
      }
    }

    await tx.execute(
      `INSERT INTO sessions (id, email, role, user_agent, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [id, normalized, role, trimmedAgent, nowIso, nowIso]
    );
  });

  return {
    id,
    email: normalized,
    role,
    userAgent: trimmedAgent,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    revokedAt: null,
  };
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  if (!id) return null;
  const db = await getDb();
  const row = await db.queryOne<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
  return row ? toSessionRecord(row) : null;
}

export async function isSessionActive(id: string): Promise<boolean> {
  if (!id) return false;
  const record = await getSession(id);
  return !!record && !record.revokedAt;
}

export async function touchSession(id: string): Promise<void> {
  if (!id) return;
  const db = await getDb();
  const row = await db.queryOne<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
  if (!row || row.revoked_at) return;

  const now = Date.now();
  if (now - new Date(row.last_seen_at).getTime() < TOUCH_INTERVAL_MS) return;

  await db.execute('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [new Date(now).toISOString(), id]);
}

export async function listUserSessions(email: string): Promise<SessionRecord[]> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  const rows = await db.query<SessionRow>(
    'SELECT * FROM sessions WHERE email = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
    [normalized]
  );
  return rows.map(toSessionRecord);
}

export async function revokeSession(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const res = await db.execute(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [nowIso, id]
  );
  return res.changes > 0;
}

export async function revokeUserSessions(email: string): Promise<number> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const res = await db.execute(
    'UPDATE sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL',
    [nowIso, normalized]
  );
  return res.changes;
}
