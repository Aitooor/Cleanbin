import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DATA_DIR } from './config';
import { generateInviteToken, hashInviteToken } from './invites';
import { generateTotpSecret, verifyTotp } from './totp';

const USERS_FILE_PATH = path.join(DATA_DIR, 'users.json');
const LEGACY_ADMINS_FILE_PATH = path.join(DATA_DIR, 'admins.json');
const BCRYPT_ROUNDS = 10;
export const PASSWORD_MIN_LENGTH = 8;
// Passwords chosen through the invitation/setup flow must be stronger than the
// legacy admin-provided minimum.
export const SETUP_PASSWORD_MIN_LENGTH = 10;

export type UserRole = 'admin' | 'user';
export type UserStatus = 'invited' | 'active';

export interface User {
    email: string;
    // Empty until the invitation is completed.
    passwordHash: string;
    role: UserRole;
    permanentDeleteLimit: number;
    createdAt: string;
    status: UserStatus;
    totpSecret: string | null;
    totpEnabledAt: string | null;
    // Only the SHA-256 hash of the single-use invitation token is stored.
    inviteTokenHash: string | null;
    inviteExpiresAt: string | null;
}

// Never leave the process with the password hash attached to a public shape.
export interface PublicUser {
    email: string;
    role: UserRole;
    permanentDeleteLimit: number;
    createdAt: string;
    status: UserStatus;
    totpEnabled: boolean;
    invitePending: boolean;
    // The environment administrator lives in env vars, not in users.json.
    immutable?: boolean;
}

export interface CreateUserInput {
    email: string;
    // When omitted the account is created as an invitation to be completed.
    password?: string;
    role: UserRole;
    permanentDeleteLimit: number;
}

export interface CreateUserResult {
    user: PublicUser;
    // Present only for invitations; only the caller may send it by email.
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

function isBcryptHash(value: string): boolean {
    return /^\$2[aby]?\$\d{2}\$/.test(value);
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function sameEmail(a: string, b: string): boolean {
    return normalizeEmail(a) === normalizeEmail(b);
}

function safeEqualStrings(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

export function isEnvAdmin(email: string): boolean {
    const envEmail = process.env.ADMIN_EMAIL?.trim();
    return !!envEmail && sameEmail(envEmail, email);
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmpPath, contents);
    await fs.rename(tmpPath, filePath);
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

function normalizeStoredUser(entry: unknown): User | null {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
    if (!email) return null;
    // Records created before invitations always had a password hash; invited
    // records intentionally have none until the setup flow completes.
    const passwordHash = typeof record.passwordHash === 'string' ? record.passwordHash : '';

    const role: UserRole = record.role === 'admin' ? 'admin' : 'user';
    const rawLimit = Number(record.permanentDeleteLimit);
    const permanentDeleteLimit =
        Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 0;
    const createdAt =
        typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
    const status: UserStatus = record.status === 'invited' ? 'invited' : 'active';

    return {
        email,
        passwordHash,
        role,
        permanentDeleteLimit,
        createdAt,
        status,
        totpSecret: optionalString(record.totpSecret),
        totpEnabledAt: optionalString(record.totpEnabledAt),
        inviteTokenHash: optionalString(record.inviteTokenHash),
        inviteExpiresAt: optionalString(record.inviteExpiresAt),
    };
}

// Returns null when the file does not exist yet, so callers can run the legacy
// migration exactly once.
async function readUsersFile(): Promise<User[] | null> {
    let raw: string;
    try {
        raw = await fs.readFile(USERS_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(normalizeStoredUser)
            .filter((user): user is User => user !== null);
    } catch {
        // A corrupt file must not crash user management; start from an empty list.
        return [];
    }
}

async function saveUsers(users: User[]): Promise<void> {
    await writeFileAtomic(USERS_FILE_PATH, JSON.stringify(users, null, 2));
}

// Imports the legacy data/admins.json (hashed or plaintext passwords) the first
// time users.json is created, then never reads it again.
async function migrateLegacyAdmins(): Promise<User[]> {
    let raw: string;
    try {
        raw = await fs.readFile(LEGACY_ADMINS_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const users: User[] = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
        if (!email) continue;

        const password = typeof record.password === 'string' ? record.password : '';
        if (!password) continue;
        const passwordHash = isBcryptHash(password)
            ? password
            : await bcrypt.hash(password, BCRYPT_ROUNDS);

        users.push({
            email,
            passwordHash,
            role: 'admin',
            permanentDeleteLimit: 0,
            createdAt: new Date().toISOString(),
            status: 'active',
            totpSecret: null,
            totpEnabledAt: null,
            inviteTokenHash: null,
            inviteExpiresAt: null,
        });
    }
    return users;
}

async function loadStoredUsers(): Promise<User[]> {
    const existing = await readUsersFile();
    if (existing !== null) return existing;

    const migrated = await migrateLegacyAdmins();
    await saveUsers(migrated);
    return migrated;
}

function toPublicUser(user: User): PublicUser {
    return {
        email: user.email,
        role: user.role,
        permanentDeleteLimit: user.permanentDeleteLimit,
        createdAt: user.createdAt,
        status: user.status,
        totpEnabled: !!user.totpEnabledAt,
        invitePending: user.status === 'invited',
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

function findStoredUser(users: User[], email: string): User | undefined {
    return users.find((candidate) => candidate.email === normalizeEmail(email));
}

export async function listUsers(): Promise<PublicUser[]> {
    const users = await loadStoredUsers();
    const envEmail = process.env.ADMIN_EMAIL?.trim();
    const envRecord = envEmail ? users.find((user) => sameEmail(user.email, envEmail)) : undefined;

    // The environment admin is always rendered from env data (immutable role and
    // limits); only its 2FA state is read from the optional stored record.
    const stored = users
        .filter((user) => !(envEmail && sameEmail(user.email, envEmail)))
        .map(toPublicUser);

    if (envEmail) {
        stored.unshift(envAdminPublicUser(!!envRecord?.totpEnabledAt));
    }
    return stored;
}

export async function getUser(email: string): Promise<PublicUser | null> {
    const normalized = normalizeEmail(email);
    const users = await loadStoredUsers();

    if (isEnvAdmin(normalized)) {
        const record = findStoredUser(users, normalized);
        return envAdminPublicUser(!!record?.totpEnabledAt);
    }

    const user = findStoredUser(users, normalized);
    return user ? toPublicUser(user) : null;
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

    const users = await loadStoredUsers();
    if (users.some((user) => user.email === email)) {
        throw new UserExistsError('A user with this email already exists');
    }

    const invite = hasPassword ? null : generateInviteToken();
    const user: User = {
        email,
        passwordHash: hasPassword ? await bcrypt.hash(input.password as string, BCRYPT_ROUNDS) : '',
        role: input.role,
        permanentDeleteLimit: input.permanentDeleteLimit,
        createdAt: new Date().toISOString(),
        status: hasPassword ? 'active' : 'invited',
        totpSecret: null,
        totpEnabledAt: null,
        inviteTokenHash: invite ? invite.hash : null,
        inviteExpiresAt: invite ? invite.expiresAt : null,
    };
    users.push(user);
    await saveUsers(users);
    return { user: toPublicUser(user), inviteToken: invite ? invite.token : null };
}

export async function updateUser(email: string, patch: UpdateUserPatch): Promise<PublicUser> {
    const normalized = normalizeEmail(email);
    if (isEnvAdmin(normalized)) {
        throw new ImmutableUserError('The environment administrator cannot be modified');
    }

    const users = await loadStoredUsers();
    const user = findStoredUser(users, normalized);
    if (!user) throw new UserNotFoundError('User not found');

    if (patch.role !== undefined) {
        if (patch.role !== 'admin' && patch.role !== 'user') {
            throw new UserValidationError('Role must be "admin" or "user"');
        }
        user.role = patch.role;
    }
    if (patch.permanentDeleteLimit !== undefined) {
        if (!Number.isInteger(patch.permanentDeleteLimit) || patch.permanentDeleteLimit < 0) {
            throw new UserValidationError('permanentDeleteLimit must be an integer greater than or equal to 0');
        }
        user.permanentDeleteLimit = patch.permanentDeleteLimit;
    }
    if (patch.password !== undefined) {
        if (typeof patch.password !== 'string' || patch.password.length < PASSWORD_MIN_LENGTH) {
            throw new UserValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
        }
        user.passwordHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
        // An admin-set password activates the account and invalidates any invite.
        user.status = 'active';
        user.inviteTokenHash = null;
        user.inviteExpiresAt = null;
    }

    await saveUsers(users);
    return toPublicUser(user);
}

export async function deleteUser(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (isEnvAdmin(normalized)) {
        throw new ImmutableUserError('The environment administrator cannot be deleted');
    }

    const users = await loadStoredUsers();
    const remaining = users.filter((user) => user.email !== normalized);
    if (remaining.length === users.length) throw new UserNotFoundError('User not found');

    await saveUsers(remaining);
}

export async function verifyUserCredentials(
    email: string,
    password: string
): Promise<AuthenticatedUser | null> {
    const envEmail = process.env.ADMIN_EMAIL;
    const envPassword = process.env.ADMIN_PASSWORD;
    if (envEmail && envPassword && email === envEmail && safeEqualStrings(password, envPassword)) {
        return { email: envEmail, role: 'admin' };
    }

    const users = await loadStoredUsers();
    const user = findStoredUser(users, email);
    if (!user || !user.passwordHash) return null;

    let valid = false;
    try {
        valid = await bcrypt.compare(password, user.passwordHash);
    } catch {
        valid = false;
    }
    if (!valid) return null;

    return { email: user.email, role: user.role };
}

// Admins have no limit; a missing account fails closed with 0.
export async function getPermanentDeleteLimit(email: string): Promise<number> {
    if (isEnvAdmin(email)) return Number.POSITIVE_INFINITY;

    const users = await loadStoredUsers();
    const user = findStoredUser(users, email);
    if (!user) return 0;
    if (user.role === 'admin') return Number.POSITIVE_INFINITY;
    return user.permanentDeleteLimit;
}

export async function getAccountState(email: string): Promise<AccountAuthState | null> {
    const normalized = normalizeEmail(email);
    const users = await loadStoredUsers();

    if (isEnvAdmin(normalized)) {
        const record = findStoredUser(users, normalized);
        return {
            email: normalized,
            role: 'admin',
            status: 'active',
            totpEnabled: !!record?.totpEnabledAt,
            invitePending: false,
        };
    }

    const user = findStoredUser(users, normalized);
    if (!user) return null;
    return {
        email: user.email,
        role: user.role,
        status: user.status,
        totpEnabled: !!user.totpEnabledAt,
        invitePending: user.status === 'invited',
    };
}

// Resolves a plain invitation token to its owner. Tokens travel only by email or
// a manual link; the stored value is always the SHA-256 hash.
export async function resolveInviteEmail(token: string): Promise<string | null> {
    if (!token) return null;
    const hash = hashInviteToken(token);
    const users = await loadStoredUsers();
    const user = users.find(
        (candidate) => candidate.inviteTokenHash && safeEqualStrings(candidate.inviteTokenHash, hash)
    );
    if (!user || !user.inviteExpiresAt) return null;
    if (new Date(user.inviteExpiresAt).getTime() < Date.now()) return null;
    return user.email;
}

// Step 1 of the setup flow: the invitee chooses their own password.
export async function setUserPassword(email: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password.length < SETUP_PASSWORD_MIN_LENGTH) {
        throw new UserValidationError(
            `Password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters`
        );
    }

    const users = await loadStoredUsers();
    const user = findStoredUser(users, email);
    if (!user) throw new UserNotFoundError('User not found');

    user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await saveUsers(users);
}

// Issues a fresh single-use token for a still-pending invitation.
export async function issueInviteToken(email: string): Promise<string> {
    const normalized = normalizeEmail(email);
    if (isEnvAdmin(normalized)) {
        throw new ImmutableUserError('The environment administrator cannot be invited');
    }

    const users = await loadStoredUsers();
    const user = findStoredUser(users, normalized);
    if (!user) throw new UserNotFoundError('User not found');
    if (user.status !== 'invited') {
        throw new UserValidationError('Only pending invitations can be resent');
    }

    const invite = generateInviteToken();
    user.inviteTokenHash = invite.hash;
    user.inviteExpiresAt = invite.expiresAt;
    await saveUsers(users);
    return invite.token;
}

// The environment admin is not stored in users.json; create a minimal record on
// demand so its TOTP fields have somewhere durable to live. Such a record keeps
// an empty password (login still comes from ADMIN_PASSWORD).
function getOrCreateMutableRecord(users: User[], email: string): User | null {
    const existing = findStoredUser(users, email);
    if (existing) return existing;
    if (!isEnvAdmin(email)) return null;

    const record: User = {
        email: normalizeEmail(email),
        passwordHash: '',
        role: 'admin',
        permanentDeleteLimit: 0,
        createdAt: new Date().toISOString(),
        status: 'active',
        totpSecret: null,
        totpEnabledAt: null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
    };
    users.push(record);
    return record;
}

// Step 2 of the setup flow: generate a pending secret. It is not active until a
// valid code is verified, so a leaked secret alone cannot bypass login.
export async function startTotpSetup(email: string): Promise<string> {
    const users = await loadStoredUsers();
    const user = getOrCreateMutableRecord(users, email);
    if (!user) throw new UserNotFoundError('User not found');

    const secret = generateTotpSecret();
    user.totpSecret = secret;
    user.totpEnabledAt = null;
    await saveUsers(users);
    return secret;
}

// Verifies the code against the pending secret and activates 2FA. Completing the
// setup also activates the account and burns the invitation token.
export async function enableTotp(email: string, code: string): Promise<AccountAuthState | null> {
    const users = await loadStoredUsers();
    const user = findStoredUser(users, email);
    if (!user || !user.totpSecret) return null;
    if (!verifyTotp(user.totpSecret, code)) return null;

    user.totpEnabledAt = new Date().toISOString();
    user.status = 'active';
    user.inviteTokenHash = null;
    user.inviteExpiresAt = null;
    await saveUsers(users);

    return {
        email: user.email,
        role: user.role,
        status: 'active',
        totpEnabled: true,
        invitePending: false,
    };
}

export async function disableTotp(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const users = await loadStoredUsers();
    const user = findStoredUser(users, normalized);
    if (!user) {
        if (isEnvAdmin(normalized)) return; // nothing configured yet
        throw new UserNotFoundError('User not found');
    }

    user.totpSecret = null;
    user.totpEnabledAt = null;
    await saveUsers(users);
}

export async function getEnabledTotpSecret(email: string): Promise<string | null> {
    const users = await loadStoredUsers();
    const user = findStoredUser(users, email);
    if (!user || !user.totpEnabledAt || !user.totpSecret) return null;
    return user.totpSecret;
}
