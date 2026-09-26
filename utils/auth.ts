import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { parse as parseCookies } from 'cookie';
import type { NextApiRequest, NextApiResponse } from 'next';
import { DATA_DIR } from './config';

const ADMIN_FILE_PATH = path.join(DATA_DIR, 'admins.json');
const BCRYPT_ROUNDS = 10;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SessionRole = 'admin';

export interface Admin {
    email: string;
    password: string;
    role: SessionRole;
}

export interface PublicAdmin {
    email: string;
    role: SessionRole;
}

export interface SessionPayload {
    email: string;
    role: SessionRole;
    exp: number;
}

export interface AuthResult {
    email: string;
    role: SessionRole;
}

function toBase64Url(input: Buffer | string): string {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getAuthSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        // Fail closed: without a configured secret no session can be trusted.
        throw new Error('AUTH_SECRET is not configured');
    }
    return secret;
}

function safeEqualStrings(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function isBcryptHash(value: string): boolean {
    return /^\$2[aby]?\$\d{2}\$/.test(value);
}

export function createSessionToken(email: string, role: SessionRole = 'admin'): string {
    const secret = getAuthSecret();
    const payload: SessionPayload = {
        email,
        role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = toBase64Url(
        crypto.createHmac('sha256', secret).update(encodedPayload).digest()
    );
    return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
    if (!token) return null;

    let secret: string;
    try {
        secret = getAuthSecret();
    } catch {
        return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
    let provided: Buffer;
    try {
        provided = fromBase64Url(signature);
    } catch {
        return null;
    }
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    let payload: SessionPayload;
    try {
        payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf-8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

export function getSessionFromRequest(req: NextApiRequest): SessionPayload | null {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader ? parseCookies(cookieHeader) : {};
    const token = cookies['auth-token'] ?? (req.cookies ? req.cookies['auth-token'] : undefined);
    return verifySessionToken(token);
}

export function requireSession(req: NextApiRequest, res: NextApiResponse): SessionPayload | null {
    const session = getSessionFromRequest(req);
    if (!session) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    return session;
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse): SessionPayload | null {
    const session = requireSession(req, res);
    if (!session) return null;
    if (session.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden' });
        return null;
    }
    return session;
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmpPath, contents);
    await fs.rename(tmpPath, filePath);
}

async function loadAdmins(): Promise<Admin[]> {
    let raw: string;
    try {
        raw = await fs.readFile(ADMIN_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Migrate any plaintext password to a bcrypt hash so login keeps working.
    let migrated = false;
    const admins: Admin[] = [];
    for (const entry of parsed) {
        if (!entry || typeof entry.email !== 'string') continue;
        const password = typeof entry.password === 'string' ? entry.password : '';
        let hashed = password;
        if (password && !isBcryptHash(password)) {
            hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
            migrated = true;
        }
        admins.push({ email: entry.email, password: hashed, role: 'admin' });
    }

    if (migrated) {
        await saveAdmins(admins);
    }
    return admins;
}

async function saveAdmins(admins: Admin[]): Promise<void> {
    await writeFileAtomic(ADMIN_FILE_PATH, JSON.stringify(admins, null, 2));
}

function toPublicAdmin(admin: Admin): PublicAdmin {
    return { email: admin.email, role: admin.role };
}

export async function getAdmins(): Promise<PublicAdmin[]> {
    const admins = await loadAdmins();
    return admins.map(toPublicAdmin);
}

export async function authenticateCredentials(
    email: string,
    password: string
): Promise<AuthResult | null> {
    const envEmail = process.env.ADMIN_EMAIL;
    const envPassword = process.env.ADMIN_PASSWORD;
    if (envEmail && envPassword && email === envEmail && safeEqualStrings(password, envPassword)) {
        return { email: envEmail, role: 'admin' };
    }

    const admins = await loadAdmins();
    const admin = admins.find((candidate) => candidate.email === email);
    if (!admin) return null;

    let valid = false;
    try {
        valid = await bcrypt.compare(password, admin.password);
    } catch {
        valid = false;
    }
    if (!valid) return null;

    return { email: admin.email, role: admin.role };
}

export async function createAdmin(email: string, password: string): Promise<void> {
    const admins = await loadAdmins();
    if (admins.some((admin) => admin.email === email)) {
        throw new Error('Admin with this email already exists');
    }
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    admins.push({ email, password: hashed, role: 'admin' });
    await saveAdmins(admins);
}

export async function updateAdmin(email: string, newPassword: string): Promise<void> {
    const admins = await loadAdmins();
    const admin = admins.find((candidate) => candidate.email === email);
    if (!admin) {
        throw new Error('Admin not found');
    }
    admin.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await saveAdmins(admins);
}

export async function deleteAdmin(email: string): Promise<void> {
    const admins = await loadAdmins();
    const remaining = admins.filter((admin) => admin.email !== email);
    await saveAdmins(remaining);
}

export const SESSION_COOKIE_NAME = 'auth-token';
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
