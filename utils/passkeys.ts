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

// One passkey per account, keyed by the normalized email. The previous format
// stored a single { userID, passkey } object, which let one account overwrite
// another's passkey; loadStore migrates it in place.
export type PasskeyStore = Record<string, PasskeyRecord>;

interface LegacyStore {
    userID?: string | null;
    passkey?: PasskeyRecord | null;
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

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function isPasskeyRecord(value: unknown): value is PasskeyRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.credentialID === 'string' && typeof record.email === 'string';
}

function coerceRecord(value: unknown, fallbackEmail?: string): PasskeyRecord | null {
    if (!isPasskeyRecord(value)) return null;
    const candidate = value.email.trim() || fallbackEmail || '';
    if (!candidate) return null;
    return { ...value, email: normalizeEmail(candidate) };
}

async function saveStore(store: PasskeyStore): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = path.join(DATA_DIR, `.passkeys.${process.pid}.${Date.now()}.tmp`);
    // Never log the contents: this file holds public key material.
    await fs.writeFile(tmpPath, JSON.stringify(store, null, 2));
    await fs.rename(tmpPath, PASSKEYS_FILE_PATH);
}

// Legacy files always carry a "passkey" key (even when null); the email-keyed
// map never does, so its presence unambiguously marks an old file.
function isLegacyStore(parsed: Record<string, unknown>): boolean {
    return 'passkey' in parsed;
}

function migrateLegacyStore(parsed: LegacyStore): PasskeyStore {
    const record = coerceRecord(parsed.passkey);
    return record ? { [record.email]: record } : {};
}

async function loadStore(): Promise<PasskeyStore> {
    let raw: string;
    try {
        raw = await fs.readFile(PASSKEYS_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        if (isLegacyStore(parsed)) {
            const migrated = migrateLegacyStore(parsed as LegacyStore);
            await saveStore(migrated);
            return migrated;
        }

        const store: PasskeyStore = {};
        for (const [key, value] of Object.entries(parsed)) {
            const record = coerceRecord(value, key);
            if (record) store[record.email] = record;
        }
        return store;
    } catch {
        // A corrupt file must not crash auth; treat it as "no passkeys".
        return {};
    }
}

export async function getPasskey(email: string): Promise<PasskeyRecord | null> {
    const store = await loadStore();
    return store[normalizeEmail(email)] ?? null;
}

export async function hasPasskey(email: string): Promise<boolean> {
    return (await getPasskey(email)) !== null;
}

export async function hasAnyPasskey(): Promise<boolean> {
    const store = await loadStore();
    return Object.keys(store).length > 0;
}

// Everything a login ceremony may present, so any account can sign in without
// typing its email first.
export async function listCredentialIds(): Promise<{ id: string; transports: string[] }[]> {
    const store = await loadStore();
    return Object.values(store).map((record) => ({
        id: record.credentialID,
        transports: record.transports ?? [],
    }));
}

export async function findPasskeyByCredentialId(credentialID: string): Promise<PasskeyRecord | null> {
    const store = await loadStore();
    return Object.values(store).find((record) => record.credentialID === credentialID) ?? null;
}

export async function savePasskey(record: PasskeyRecord): Promise<void> {
    const store = await loadStore();
    const email = normalizeEmail(record.email);
    store[email] = { ...record, email };
    await saveStore(store);
}

export async function deletePasskey(email: string): Promise<void> {
    const store = await loadStore();
    const key = normalizeEmail(email);
    if (!(key in store)) return;
    delete store[key];
    await saveStore(store);
}

// Stable WebAuthn user handle. Derived from the email so each account keeps its
// own browser entry without persisting extra state.
export function getUserID(email: string): string {
    const digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest();
    return toBase64Url(digest.subarray(0, USER_ID_BYTES));
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
