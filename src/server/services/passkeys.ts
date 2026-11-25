import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { normalizeEmail } from '../../shared/validation.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 500;
const USER_ID_BYTES = 32;

interface PasskeyRow {
  email: string;
  rp_id: string;
  credential_id: string;
  credential_public_key: string;
  counter: number | string;
  transports: string;
  user_id: string;
  created_at: string;
}

export interface PasskeyRecord {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports: string[];
  userID: string;
  email: string;
  rpID: string;
  createdAt: string;
}

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

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
  const bytes = new Uint8Array(decoded.length);
  bytes.set(decoded);
  return bytes;
}

function normalizeRpId(rpId?: string): string {
  return (rpId ?? '').trim().toLowerCase();
}

function rowToRecord(row: PasskeyRow): PasskeyRecord {
  let transports: string[] = [];
  try {
    const parsed = JSON.parse(row.transports);
    if (Array.isArray(parsed)) transports = parsed.map(String);
  } catch {
    transports = [];
  }
  return {
    credentialID: row.credential_id,
    credentialPublicKey: row.credential_public_key,
    counter: Number(row.counter ?? 0),
    transports,
    userID: row.user_id,
    email: row.email,
    rpID: row.rp_id || '',
    createdAt: row.created_at,
  };
}

export async function getPasskey(email: string, rpId?: string): Promise<PasskeyRecord | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = await getDb();
  if (rpId !== undefined) {
    const row = await db.queryOne<PasskeyRow>(
      'SELECT * FROM passkeys WHERE email = ? AND rp_id = ?',
      [normalized, normalizeRpId(rpId)]
    );
    return row ? rowToRecord(row) : null;
  }
  const row = await db.queryOne<PasskeyRow>('SELECT * FROM passkeys WHERE email = ? LIMIT 1', [
    normalized,
  ]);
  return row ? rowToRecord(row) : null;
}

export async function hasPasskey(email: string, rpId?: string): Promise<boolean> {
  return (await getPasskey(email, rpId)) !== null;
}

export async function hasAnyPasskey(rpId?: string): Promise<boolean> {
  const db = await getDb();
  if (rpId !== undefined) {
    const row = await db.queryOne<{ email: string }>(
      'SELECT email FROM passkeys WHERE rp_id = ? LIMIT 1',
      [normalizeRpId(rpId)]
    );
    return !!row;
  }
  const row = await db.queryOne<{ email: string }>('SELECT email FROM passkeys LIMIT 1');
  return !!row;
}

export async function listCredentialIds(rpId?: string): Promise<{ id: string; transports: string[] }[]> {
  const db = await getDb();
  const rows =
    rpId !== undefined
      ? await db.query<PasskeyRow>('SELECT * FROM passkeys WHERE rp_id = ?', [normalizeRpId(rpId)])
      : await db.query<PasskeyRow>('SELECT * FROM passkeys');
  return rows.map((row) => {
    const rec = rowToRecord(row);
    return { id: rec.credentialID, transports: rec.transports };
  });
}

export async function findPasskeyByCredentialId(credentialID: string): Promise<PasskeyRecord | null> {
  if (!credentialID) return null;
  const db = await getDb();
  const row = await db.queryOne<PasskeyRow>('SELECT * FROM passkeys WHERE credential_id = ?', [
    credentialID,
  ]);
  return row ? rowToRecord(row) : null;
}

export async function savePasskey(record: PasskeyRecord): Promise<void> {
  const normalized = normalizeEmail(record.email);
  const rpId = normalizeRpId(record.rpID);
  const transportsJson = JSON.stringify(record.transports ?? []);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const existing = await tx.queryOne<{ email: string }>(
      'SELECT email FROM passkeys WHERE email = ? AND rp_id = ?',
      [normalized, rpId]
    );
    if (existing) {
      await tx.execute(
        `UPDATE passkeys
         SET credential_id = ?, credential_public_key = ?, counter = ?, transports = ?, user_id = ?, created_at = ?
         WHERE email = ? AND rp_id = ?`,
        [
          record.credentialID,
          record.credentialPublicKey,
          record.counter,
          transportsJson,
          record.userID,
          record.createdAt,
          normalized,
          rpId,
        ]
      );
    } else {
      await tx.execute(
        `INSERT INTO passkeys (email, rp_id, credential_id, credential_public_key, counter, transports, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized,
          rpId,
          record.credentialID,
          record.credentialPublicKey,
          record.counter,
          transportsJson,
          record.userID,
          record.createdAt,
        ]
      );
    }
  });
}

// Deletes a passkey for a specific domain (when called from Account on that domain)
// or all passkeys across every domain (when an admin resets an account).
export async function deletePasskey(email: string, rpId?: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const db = await getDb();
  if (rpId !== undefined) {
    await db.execute('DELETE FROM passkeys WHERE email = ? AND rp_id = ?', [
      normalized,
      normalizeRpId(rpId),
    ]);
  } else {
    await db.execute('DELETE FROM passkeys WHERE email = ?', [normalized]);
  }
}

export function getUserID(email: string): string {
  const digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest();
  return toBase64Url(digest.subarray(0, USER_ID_BYTES));
}

function purgeExpiredChallenges(now: number): void {
  for (const [key, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(key);
  }
  while (challenges.size >= MAX_CHALLENGES) {
    const oldestKey = challenges.keys().next().value;
    if (!oldestKey) break;
    challenges.delete(oldestKey);
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
