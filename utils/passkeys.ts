import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';

const PASSKEYS_FILE_PATH = path.join(DATA_DIR, 'passkeys.json');
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const USER_ID_BYTES = 32;

export interface PasskeyRecord {
    credentialID: string;
    // Public key encoded as base64url so the record stays JSON-safe.
    credentialPublicKey: string;
    counter: number;
    transports: string[];
    userID: string;
    email: string;
    createdAt: string;
}

interface PasskeyStore {
    userID: string | null;
    passkey: PasskeyRecord | null;
}

interface ChallengeEntry {
    challenge: string;
    expiresAt: number;
}

// In-memory, single-use challenge store. Challenges are short-lived and never
// need to survive a restart: an interrupted ceremony just starts over.
const challenges = new Map<string, ChallengeEntry>();

export function toBase64Url(input: Buffer | Uint8Array): string {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    const decoded = Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
    // Copy into a plain Uint8Array so the backing buffer is a real ArrayBuffer.
    const bytes = new Uint8Array(decoded.length);
    bytes.set(decoded);
    return bytes;
}

function emptyStore(): PasskeyStore {
    return { userID: null, passkey: null };
}

async function loadStore(): Promise<PasskeyStore> {
    let raw: string;
    try {
        raw = await fs.readFile(PASSKEYS_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
        throw error;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PasskeyStore>;
        return {
            userID: typeof parsed.userID === 'string' ? parsed.userID : null,
            passkey: parsed.passkey && typeof parsed.passkey === 'object' ? (parsed.passkey as PasskeyRecord) : null,
        };
    } catch {
        // A corrupt file must not crash auth; treat it as "no passkey".
        return emptyStore();
    }
}

async function saveStore(store: PasskeyStore): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = path.join(DATA_DIR, `.passkeys.${process.pid}.${Date.now()}.tmp`);
    // Never log the contents: this file holds public key material.
    await fs.writeFile(tmpPath, JSON.stringify(store, null, 2));
    await fs.rename(tmpPath, PASSKEYS_FILE_PATH);
}

export async function getPasskey(): Promise<PasskeyRecord | null> {
    const store = await loadStore();
    return store.passkey;
}

export async function hasPasskey(): Promise<boolean> {
    return (await getPasskey()) !== null;
}

export async function savePasskey(record: PasskeyRecord): Promise<void> {
    await saveStore({ userID: record.userID, passkey: record });
}

export async function deletePasskey(): Promise<void> {
    const store = await loadStore();
    await saveStore({ userID: store.userID, passkey: null });
}

// Stable WebAuthn user handle. Generated once and reused across (re)registrations
// so a browser keeps the same account entry.
export async function getUserID(): Promise<string> {
    const store = await loadStore();
    if (store.userID) return store.userID;

    const userID = toBase64Url(crypto.randomBytes(USER_ID_BYTES));
    await saveStore({ userID, passkey: store.passkey });
    return userID;
}

function purgeExpiredChallenges(now: number): void {
    for (const [key, entry] of challenges) {
        if (entry.expiresAt <= now) challenges.delete(key);
    }
}

export function saveChallenge(key: string, challenge: string): void {
    const now = Date.now();
    purgeExpiredChallenges(now);
    challenges.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

export function consumeChallenge(key: string): string | null {
    const now = Date.now();
    purgeExpiredChallenges(now);
    const entry = challenges.get(key);
    if (!entry) return null;
    challenges.delete(key);
    return entry.challenge;
}
