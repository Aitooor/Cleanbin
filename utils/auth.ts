import crypto from 'node:crypto';
import { parse as parseCookies } from 'cookie';
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyUserCredentials, type UserRole } from './users';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SessionRole = UserRole;

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

// Backwards-compatible wrapper: credential storage now lives in utils/users.ts.
export async function authenticateCredentials(
    email: string,
    password: string
): Promise<AuthResult | null> {
    return verifyUserCredentials(email, password);
}

export const SESSION_COOKIE_NAME = 'auth-token';
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
