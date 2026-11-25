import { Hono } from 'hono';
import { getOptionalActiveSession, requireAdmin } from '../middleware/auth.js';
import { isMailerConfigured } from '../services/mailer.js';
import { compactAllPastes, getStorageStats } from '../services/pastes.js';
import { invalidateCache } from '../services/pastesCache.js';
import { getServerSettings, updateServerSettings } from '../services/settings.js';
import type { RegistrationMode } from '../../shared/types.js';

export const settingsRoutes = new Hono();

settingsRoutes.get('/api/settings', async (c) => {
  const [settings, session] = await Promise.all([
    getServerSettings(),
    getOptionalActiveSession(c),
  ]);

  if (session?.role === 'admin' && !session.isApiToken) {
    const storage = await getStorageStats();
    return c.json({
      ...settings,
      mailerConfigured: isMailerConfigured(),
      storage,
    });
  }

  return c.json({
    registrationMode: settings.registrationMode,
    requireEmailVerification: settings.requireEmailVerification && isMailerConfigured(),
  });
});

settingsRoutes.patch('/api/settings', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const body = await c.req.json().catch(() => ({}));
  const {
    registrationMode,
    requireEmailVerification,
    defaultUserDeleteLimit,
    maxPastesPerUser,
    maxPublicPastesPerUser,
    maxPrivatePastesPerUser,
    maxStorageMbPerUser,
  } = (body ?? {}) as Record<string, unknown>;

  const patch: {
    registrationMode?: RegistrationMode;
    requireEmailVerification?: boolean;
    defaultUserDeleteLimit?: number;
    maxPastesPerUser?: number;
    maxPublicPastesPerUser?: number;
    maxPrivatePastesPerUser?: number;
    maxStorageMbPerUser?: number;
  } = {};

  for (const [raw, field] of [
    [maxPublicPastesPerUser, 'maxPublicPastesPerUser'],
    [maxPrivatePastesPerUser, 'maxPrivatePastesPerUser'],
  ] as const) {
    if (raw === undefined) continue;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return c.json({ message: `${field} must be an integer >= 0 (0 = unlimited)` }, 400);
    }
    patch[field] = parsed;
  }

  if (registrationMode !== undefined) {
    if (registrationMode !== 'invite' && registrationMode !== 'open') {
      return c.json({ message: 'registrationMode must be "invite" or "open"' }, 400);
    }
    patch.registrationMode = registrationMode;
  }

  if (requireEmailVerification !== undefined) {
    if (typeof requireEmailVerification !== 'boolean') {
      return c.json({ message: 'requireEmailVerification must be a boolean' }, 400);
    }
    if (requireEmailVerification && !isMailerConfigured()) {
      return c.json(
        {
          message:
            'Email delivery (RESEND_API_KEY + MAIL_FROM) must be configured before requiring email verification.',
        },
        400
      );
    }
    patch.requireEmailVerification = requireEmailVerification;
  }

  if (defaultUserDeleteLimit !== undefined) {
    const parsed =
      typeof defaultUserDeleteLimit === 'number'
        ? defaultUserDeleteLimit
        : Number(defaultUserDeleteLimit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return c.json({ message: 'defaultUserDeleteLimit must be an integer >= 0' }, 400);
    }
    patch.defaultUserDeleteLimit = parsed;
  }

  if (maxPastesPerUser !== undefined) {
    const parsed = typeof maxPastesPerUser === 'number' ? maxPastesPerUser : Number(maxPastesPerUser);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return c.json({ message: 'maxPastesPerUser must be an integer >= 0 (0 = unlimited)' }, 400);
    }
    patch.maxPastesPerUser = parsed;
  }

  if (maxStorageMbPerUser !== undefined) {
    const parsed =
      typeof maxStorageMbPerUser === 'number' ? maxStorageMbPerUser : Number(maxStorageMbPerUser);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return c.json({ message: 'maxStorageMbPerUser must be a number >= 0 (0 = unlimited)' }, 400);
    }
    patch.maxStorageMbPerUser = parsed;
  }

  const updated = await updateServerSettings(patch);
  const storage = await getStorageStats();
  return c.json({
    ...updated,
    mailerConfigured: isMailerConfigured(),
    storage,
  });
});

settingsRoutes.post('/api/settings/compact', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const storage = await compactAllPastes();
  invalidateCache();
  return c.json({ storage });
});
