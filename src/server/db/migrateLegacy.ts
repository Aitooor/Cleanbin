import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { SqlAdapter } from './adapter.js';
import { compressContentCompact, decompressBufferAuto, decompressPayload } from './compression.js';
import { compactAllPastes } from '../services/pastes.js';
import { isValidPasteId, normalizeEmail } from '../../shared/validation.js';

const BCRYPT_ROUNDS = 10;

function isBcryptHash(value: string): boolean {
  return /^\$2[aby]?\$\d{2}\$/.test(value);
}

async function getMeta(adapter: SqlAdapter, key: string): Promise<string | null> {
  const row = await adapter.queryOne<{ meta_value: string }>(
    'SELECT meta_value FROM cleanbin_meta WHERE meta_key = ?',
    [key]
  );
  return row?.meta_value ?? null;
}

async function setMeta(adapter: SqlAdapter, key: string, value: string): Promise<void> {
  const existing = await getMeta(adapter, key);
  if (existing !== null) {
    await adapter.execute('UPDATE cleanbin_meta SET meta_value = ? WHERE meta_key = ?', [value, key]);
  } else {
    await adapter.execute('INSERT INTO cleanbin_meta (meta_key, meta_value) VALUES (?, ?)', [key, value]);
  }
}

function toTimestampMs(iso: unknown, fallback: number): number {
  if (typeof iso === 'number' && Number.isFinite(iso)) return iso;
  if (typeof iso === 'string' && iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

async function backfillLegacyPastesRows(adapter: SqlAdapter): Promise<void> {
  if (await getMeta(adapter, 'pastes_v2_backfill')) return;

  const legacyRows = await adapter.query<{ id: string; payload: string }>(
    'SELECT id, payload FROM pastes WHERE created_at = 0'
  );

  if (legacyRows.length > 0) {
    await adapter.transaction(async (tx) => {
      for (const row of legacyRows) {
        try {
          const decoded = JSON.parse(await decompressPayload(row.payload)) as Record<string, unknown>;
          const now = Date.now();
          const createdAt = toTimestampMs(decoded.createdAt, now);
          const updatedAt = toTimestampMs(decoded.updatedAt, createdAt);
          const permanent = decoded.permanent === true || decoded.permanent === 'true' ? 1 : 0;
          const expiresAt =
            !permanent && decoded.expiresAt ? toTimestampMs(decoded.expiresAt, now + 30 * 86400_000) : null;
          const name = typeof decoded.name === 'string' ? decoded.name : '';
          const owner = typeof decoded.owner === 'string' && decoded.owner.trim() ? normalizeEmail(decoded.owner) : null;
          const sharedWith = Array.isArray(decoded.sharedWith)
            ? JSON.stringify(decoded.sharedWith.map((e) => normalizeEmail(String(e))).filter(Boolean))
            : '[]';
          const version = typeof decoded.version === 'number' && decoded.version > 0 ? decoded.version : 1;

          await tx.execute(
            `UPDATE pastes
             SET name = ?, permanent = ?, created_at = ?, updated_at = ?, expires_at = ?, owner = ?, shared_with = ?, version = ?
             WHERE id = ?`,
            [name, permanent, createdAt, updatedAt, expiresAt, owner, sharedWith, version, row.id]
          );
        } catch {
          // Leave unreadable rows untouched so no data is destroyed
        }
      }
    });
  }

  await setMeta(adapter, 'pastes_v2_backfill', '1');
}

async function readJsonFileOrNull(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function migrateUsersJson(adapter: SqlAdapter, dataDir: string): Promise<void> {
  const usersJson = await readJsonFileOrNull(path.join(dataDir, 'users.json'));
  const adminsJson = usersJson === null ? await readJsonFileOrNull(path.join(dataDir, 'admins.json')) : null;

  const entries: Record<string, unknown>[] = Array.isArray(usersJson)
    ? (usersJson as Record<string, unknown>[])
    : Array.isArray(adminsJson)
      ? (adminsJson as Record<string, unknown>[])
      : [];

  if (entries.length === 0) return;

  await adapter.transaction(async (tx) => {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const email = typeof entry.email === 'string' ? normalizeEmail(entry.email) : '';
      if (!email) continue;

      const existing = await tx.queryOne<{ email: string }>('SELECT email FROM users WHERE email = ?', [email]);
      if (existing) continue;

      let passwordHash = typeof entry.passwordHash === 'string' ? entry.passwordHash : '';
      if (!passwordHash && typeof entry.password === 'string' && entry.password) {
        passwordHash = isBcryptHash(entry.password)
          ? entry.password
          : await bcrypt.hash(entry.password, BCRYPT_ROUNDS);
      }

      const role = entry.role === 'admin' || usersJson === null ? 'admin' : 'user';
      const rawLimit = Number(entry.permanentDeleteLimit);
      const permanentDeleteLimit = Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 0;
      const createdAt = typeof entry.createdAt === 'string' && entry.createdAt ? entry.createdAt : new Date().toISOString();
      const status = entry.status === 'invited' ? 'invited' : 'active';
      const totpSecret = typeof entry.totpSecret === 'string' && entry.totpSecret ? entry.totpSecret : null;
      const totpEnabledAt = typeof entry.totpEnabledAt === 'string' && entry.totpEnabledAt ? entry.totpEnabledAt : null;
      const inviteTokenHash =
        typeof entry.inviteTokenHash === 'string' && entry.inviteTokenHash ? entry.inviteTokenHash : null;
      const inviteExpiresAt =
        typeof entry.inviteExpiresAt === 'string' && entry.inviteExpiresAt ? entry.inviteExpiresAt : null;

      await tx.execute(
        `INSERT INTO users (
          email, password_hash, role, permanent_delete_limit, created_at, status,
          totp_secret, totp_enabled_at, last_totp_step, invite_token_hash, invite_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          email,
          passwordHash,
          role,
          permanentDeleteLimit,
          createdAt,
          status,
          totpSecret,
          totpEnabledAt,
          inviteTokenHash,
          inviteExpiresAt,
        ]
      );
    }
  });
}

async function migrateSessionsJson(adapter: SqlAdapter, dataDir: string): Promise<void> {
  const parsed = await readJsonFileOrNull(path.join(dataDir, 'sessions.json'));
  if (!Array.isArray(parsed) || parsed.length === 0) return;

  await adapter.transaction(async (tx) => {
    for (const raw of parsed) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const email = typeof record.email === 'string' ? normalizeEmail(record.email) : '';
      if (!id || !email) continue;

      const existing = await tx.queryOne<{ id: string }>('SELECT id FROM sessions WHERE id = ?', [id]);
      if (existing) continue;

      const role = record.role === 'admin' ? 'admin' : 'user';
      const userAgent = typeof record.userAgent === 'string' ? record.userAgent.slice(0, 500) : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
      const lastSeenAt = typeof record.lastSeenAt === 'string' ? record.lastSeenAt : createdAt;
      const revokedAt = typeof record.revokedAt === 'string' ? record.revokedAt : null;

      await tx.execute(
        `INSERT INTO sessions (id, email, role, user_agent, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, email, role, userAgent, createdAt, lastSeenAt, revokedAt]
      );
    }
  });
}

async function migratePasskeysJson(adapter: SqlAdapter, dataDir: string): Promise<void> {
  const parsed = await readJsonFileOrNull(path.join(dataDir, 'passkeys.json'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  const obj = parsed as Record<string, unknown>;
  const candidates: Array<[string, unknown]> =
    'passkey' in obj && obj.passkey ? [['', obj.passkey]] : Object.entries(obj);

  if (candidates.length === 0) return;

  const defaultLegacyRpId = (
    process.env.PASSKEY_LEGACY_RP_ID ||
    process.env.PASSKEY_RP_ID ||
    (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : '') ||
    'localhost'
  )
    .trim()
    .toLowerCase();

  await adapter.transaction(async (tx) => {
    for (const [fallbackKey, value] of candidates) {
      if (!value || typeof value !== 'object') continue;
      const rec = value as Record<string, unknown>;
      const email = normalizeEmail(typeof rec.email === 'string' && rec.email ? rec.email : fallbackKey);
      const credentialID = typeof rec.credentialID === 'string' ? rec.credentialID : '';
      const credentialPublicKey = typeof rec.credentialPublicKey === 'string' ? rec.credentialPublicKey : '';
      if (!email || !credentialID || !credentialPublicKey) continue;

      const rpId = typeof rec.rpID === 'string' && rec.rpID.trim() ? rec.rpID.trim().toLowerCase() : defaultLegacyRpId;
      const existing = await tx.queryOne<{ email: string }>(
        'SELECT email FROM passkeys WHERE email = ? AND rp_id = ?',
        [email, rpId]
      );
      if (existing) continue;

      const counter = typeof rec.counter === 'number' && Number.isFinite(rec.counter) ? rec.counter : 0;
      const transports = Array.isArray(rec.transports) ? JSON.stringify(rec.transports) : '[]';
      const userID = typeof rec.userID === 'string' ? rec.userID : email;
      const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString();

      await tx.execute(
        `INSERT INTO passkeys (email, rp_id, credential_id, credential_public_key, counter, transports, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [email, rpId, credentialID, credentialPublicKey, counter, transports, userID, createdAt]
      );
    }
  });
}

async function migrateJsonPasteFiles(adapter: SqlAdapter, dataDir: string): Promise<void> {
  const pastesDir = path.join(dataDir, 'pastes');
  let files: string[];
  try {
    files = await fs.readdir(pastesDir);
  } catch {
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  if (jsonFiles.length === 0) return;

  for (const file of jsonFiles) {
    try {
      const buf = await fs.readFile(path.join(pastesDir, file));
      const text = await decompressBufferAuto(buf);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const id = typeof parsed.id === 'string' ? parsed.id : file.slice(0, -5);
      if (!isValidPasteId(id)) continue;

      const existing = await adapter.queryOne<{ id: string }>('SELECT id FROM pastes WHERE id = ?', [id]);
      if (existing) continue;

      const now = Date.now();
      const createdAt = toTimestampMs(parsed.createdAt, now);
      const updatedAt = toTimestampMs(parsed.updatedAt, createdAt);
      const permanent = parsed.permanent === true || parsed.permanent === 'true' ? 1 : 0;
      const expiresAt =
        !permanent && parsed.expiresAt ? toTimestampMs(parsed.expiresAt, now + 30 * 86400_000) : null;
      const name = typeof parsed.name === 'string' ? parsed.name : '';
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      const owner = typeof parsed.owner === 'string' && parsed.owner.trim() ? normalizeEmail(parsed.owner) : null;
      const sharedWithArr = Array.isArray(parsed.sharedWith)
        ? parsed.sharedWith.map((e) => normalizeEmail(String(e))).filter(Boolean)
        : [];
      const version = typeof parsed.version === 'number' && parsed.version > 0 ? parsed.version : 1;

      const compact = await compressContentCompact(content, adapter.dialect);

      await adapter.execute(
        `INSERT INTO pastes (
          id, name, payload, permanent, sliding_ttl, raw_bytes, stored_bytes,
          created_at, updated_at, expires_at, owner, shared_with, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          compact.payload,
          permanent,
          permanent === 1 ? 0 : 1,
          compact.rawBytes,
          compact.storedBytes,
          createdAt,
          updatedAt,
          expiresAt,
          owner,
          JSON.stringify(sharedWithArr),
          version,
        ]
      );
    } catch {
      // Skip unreadable file
    }
  }
}

export async function runLegacyMigrations(adapter: SqlAdapter, dataDir: string): Promise<void> {
  await backfillLegacyPastesRows(adapter);

  if (!(await getMeta(adapter, 'legacy_json_stores_migrated'))) {
    await migrateUsersJson(adapter, dataDir);
    await migrateSessionsJson(adapter, dataDir);
    await migratePasskeysJson(adapter, dataDir);
    await migrateJsonPasteFiles(adapter, dataDir);
    await setMeta(adapter, 'legacy_json_stores_migrated', '1');
  }

  if (!(await getMeta(adapter, 'pastes_v22_compact'))) {
    await compactAllPastes(adapter);
    await setMeta(adapter, 'pastes_v22_compact', '1');
  }
}
