import type { Context } from 'hono';
import { getRawSessionToken, verifySessionToken, type SessionPayload } from '../services/auth.js';
import { isSessionActive, touchSession } from '../services/sessions.js';

// Verifies BOTH the cryptographic signature AND that the session record has not
// been revoked in SQL. Revoked cookies immediately stop working everywhere.
export async function getOptionalActiveSession(c: Context): Promise<SessionPayload | null> {
  const token = getRawSessionToken(c);
  const parsed = verifySessionToken(token);
  if (!parsed) return null;
  if (!(await isSessionActive(parsed.sid))) return null;
  await touchSession(parsed.sid);
  return parsed;
}

export async function requireSession(c: Context): Promise<SessionPayload | Response> {
  const session = await getOptionalActiveSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized', message: 'Unauthorized' }, 401);
  }
  return session;
}

export async function requireAdmin(c: Context): Promise<SessionPayload | Response> {
  const session = await getOptionalActiveSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized', message: 'Unauthorized' }, 401);
  }
  if (session.role !== 'admin') {
    return c.json({ error: 'Forbidden', message: 'Forbidden' }, 403);
  }
  return session;
}
