import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';
import type { UserRole } from './users';

// Durable, per-device session records. The signed cookie only carries the
// session id; this file is the source of truth so an individual device can be
// signed out (or a whole account on a password reset) without rotating the
// signing key.
const SESSIONS_FILE_PATH = path.join(DATA_DIR, 'sessions.json');

// A person may sign in from many devices. The cap keeps the file and the
// revocation surface bounded: the oldest session is dropped when it is reached.
export const MAX_SESSIONS_PER_USER = 20;

// Revoked records are kept briefly so a race with an in-flight request still
// resolves as "revoked" rather than "unknown", then pruned to avoid growth.
const REVOKED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionRecord {
    id: string;
    email: string;
    role: UserRole;
    userAgent: string;
    createdAt: string;
    lastSeenAt: string;
    revokedAt: string | null;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function coerceRecord(value: unknown): SessionRecord | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id) return null;
    const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
    if (!email) return null;
    const role: UserRole = record.role === 'admin' ? 'admin' : 'user';
    const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
    return {
        id: record.id,
        email,
        role,
        userAgent: typeof record.userAgent === 'string' ? record.userAgent : '',
        createdAt,
        lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : createdAt,
        revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : null,
    };
}

async function readSessions(): Promise<SessionRecord[]> {
    let raw: string;
    try {
        raw = await fs.readFile(SESSIONS_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(coerceRecord)
            .filter((record): record is SessionRecord => record !== null);
    } catch {
        // A corrupt file must not lock everyone out; start from an empty list.
        return [];
    }
}

async function writeSessionsAtomic(records: SessionRecord[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = path.join(DATA_DIR, `.sessions.${process.pid}.${Date.now()}.tmp`);
    // Never log the contents: these records identify devices.
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2));
    await fs.rename(tmpPath, SESSIONS_FILE_PATH);
}

function pruneRevoked(records: SessionRecord[], now: number): SessionRecord[] {
    return records.filter(
        (record) => !record.revokedAt || now - new Date(record.revokedAt).getTime() < REVOKED_RETENTION_MS
    );
}

function isActive(record: SessionRecord): boolean {
    return !record.revokedAt;
}

// Serialise every read-modify-write so two concurrent logins cannot clobber
// each other's records (last write would otherwise win and drop a session).
let writeQueue: Promise<void> = Promise.resolve();
function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}

export async function createUserSession(
    email: string,
    role: UserRole,
    userAgent: string
): Promise<SessionRecord> {
    return withWriteLock(async () => {
        const now = Date.now();
        const records = pruneRevoked(await readSessions(), now);
        const nowIso = new Date(now).toISOString();

        // Enforce the per-account cap by revoking the oldest active sessions.
        const active = records.filter((record) => isActive(record) && record.email === normalizeEmail(email));
        if (active.length >= MAX_SESSIONS_PER_USER) {
            const excess = active
                .sort((a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime())
                .slice(0, active.length - MAX_SESSIONS_PER_USER + 1);
            for (const record of excess) {
                const stored = records.find((candidate) => candidate.id === record.id);
                if (stored) stored.revokedAt = nowIso;
            }
        }

        const session: SessionRecord = {
            id: crypto.randomUUID(),
            email: normalizeEmail(email),
            role,
            userAgent: userAgent.slice(0, 400),
            createdAt: nowIso,
            lastSeenAt: nowIso,
            revokedAt: null,
        };
        records.push(session);
        await writeSessionsAtomic(records);
        return session;
    });
}

export async function getSession(id: string): Promise<SessionRecord | null> {
    const records = await readSessions();
    return records.find((record) => record.id === id) ?? null;
}

export async function isSessionActive(id: string): Promise<boolean> {
    if (!id) return false;
    const record = await getSession(id);
    return !!record && isActive(record);
}

// Refresh lastSeenAt, but at most once every few minutes so a busy dashboard
// does not rewrite the file on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function touchSession(id: string): Promise<void> {
    if (!id) return;
    await withWriteLock(async () => {
        const records = await readSessions();
        const record = records.find((candidate) => candidate.id === id);
        if (!record || record.revokedAt) return;
        const now = Date.now();
        if (now - new Date(record.lastSeenAt).getTime() < TOUCH_INTERVAL_MS) return;
        record.lastSeenAt = new Date(now).toISOString();
        await writeSessionsAtomic(pruneRevoked(records, now));
    });
}

export async function listUserSessions(email: string): Promise<SessionRecord[]> {
    const normalized = normalizeEmail(email);
    const records = await readSessions();
    return records
        .filter((record) => isActive(record) && record.email === normalized)
        .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

export async function revokeSession(id: string): Promise<boolean> {
    return withWriteLock(async () => {
        const now = Date.now();
        const records = pruneRevoked(await readSessions(), now);
        const record = records.find((candidate) => candidate.id === id);
        if (!record || record.revokedAt) return false;
        record.revokedAt = new Date(now).toISOString();
        await writeSessionsAtomic(records);
        return true;
    });
}

export async function revokeUserSessions(email: string): Promise<number> {
    return withWriteLock(async () => {
        const now = Date.now();
        const normalized = normalizeEmail(email);
        const records = pruneRevoked(await readSessions(), now);
        let revoked = 0;
        for (const record of records) {
            if (isActive(record) && record.email === normalized) {
                record.revokedAt = new Date(now).toISOString();
                revoked += 1;
            }
        }
        if (revoked > 0) await writeSessionsAtomic(records);
        return revoked;
    });
}
