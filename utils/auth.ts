import crypto from 'node:crypto';
import { parse as parseCookies, serialize } from 'cookie';
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyUserCredentials, type UserRole } from './users';
import { isSessionActive, touchSession } from './sessions';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SessionRole = UserRole;

export interface SessionPayload {
    email: string;
    role: SessionRole;
    // Identifies the durable session record in DATA_DIR/sessions.json. The
    // middleware cannot check it (Edge has no filesystem), so revocation is
    // enforced by requireSession and the dashboard's server-side guard.
    sid: string;
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

// Signs an already base64url-encoded payload with HMAC-SHA256(AUTH_SECRET).
function signEncodedPayload(encodedPayload: string): string {
    const secret = getAuthSecret();
    return toBase64Url(crypto.createHmac('sha256', secret).update(encodedPayload).digest());
}

// Returns the encoded payload only when the signature is valid, or null.
function verifySignedPayload(token: string | undefined | null): string | null {
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
    return encodedPayload;
}

export function createSessionToken(email: string, role: SessionRole, sid: string): string {
    const payload: SessionPayload = {
        email,
        role,
        sid,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signEncodedPayload(encodedPayload)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
    const encodedPayload = verifySignedPayload(token);
    if (!encodedPayload) return null;

    let payload: SessionPayload;
    try {
        payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf-8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

// Short-lived signed challenge issued after password verification. It never
// grants a session by itself: the holder must still prove possession of the
// second factor (TOTP code) to exchange it for a cookie.
const AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;

export type AuthChallengePurpose = 'totp' | 'setup';

export interface AuthChallengePayload {
    email: string;
    purpose: AuthChallengePurpose;
    exp: number;
}

export function createAuthChallenge(email: string, purpose: AuthChallengePurpose): string {
    const payload: AuthChallengePayload = {
        email,
        purpose,
        exp: Math.floor(Date.now() / 1000) + AUTH_CHALLENGE_TTL_SECONDS,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    return `${encodedPayload}.${signEncodedPayload(encodedPayload)}`;
}

export function verifyAuthChallenge(
    token: string | undefined | null,
    purpose?: AuthChallengePurpose
): AuthChallengePayload | null {
    const encodedPayload = verifySignedPayload(token);
    if (!encodedPayload) return null;

    let payload: AuthChallengePayload;
    try {
        payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf-8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (purpose && payload.purpose !== purpose) return null;
    return payload;
}

// Issues the signed session cookie. Shared by every successful login path so
// cookie flags stay consistent in one place. `sid` points at the durable
// session record; without it the token is refused.
export function setSessionCookie(res: NextApiResponse, email: string, role: SessionRole, sid: string): void {
    const token = createSessionToken(email, role, sid);
    res.setHeader(
        'Set-Cookie',
        serialize(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_MAX_AGE_SECONDS,
        })
    );
}

export function getSessionFromRequest(req: NextApiRequest): SessionPayload | null {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader ? parseCookies(cookieHeader) : {};
    const token = cookies['auth-token'] ?? (req.cookies ? req.cookies['auth-token'] : undefined);
    return verifySessionToken(token);
}

// Expires the session cookie client-side after a sign-out.
export function clearSessionCookie(res: NextApiResponse): void {
    res.setHeader(
        'Set-Cookie',
        serialize(SESSION_COOKIE_NAME, '', {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
        })
    );
}

// Verifies the signature AND that the session record still exists and is not
// revoked. A valid signature over a revoked/unknown sid is rejected.
export async function requireSession(req: NextApiRequest, res: NextApiResponse): Promise<SessionPayload | null> {
    const session = getSessionFromRequest(req);
    if (!session || !(await isSessionActive(session.sid))) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    await touchSession(session.sid);
    return session;
}

export async function requireAdmin(req: NextApiRequest, res: NextApiResponse): Promise<SessionPayload | null> {
    const session = await requireSession(req, res);
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
