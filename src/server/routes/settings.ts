import { Hono } from 'hono';
import { getOptionalActiveSession, requireAdmin } from '../middleware/auth.js';
import { getServerSettings, updateServerSettings } from '../services/settings.js';
import type { RegistrationMode } from '../../shared/types.js';

export const settingsRoutes = new Hono();

settingsRoutes.get('/api/settings', async (c) => {
  const [settings, session] = await Promise.all([
    getServerSettings(),
    getOptionalActiveSession(c),
  ]);

  if (session?.role === 'admin') {
    return c.json(settings);
  }

  return c.json({
    registrationMode: settings.registrationMode,
  });
});

settingsRoutes.patch('/api/settings', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const body = await c.req.json().catch(() => ({}));
  const { registrationMode, defaultUserDeleteLimit } = (body ?? {}) as Record<string, unknown>;

  const patch: { registrationMode?: RegistrationMode; defaultUserDeleteLimit?: number } = {};

  if (registrationMode !== undefined) {
    if (registrationMode !== 'invite' && registrationMode !== 'open') {
      return c.json({ message: 'registrationMode must be "invite" or "open"' }, 400);
    }
    patch.registrationMode = registrationMode;
  }

  if (defaultUserDeleteLimit !== undefined) {
    const parsed = typeof defaultUserDeleteLimit === 'number' ? defaultUserDeleteLimit : Number(defaultUserDeleteLimit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return c.json({ message: 'defaultUserDeleteLimit must be an integer >= 0' }, 400);
    }
    patch.defaultUserDeleteLimit = parsed;
  }

  const updated = await updateServerSettings(patch);
  return c.json(updated);
});
