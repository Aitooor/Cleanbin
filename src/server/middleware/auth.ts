import type { Context } from 'hono';
import { getRawSessionToken, verifySessionToken, type SessionPayload } from '../services/auth.js';
import { authenticateApiToken } from '../services/apiTokens.js';
import { isSessionActive, touchSession } from '../services/sessions.js';

function extractBearerToken(c: Context): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

// Verifies either a revocable personal API token (`Authorization: Bearer cb_...`)
// OR a cryptographically signed cookie session backed by an active SQL row.
export async function getOptionalActiveSession(c: Context): Promise<SessionPayload | null> {
  const bearer = extractBearerToken(c);
  if (bearer !== null) {
    const tokenAuth = await authenticateApiToken(bearer);
    if (!tokenAuth) return null;
    return {
      email: tokenAuth.email,
      role: tokenAuth.role,
      sid: `tok:${tokenAuth.tokenId}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      isApiToken: true,
    };
  }

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

// Sensitive account/token/session endpoints require an interactive browser cookie
// session so a leaked CLI token can never mint new tokens or alter security settings.
export async function requireBrowserSession(c: Context): Promise<SessionPayload | Response> {
  const session = await getOptionalActiveSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized', message: 'Unauthorized' }, 401);
  }
  if (session.isApiToken) {
    return c.json(
      { error: 'Forbidden', message: 'Personal API tokens cannot manage account credentials or sessions' },
      403
    );
  }
  return session;
}

export async function requireAdmin(c: Context): Promise<SessionPayload | Response> {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;
  if (session.role !== 'admin') {
    return c.json({ error: 'Forbidden', message: 'Forbidden' }, 403);
  }
  return session;
}
