import { Hono } from 'hono';
import { getConfig } from '../config.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  clearChallengeState,
  recordChallengeFailure,
  setSessionCookie,
  verifyAuthChallenge,
} from '../services/auth.js';
import { createUserSession } from '../services/sessions.js';
import { buildOtpAuthUrl, groupSecret } from '../services/totp.js';
import {
  enableTotp,
  resolveInviteEmail,
  SETUP_PASSWORD_MIN_LENGTH,
  setUserPassword,
  startTotpSetup,
  UserNotFoundError,
  UserValidationError,
} from '../services/users.js';

export const setupRoutes = new Hono();

const setupLimiter = rateLimit({
  name: 'setup',
  windowMs: 5 * 60_000,
  limit: () => getConfig().rateLimit.authPer5Min,
});

setupRoutes.post('/api/setup/start', setupLimiter, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { token, challenge, password } = (body ?? {}) as Record<string, unknown>;
    let email: string | null = null;

    if (typeof token === 'string' && token) {
      email = await resolveInviteEmail(token);
      if (!email) {
        return c.json({ message: 'This invitation is invalid or has expired' }, 410);
      }
      if (typeof password !== 'string' || password.length < SETUP_PASSWORD_MIN_LENGTH) {
        return c.json(
          { message: `Password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters` },
          400
        );
      }
      await setUserPassword(email, password);
    } else if (typeof challenge === 'string' && challenge) {
      const payload = verifyAuthChallenge(challenge, 'setup');
      if (!payload) {
        return c.json({ message: 'This setup session has expired. Sign in again.' }, 400);
      }
      email = payload.email;
    } else {
      return c.json({ message: 'A token or challenge is required' }, 400);
    }

    const secret = await startTotpSetup(email);
    return c.json({
      email,
      secret,
      groupedSecret: groupSecret(secret),
      otpauthUrl: buildOtpAuthUrl(email, secret),
    });
  } catch (error) {
    if (error instanceof UserValidationError) {
      return c.json({ message: error.message }, 400);
    }
    if (error instanceof UserNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    return c.json({ message: 'Could not start the setup' }, 500);
  }
});

setupRoutes.post('/api/setup/complete', setupLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { token, challenge, code } = (body ?? {}) as Record<string, unknown>;

  if (typeof code !== 'string') {
    return c.json({ message: 'A verification code is required' }, 400);
  }

  let email: string | null = null;
  let challengeJti: string | undefined;

  if (typeof token === 'string' && token) {
    email = await resolveInviteEmail(token);
    if (!email) {
      return c.json({ message: 'This invitation is invalid or has expired' }, 410);
    }
  } else if (typeof challenge === 'string' && challenge) {
    const payload = verifyAuthChallenge(challenge, 'setup');
    if (!payload) {
      return c.json({ message: 'This setup session has expired. Sign in again.' }, 400);
    }
    email = payload.email;
    challengeJti = payload.jti;
  } else {
    return c.json({ message: 'A token or challenge is required' }, 400);
  }

  const state = await enableTotp(email, code);
  if (!state) {
    recordChallengeFailure(challengeJti);
    return c.json({ message: 'Invalid verification code' }, 401);
  }

  clearChallengeState(challengeJti);
  const session = await createUserSession(
    state.email,
    state.role,
    c.req.header('user-agent') ?? ''
  );
  setSessionCookie(c, state.email, state.role, session.id);

  return c.json({
    message: 'Two-factor authentication enabled',
    email: state.email,
    role: state.role,
  });
});
