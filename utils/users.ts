import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DATA_DIR } from './config';

const USERS_FILE_PATH = path.join(DATA_DIR, 'users.json');
const LEGACY_ADMINS_FILE_PATH = path.join(DATA_DIR, 'admins.json');
const BCRYPT_ROUNDS = 10;
export const PASSWORD_MIN_LENGTH = 8;

export type UserRole = 'admin' | 'user';

export interface User {
    email: string;
    passwordHash: string;
    role: UserRole;
    permanentDeleteLimit: number;
    createdAt: string;
}

// Never leave the process with the password hash attached to a public shape.
export interface PublicUser {
    email: string;
    role: UserRole;
    permanentDeleteLimit: number;
    createdAt: string;
    // The environment administrator lives in env vars, not in users.json.
    immutable?: boolean;
}

export interface CreateUserInput {
    email: string;
    password: string;
    role: UserRole;
    permanentDeleteLimit: number;
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

function normalizeStoredUser(entry: unknown): User | null {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
    const passwordHash = typeof record.passwordHash === 'string' ? record.passwordHash : '';
    if (!email || !passwordHash) return null;

    const role: UserRole = record.role === 'admin' ? 'admin' : 'user';
    const rawLimit = Number(record.permanentDeleteLimit);
    const permanentDeleteLimit =
        Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 0;
    const createdAt =
        typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();

    return { email, passwordHash, role, permanentDeleteLimit, createdAt };
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
    };
}

function envAdminPublicUser(): PublicUser {
    return {
        email: process.env.ADMIN_EMAIL?.trim() || '',
        role: 'admin',
        permanentDeleteLimit: 0,
        createdAt: new Date(0).toISOString(),
        immutable: true,
    };
}

export async function listUsers(): Promise<PublicUser[]> {
    const users = await loadStoredUsers();
    const stored = users.map(toPublicUser);

    const envEmail = process.env.ADMIN_EMAIL?.trim();
    if (envEmail && !users.some((user) => sameEmail(user.email, envEmail))) {
        stored.unshift(envAdminPublicUser());
    }
    return stored;
}

export async function getUser(email: string): Promise<PublicUser | null> {
    const normalized = normalizeEmail(email);
    const users = await loadStoredUsers();
    const user = users.find((candidate) => candidate.email === normalized);
    if (user) return toPublicUser(user);

    if (isEnvAdmin(normalized)) return envAdminPublicUser();
    return null;
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    if (!email) throw new UserValidationError('Email is required');
    if (isEnvAdmin(email)) throw new UserExistsError('This email is reserved');
    if (input.role !== 'admin' && input.role !== 'user') {
        throw new UserValidationError('Role must be "admin" or "user"');
    }
    if (!Number.isInteger(input.permanentDeleteLimit) || input.permanentDeleteLimit < 0) {
        throw new UserValidationError('permanentDeleteLimit must be an integer greater than or equal to 0');
    }
    if (typeof input.password !== 'string' || input.password.length < PASSWORD_MIN_LENGTH) {
        throw new UserValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }

    const users = await loadStoredUsers();
    if (users.some((user) => user.email === email)) {
        throw new UserExistsError('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user: User = {
        email,
        passwordHash,
        role: input.role,
        permanentDeleteLimit: input.permanentDeleteLimit,
        createdAt: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);
    return toPublicUser(user);
}

export async function updateUser(email: string, patch: UpdateUserPatch): Promise<PublicUser> {
    const normalized = normalizeEmail(email);
    if (isEnvAdmin(normalized)) {
        throw new ImmutableUserError('The environment administrator cannot be modified');
    }

    const users = await loadStoredUsers();
    const user = users.find((candidate) => candidate.email === normalized);
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
    const user = users.find((candidate) => candidate.email === normalizeEmail(email));
    if (!user) return null;

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
    const user = users.find((candidate) => candidate.email === normalizeEmail(email));
    if (!user) return 0;
    if (user.role === 'admin') return Number.POSITIVE_INFINITY;
    return user.permanentDeleteLimit;
}
