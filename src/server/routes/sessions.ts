import { Hono } from 'hono';
import { requireBrowserSession } from '../middleware/auth.js';
import { clearSessionCookie } from '../services/auth.js';
import {
  getSession,
  listUserSessions,
  revokeSession,
  type SessionRecord,
} from '../services/sessions.js';
import type { DashboardSessionInfo } from '../../shared/types.js';

export const sessionsRoutes = new Hono();

function toPublicSession(record: SessionRecord, currentId: string): DashboardSessionInfo {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    userAgent: record.userAgent,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    current: record.id === currentId,
  };
}

sessionsRoutes.get('/api/sessions', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const records = await listUserSessions(session.email);
  return c.json({
    currentId: session.sid,
    sessions: records.map((record) => toPublicSession(record, session.sid)),
  });
});

sessionsRoutes.delete('/api/sessions', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  await revokeSession(session.sid);
  clearSessionCookie(c);
  return c.json({ message: 'Signed out' });
});

sessionsRoutes.delete('/api/sessions/:id', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const id = c.req.param('id');
  if (!id) {
    return c.json({ message: 'Session id is required' }, 400);
  }

  const record = await getSession(id);
  if (!record) {
    return c.json({ message: 'Session not found' }, 404);
  }

  const ownsSession = record.email === session.email;
  if (!ownsSession && session.role !== 'admin') {
    return c.json({ message: 'Forbidden' }, 403);
  }

  const revoked = await revokeSession(id);
  if (id === session.sid) {
    clearSessionCookie(c);
  }

  return c.json({ message: revoked ? 'Session revoked' : 'Session already revoked' });
});
