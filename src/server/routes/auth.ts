import { Hono } from 'hono';
import { getConfig } from '../config.js';
import { getOptionalActiveSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  clearChallengeState,
  createAuthChallenge,
  recordChallengeFailure,
  resolveRpID,
  setSessionCookie,
  verifyAuthChallenge,
} from '../services/auth.js';
import { hasPasskey } from '../services/passkeys.js';
import { createUserSession } from '../services/sessions.js';
import {
  getAccountState,
  getPermanentDeleteLimit,
  verifyAndConsumeTotp,
  verifyUserCredentials,
} from '../services/users.js';

export const authRoutes = new Hono();

const loginLimiter = rateLimit({
  name: 'auth-login',
  windowMs: 5 * 60_000,
  limit: () => getConfig().rateLimit.authPer5Min,
});

const totpLimiter = rateLimit({
  name: 'auth-2fa',
  windowMs: 5 * 60_000,
  limit: () => getConfig().rateLimit.totpPer5Min,
});

authRoutes.get('/api/auth', async (c) => {
  const session = await getOptionalActiveSession(c);
  if (!session) {
    return c.json({
      authenticated: false,
      email: null,
      role: null,
      permanentDeleteLimit: null,
    });
  }

  const limit =
    session.role === 'admin' ? null : await getPermanentDeleteLimit(session.email);

  return c.json({
    authenticated: true,
    email: session.email,
    role: session.role,
    permanentDeleteLimit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
  });
});

authRoutes.post('/api/auth', loginLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ message: 'Invalid credentials' }, 401);
  }

  if (await hasPasskey(email, resolveRpID(c))) {
    return c.json(
      {
        message:
          'Password login is disabled on this domain because a passkey is registered. Use the passkey or remove it from the dashboard.',
      },
      403
    );
  }

  const account = await getAccountState(email);
  if (account?.status === 'invited') {
    return c.json(
      {
        message: 'This account is pending activation. Finish the invitation from the setup link.',
      },
      403
    );
  }

  const auth = await verifyUserCredentials(email, password);
  if (!auth) {
    return c.json({ message: 'Invalid credentials' }, 401);
  }

  if (account?.totpEnabled) {
    return c.json({
      totpRequired: true,
      challenge: createAuthChallenge(auth.email, 'totp'),
    });
  }

  return c.json({
    setupRequired: true,
    challenge: createAuthChallenge(auth.email, 'setup'),
  });
});

authRoutes.post('/api/auth/2fa', totpLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { challenge, code } = (body ?? {}) as Record<string, unknown>;

  if (typeof challenge !== 'string' || typeof code !== 'string') {
    return c.json({ message: 'Challenge and code are required' }, 400);
  }

  const payload = verifyAuthChallenge(challenge, 'totp');
  if (!payload) {
    return c.json({ message: 'This challenge has expired. Sign in again.' }, 400);
  }

  const ok = await verifyAndConsumeTotp(payload.email, code);
  if (!ok) {
    recordChallengeFailure(payload.jti);
    return c.json({ message: 'Invalid verification code' }, 401);
  }

  const account = await getAccountState(payload.email);
  if (!account) {
    return c.json({ message: 'Invalid verification code' }, 401);
  }

  clearChallengeState(payload.jti);
  const session = await createUserSession(
    account.email,
    account.role,
    c.req.header('user-agent') ?? ''
  );
  setSessionCookie(c, account.email, account.role, session.id);

  return c.json({
    message: 'Login successful',
    email: account.email,
    role: account.role,
  });
});
