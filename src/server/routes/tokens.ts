import { Hono } from 'hono';
import { requireBrowserSession } from '../middleware/auth.js';
import {
  ApiTokenLimitError,
  ApiTokenValidationError,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from '../services/apiTokens.js';
import { getUserPasteUsage, getUserVisibilityCounts } from '../services/pastes.js';
import { getServerSettings } from '../services/settings.js';

export const tokensRoutes = new Hono();

tokensRoutes.get('/api/tokens', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const [tokens, usage, counts, settings] = await Promise.all([
    listApiTokens(session.email),
    getUserPasteUsage(session.email),
    getUserVisibilityCounts(session.email),
    getServerSettings(),
  ]);

  const unlimited = session.role === 'admin';
  return c.json({
    tokens,
    usage: {
      pasteCount: usage.pasteCount,
      publicCount: counts.publicCount,
      privateCount: counts.privateCount,
      rawBytes: usage.rawBytes,
      storedBytes: usage.storedBytes,
      maxPastesPerUser: unlimited ? 0 : settings.maxPastesPerUser,
      maxPublicPastesPerUser: unlimited ? 0 : settings.maxPublicPastesPerUser,
      maxPrivatePastesPerUser: unlimited ? 0 : settings.maxPrivatePastesPerUser,
      maxStorageMbPerUser: unlimited ? 0 : settings.maxStorageMbPerUser,
    },
  });
});

tokensRoutes.post('/api/tokens', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.json().catch(() => ({}));
  const name = typeof (body as Record<string, unknown>)?.name === 'string'
    ? ((body as Record<string, unknown>).name as string)
    : '';

  try {
    const created = await createApiToken(session.email, name);
    return c.json(created, 201);
  } catch (error) {
    if (error instanceof ApiTokenValidationError) {
      return c.json({ message: error.message }, 400);
    }
    if (error instanceof ApiTokenLimitError) {
      return c.json({ message: error.message }, 403);
    }
    return c.json({ message: 'Failed to create API token' }, 500);
  }
});

tokensRoutes.delete('/api/tokens/:id', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const id = c.req.param('id') || '';
  const deleted = await revokeApiToken(session.email, id);
  if (!deleted) {
    return c.json({ message: 'Token not found' }, 404);
  }
  return c.json({ success: true });
});
