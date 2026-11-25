import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.js';
import { resolveOrigin } from '../services/auth.js';
import { buildSetupUrl } from '../services/invites.js';
import { sendInvitationEmail, sendPasswordResetEmail } from '../services/mailer.js';
import { deletePasskey, hasPasskey } from '../services/passkeys.js';
import { revokeUserApiTokens } from '../services/apiTokens.js';
import { getAllUsersPasteUsage } from '../services/pastes.js';
import { revokeUserSessions } from '../services/sessions.js';
import {
  createUser,
  deleteUser,
  disableTotp,
  ImmutableUserError,
  issueInviteToken,
  issuePasswordResetToken,
  listUsers,
  PASSWORD_MIN_LENGTH,
  updateUser,
  UserExistsError,
  UserNotFoundError,
  UserValidationError,
  type UpdateUserPatch,
} from '../services/users.js';
import { isValidEmail } from '../../shared/validation.js';
import type { UserRole } from '../../shared/types.js';

export const usersRoutes = new Hono();

function parseRole(value: unknown): UserRole | null {
  return value === 'admin' || value === 'user' ? value : null;
}

function parseLimit(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

usersRoutes.get('/api/users', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const [users, usageByOwner] = await Promise.all([listUsers(), getAllUsersPasteUsage()]);
  const withDetails = await Promise.all(
    users.map(async (user) => {
      const usage = user.email ? usageByOwner.get(user.email.toLowerCase()) : undefined;
      return {
        ...user,
        hasPasskey: user.email ? await hasPasskey(user.email) : false,
        pasteCount: usage?.pasteCount ?? 0,
        storedBytes: usage?.storedBytes ?? 0,
      };
    })
  );
  return c.json(withDetails);
});

usersRoutes.post('/api/users', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const body = await c.req.json().catch(() => ({}));
  const { email, role, permanentDeleteLimit } = (body ?? {}) as Record<string, unknown>;

  if (!isValidEmail(email)) {
    return c.json({ message: 'A valid email is required' }, 400);
  }
  const parsedRole = parseRole(role);
  if (!parsedRole) {
    return c.json({ message: 'Role must be "admin" or "user"' }, 400);
  }
  const parsedLimit = permanentDeleteLimit === undefined ? 0 : parseLimit(permanentDeleteLimit);
  if (parsedLimit === null) {
    return c.json({ message: 'permanentDeleteLimit must be an integer greater than or equal to 0' }, 400);
  }

  try {
    const { user, inviteToken } = await createUser({
      email,
      role: parsedRole,
      permanentDeleteLimit: parsedLimit,
    });

    let emailSent = false;
    let setupUrl: string | undefined;
    if (inviteToken) {
      const url = buildSetupUrl(inviteToken, resolveOrigin(c));
      const delivery = await sendInvitationEmail(user.email, url);
      emailSent = delivery.sent;
      if (!delivery.sent) setupUrl = url;
    }

    return c.json(
      {
        ...user,
        emailSent,
        ...(setupUrl ? { setupUrl } : {}),
      },
      201
    );
  } catch (error) {
    if (error instanceof UserExistsError) {
      return c.json({ message: error.message }, 409);
    }
    if (error instanceof UserValidationError) {
      return c.json({ message: error.message }, 400);
    }
    return c.json({ message: 'Internal server error' }, 500);
  }
});

usersRoutes.patch('/api/users/:email', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const email = decodeURIComponent(c.req.param('email') || '').trim();
  if (!email) {
    return c.json({ message: 'Email is required' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const { action, role, permanentDeleteLimit, password } = (body ?? {}) as Record<string, unknown>;

  try {
    if (action === 'resend-invite') {
      const inviteToken = await issueInviteToken(email);
      const url = buildSetupUrl(inviteToken, resolveOrigin(c));
      const delivery = await sendInvitationEmail(email, url);
      return c.json({
        emailSent: delivery.sent,
        ...(delivery.sent ? {} : { setupUrl: url }),
      });
    }

    if (action === 'remove-passkey') {
      await deletePasskey(email);
      return c.json({ message: 'Passkey removed' });
    }

    if (action === 'reset-password') {
      const token = await issuePasswordResetToken(email);
      await disableTotp(email);
      await deletePasskey(email);
      await revokeUserSessions(email);
      await revokeUserApiTokens(email);

      const url = buildSetupUrl(token, resolveOrigin(c));
      const delivery = await sendPasswordResetEmail(email, url);
      return c.json({
        emailSent: delivery.sent,
        ...(delivery.sent ? {} : { setupUrl: url }),
      });
    }

    if (action === 'reset-2fa') {
      await disableTotp(email);
      return c.json({ message: 'Two-factor authentication reset' });
    }

    const patch: UpdateUserPatch = {};
    if (role !== undefined) {
      const parsedRole = parseRole(role);
      if (!parsedRole) return c.json({ message: 'Role must be "admin" or "user"' }, 400);
      patch.role = parsedRole;
    }
    if (permanentDeleteLimit !== undefined) {
      const parsedLimit = parseLimit(permanentDeleteLimit);
      if (parsedLimit === null) {
        return c.json({ message: 'permanentDeleteLimit must be an integer greater than or equal to 0' }, 400);
      }
      patch.permanentDeleteLimit = parsedLimit;
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        return c.json({ message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` }, 400);
      }
      patch.password = password;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ message: 'No changes provided' }, 400);
    }

    const updated = await updateUser(email, patch);
    return c.json(updated);
  } catch (error) {
    if (error instanceof ImmutableUserError) return c.json({ message: error.message }, 403);
    if (error instanceof UserNotFoundError) return c.json({ message: error.message }, 404);
    if (error instanceof UserValidationError) return c.json({ message: error.message }, 400);
    return c.json({ message: 'Internal server error' }, 500);
  }
});

usersRoutes.delete('/api/users/:email', async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;

  const email = decodeURIComponent(c.req.param('email') || '').trim();
  if (!email) {
    return c.json({ message: 'Email is required' }, 400);
  }

  try {
    await deleteUser(email);
    await deletePasskey(email);
    await revokeUserSessions(email);
    await revokeUserApiTokens(email);
    return c.json({ message: 'User deleted' });
  } catch (error) {
    if (error instanceof ImmutableUserError) return c.json({ message: error.message }, 403);
    if (error instanceof UserNotFoundError) return c.json({ message: error.message }, 404);
    return c.json({ message: 'Internal server error' }, 500);
  }
});
