import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import type { SqlAdapter } from '../db/adapter.js';
import { generateInviteToken, hashInviteToken } from './invites.js';
import { generateTotpSecret, verifyTotpStep } from './totp.js';
import { normalizeEmail } from '../../shared/validation.js';
import type { UserRole, UserStatus } from '../../shared/types.js';

const BCRYPT_ROUNDS = 10;
export const PASSWORD_MIN_LENGTH = 8;
export const SETUP_PASSWORD_MIN_LENGTH = 10;

interface UserRow {
  email: string;
  password_hash: string;
  role: string;
  permanent_delete_limit: number;
  created_at: string;
  status: string;
  totp_secret: string | null;
  totp_enabled_at: string | null;
  last_totp_step: number | string | null;
  invite_token_hash: string | null;
  invite_expires_at: string | null;
}

export interface PublicUser {
  email: string;
  role: UserRole;
  permanentDeleteLimit: number;
  createdAt: string;
  status: UserStatus;
  totpEnabled: boolean;
  invitePending: boolean;
  immutable?: boolean;
}

export interface CreateUserInput {
  email: string;
  password?: string;
  role: UserRole;
  permanentDeleteLimit: number;
}

export interface CreateUserResult {
  user: PublicUser;
  inviteToken: string | null;
}

export interface UpdateUserPatch {
  role?: UserRole;
  permanentDeleteLimit?: number;
  password?: string;
}

export interface AuthenticatedUser {
  email: string;
  role: UserRole;
}

export interface AccountAuthState {
  email: string;
  role: UserRole;
  status: UserStatus;
  totpEnabled: boolean;
  invitePending: boolean;
}

export class UserValidationError extends Error {}
export class UserExistsError extends Error {}
export class UserNotFoundError extends Error {}
export class ImmutableUserError extends Error {}

function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function isEnvAdmin(email: string): boolean {
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  return !!envEmail && normalizeEmail(envEmail) === normalizeEmail(email);
}

function rowToPublicUser(row: UserRow): PublicUser {
  const role: UserRole = row.role === 'admin' ? 'admin' : 'user';
  const status: UserStatus = row.status === 'invited' ? 'invited' : 'active';
  return {
    email: row.email,
    role,
    permanentDeleteLimit: Number(row.permanent_delete_limit ?? 0),
    createdAt: row.created_at,
    status,
    totpEnabled: !!row.totp_enabled_at,
    invitePending: status === 'invited',
  };
}

function envAdminPublicUser(totpEnabled: boolean): PublicUser {
  return {
    email: process.env.ADMIN_EMAIL?.trim() || '',
    role: 'admin',
    permanentDeleteLimit: 0,
    createdAt: new Date(0).toISOString(),
    status: 'active',
    totpEnabled,
    invitePending: false,
    immutable: true,
  };
}

async function ensureEnvAdminRecord(tx: SqlAdapter, normalizedEmail: string): Promise<UserRow | null> {
  const existing = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) return existing;
  if (!isEnvAdmin(normalizedEmail)) return null;

  const nowIso = new Date().toISOString();
  await tx.execute(
    `INSERT INTO users (
      email, password_hash, role, permanent_delete_limit, created_at, status,
      totp_secret, totp_enabled_at, last_totp_step, invite_token_hash, invite_expires_at
    ) VALUES (?, '', 'admin', 0, ?, 'active', NULL, NULL, NULL, NULL, NULL)`,
    [normalizedEmail, nowIso]
  );
  return tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
}

export async function listUsers(): Promise<PublicUser[]> {
  const db = await getDb();
  const rows = await db.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC');
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  const envNormalized = envEmail ? normalizeEmail(envEmail) : '';
  const envRow = envNormalized ? rows.find((r) => r.email === envNormalized) : undefined;

  const list = rows
    .filter((r) => !(envNormalized && r.email === envNormalized))
    .map(rowToPublicUser);

  if (envEmail) {
    list.unshift(envAdminPublicUser(!!envRow?.totp_enabled_at));
  }
  return list;
}

export async function getUser(email: string): Promise<PublicUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = await getDb();
  const row = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);

  if (isEnvAdmin(normalized)) {
    return envAdminPublicUser(!!row?.totp_enabled_at);
  }
  return row ? rowToPublicUser(row) : null;
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  if (!email) throw new UserValidationError('Email is required');
  if (isEnvAdmin(email)) throw new UserExistsError('This email is reserved');
  if (input.role !== 'admin' && input.role !== 'user') {
    throw new UserValidationError('Role must be "admin" or "user"');
  }
  if (!Number.isInteger(input.permanentDeleteLimit) || input.permanentDeleteLimit < 0) {
    throw new UserValidationError('permanentDeleteLimit must be an integer greater than or equal to 0');
  }

  const hasPassword = typeof input.password === 'string' && input.password.length > 0;
  if (hasPassword && (input.password as string).length < PASSWORD_MIN_LENGTH) {
    throw new UserValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }

  const passwordHash = hasPassword ? await bcrypt.hash(input.password as string, BCRYPT_ROUNDS) : '';
  const invite = hasPassword ? null : generateInviteToken();
  const createdAt = new Date().toISOString();
  const status: UserStatus = hasPassword ? 'active' : 'invited';

  const db = await getDb();
  await db.transaction(async (tx) => {
    const existing = await tx.queryOne<{ email: string }>('SELECT email FROM users WHERE email = ?', [email]);
    if (existing) {
      throw new UserExistsError('A user with this email already exists');
    }
    await tx.execute(
      `INSERT INTO users (
        email, password_hash, role, permanent_delete_limit, created_at, status,
        totp_secret, totp_enabled_at, last_totp_step, invite_token_hash, invite_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [
        email,
        passwordHash,
        input.role,
        input.permanentDeleteLimit,
        createdAt,
        status,
        invite ? invite.hash : null,
        invite ? invite.expiresAt : null,
      ]
    );
  });

  return {
    user: {
      email,
      role: input.role,
      permanentDeleteLimit: input.permanentDeleteLimit,
      createdAt,
      status,
      totpEnabled: false,
      invitePending: status === 'invited',
    },
    inviteToken: invite ? invite.token : null,
  };
}

export async function updateUser(email: string, patch: UpdateUserPatch): Promise<PublicUser> {
  const normalized = normalizeEmail(email);
  if (isEnvAdmin(normalized)) {
    throw new ImmutableUserError('The environment administrator cannot be modified');
  }

  if (patch.role !== undefined && patch.role !== 'admin' && patch.role !== 'user') {
    throw new UserValidationError('Role must be "admin" or "user"');
  }
  if (
    patch.permanentDeleteLimit !== undefined &&
    (!Number.isInteger(patch.permanentDeleteLimit) || patch.permanentDeleteLimit < 0)
  ) {
    throw new UserValidationError('permanentDeleteLimit must be an integer greater than or equal to 0');
  }
  let newHash: string | undefined;
  if (patch.password !== undefined) {
    if (typeof patch.password !== 'string' || patch.password.length < PASSWORD_MIN_LENGTH) {
      throw new UserValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    newHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const current = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (!current) throw new UserNotFoundError('User not found');

    const role = patch.role ?? (current.role === 'admin' ? 'admin' : 'user');
    const limit = patch.permanentDeleteLimit ?? Number(current.permanent_delete_limit ?? 0);
    const passwordHash = newHash ?? current.password_hash;
    const status = newHash ? 'active' : current.status;
    const inviteHash = newHash ? null : current.invite_token_hash;
    const inviteExpires = newHash ? null : current.invite_expires_at;

    await tx.execute(
      `UPDATE users
       SET role = ?, permanent_delete_limit = ?, password_hash = ?, status = ?, invite_token_hash = ?, invite_expires_at = ?
       WHERE email = ?`,
      [role, limit, passwordHash, status, inviteHash, inviteExpires, normalized]
    );

    const updated = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (!updated) throw new UserNotFoundError('User not found');
    return rowToPublicUser(updated);
  });
}

export async function deleteUser(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (isEnvAdmin(normalized)) {
    throw new ImmutableUserError('The environment administrator cannot be deleted');
  }

  const db = await getDb();
  const res = await db.execute('DELETE FROM users WHERE email = ?', [normalized]);
  if (res.changes === 0) {
    throw new UserNotFoundError('User not found');
  }
}

export async function verifyUserCredentials(
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  const envPassword = process.env.ADMIN_PASSWORD;
  const normalized = normalizeEmail(email);

  if (envEmail && envPassword && normalized === normalizeEmail(envEmail)) {
    if (safeEqualStrings(password, envPassword)) {
      return { email: normalizeEmail(envEmail), role: 'admin' };
    }
    // Also allow rotated password if reset-password set a bcrypt hash on the env admin row
    const db = await getDb();
    const envRow = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (envRow?.password_hash) {
      const ok = await bcrypt.compare(password, envRow.password_hash).catch(() => false);
      if (ok) return { email: normalizeEmail(envEmail), role: 'admin' };
    }
    return null;
  }

  const db = await getDb();
  const row = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
  if (!row || !row.password_hash) return null;

  const valid = await bcrypt.compare(password, row.password_hash).catch(() => false);
  if (!valid) return null;

  return { email: row.email, role: row.role === 'admin' ? 'admin' : 'user' };
}

export async function getPermanentDeleteLimit(email: string): Promise<number> {
  const normalized = normalizeEmail(email);
  if (isEnvAdmin(normalized)) return Number.POSITIVE_INFINITY;

  const db = await getDb();
  const row = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
  if (!row) return 0;
  if (row.role === 'admin') return Number.POSITIVE_INFINITY;
  return Number(row.permanent_delete_limit ?? 0);
}

export async function getAccountState(email: string): Promise<AccountAuthState | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const db = await getDb();
  const row = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);

  if (isEnvAdmin(normalized)) {
    return {
      email: normalized,
      role: 'admin',
      status: 'active',
      totpEnabled: !!row?.totp_enabled_at,
      invitePending: false,
    };
  }

  if (!row) return null;
  const status: UserStatus = row.status === 'invited' ? 'invited' : 'active';
  return {
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    status,
    totpEnabled: !!row.totp_enabled_at,
    invitePending: status === 'invited',
  };
}

export async function resolveInviteEmail(token: string): Promise<string | null> {
  if (!token) return null;
  const hash = hashInviteToken(token);
  const db = await getDb();
  const rows = await db.query<UserRow>('SELECT * FROM users WHERE invite_token_hash IS NOT NULL');
  const matched = rows.find(
    (r) => r.invite_token_hash && safeEqualStrings(r.invite_token_hash, hash)
  );
  if (!matched || !matched.invite_expires_at) return null;
  if (new Date(matched.invite_expires_at).getTime() < Date.now()) return null;
  return matched.email;
}

export async function setUserPassword(email: string, password: string): Promise<void> {
  if (typeof password !== 'string' || password.length < SETUP_PASSWORD_MIN_LENGTH) {
    throw new UserValidationError(`Password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters`);
  }
  const normalized = normalizeEmail(email);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const db = await getDb();
  const res = await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hash, normalized]);
  if (res.changes === 0) throw new UserNotFoundError('User not found');
}

export async function issueInviteToken(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  if (isEnvAdmin(normalized)) {
    throw new ImmutableUserError('The environment administrator cannot be invited');
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (!row) throw new UserNotFoundError('User not found');
    if (row.status !== 'invited') {
      throw new UserValidationError('Only pending invitations can be resent');
    }
    const invite = generateInviteToken();
    await tx.execute(
      'UPDATE users SET invite_token_hash = ?, invite_expires_at = ? WHERE email = ?',
      [invite.hash, invite.expiresAt, normalized]
    );
    return invite.token;
  });
}

export async function issuePasswordResetToken(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await ensureEnvAdminRecord(tx, normalized);
    if (!row) throw new UserNotFoundError('User not found');
    const invite = generateInviteToken();
    await tx.execute(
      'UPDATE users SET invite_token_hash = ?, invite_expires_at = ? WHERE email = ?',
      [invite.hash, invite.expiresAt, normalized]
    );
    return invite.token;
  });
}

export async function startTotpSetup(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await ensureEnvAdminRecord(tx, normalized);
    if (!row) throw new UserNotFoundError('User not found');
    const secret = generateTotpSecret();
    await tx.execute(
      'UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, last_totp_step = NULL WHERE email = ?',
      [secret, normalized]
    );
    return secret;
  });
}

export async function enableTotp(email: string, code: string): Promise<AccountAuthState | null> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (!row || !row.totp_secret) return null;

    const matchedStep = verifyTotpStep(row.totp_secret, code);
    if (matchedStep === null) return null;

    const nowIso = new Date().toISOString();
    await tx.execute(
      `UPDATE users
       SET totp_enabled_at = ?, last_totp_step = ?, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL
       WHERE email = ?`,
      [nowIso, matchedStep, normalized]
    );

    const role: UserRole = isEnvAdmin(normalized) || row.role === 'admin' ? 'admin' : 'user';
    return {
      email: normalized,
      role,
      status: 'active',
      totpEnabled: true,
      invitePending: false,
    };
  });
}

export async function disableTotp(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  const row = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
  if (!row) {
    if (isEnvAdmin(normalized)) return;
    throw new UserNotFoundError('User not found');
  }
  await db.execute(
    'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, last_totp_step = NULL WHERE email = ?',
    [normalized]
  );
}

// Atomically verifies the 6-digit TOTP code AND ensures its 30s time-step has
// not already been used (blocking code replay within the +/-1 step window).
export async function verifyAndConsumeTotp(email: string, code: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [normalized]);
    if (!row || !row.totp_enabled_at || !row.totp_secret) return false;

    const matchedStep = verifyTotpStep(row.totp_secret, code);
    if (matchedStep === null) return false;

    const lastStep = row.last_totp_step !== null ? Number(row.last_totp_step) : null;
    if (lastStep !== null && Number.isFinite(lastStep) && matchedStep <= lastStep) {
      return false;
    }

    await tx.execute('UPDATE users SET last_totp_step = ? WHERE email = ?', [matchedStep, normalized]);
    return true;
  });
}
