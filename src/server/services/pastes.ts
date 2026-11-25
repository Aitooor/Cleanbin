import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { compressPayload, decompressPayload } from '../db/compression.js';
import { normalizeEmail } from '../../shared/validation.js';
import type { PasteRecord } from '../../shared/types.js';

interface PasteRow {
  id: string;
  name: string;
  payload: string;
  permanent: number | string;
  created_at: number | string;
  updated_at: number | string;
  expires_at: number | string | null;
  owner: string | null;
  shared_with: string;
  version: number | string;
}

export interface PasteMetadata {
  id: string;
  name: string;
  permanent: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  owner: string | null;
  sharedWith: string[];
  version: number;
}

export interface UpdatePastePatch {
  name?: string;
  content?: string;
  owner?: string | null;
  sharedWith?: string[];
  expectedVersion?: number;
}

export type UpdatePasteResult =
  | { status: 'ok'; paste: PasteRecord }
  | { status: 'not_found' }
  | { status: 'conflict'; paste: PasteRecord };

function parseSharedWith(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => normalizeEmail(String(e))).filter(Boolean);
  } catch {
    return [];
  }
}

function isRowExpired(row: Pick<PasteRow, 'permanent' | 'expires_at'>, nowMs = Date.now()): boolean {
  const permanent = Number(row.permanent) === 1;
  if (permanent || row.expires_at === null || row.expires_at === undefined) return false;
  const exp = Number(row.expires_at);
  return Number.isFinite(exp) && exp > 0 && exp <= nowMs;
}

async function decodeRow(row: PasteRow): Promise<PasteRecord> {
  const decoded = JSON.parse(await decompressPayload(row.payload)) as Record<string, unknown>;
  const permanent = Number(row.permanent) === 1;
  const createdAtMs = Number(row.created_at) || Date.now();
  const updatedAtMs = Number(row.updated_at) || createdAtMs;
  const expiresAtMs = !permanent && row.expires_at !== null ? Number(row.expires_at) : null;

  return {
    id: row.id,
    content: typeof decoded.content === 'string' ? decoded.content : '',
    name: row.name ?? (typeof decoded.name === 'string' ? decoded.name : ''),
    permanent,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    owner: row.owner ? normalizeEmail(row.owner) : null,
    sharedWith: parseSharedWith(row.shared_with),
    version: Number(row.version) || 1,
  };
}

function computeNextExpiryMs(nowMs = Date.now()): number {
  const days = getConfig().pasteExpirationDays;
  return nowMs + days * 24 * 60 * 60 * 1000;
}

export async function createPaste(
  id: string,
  content: string,
  name: string,
  permanent: boolean,
  owner: string | null = null
): Promise<PasteRecord> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtMs = permanent ? null : computeNextExpiryMs(nowMs);
  const normalizedOwner = owner ? normalizeEmail(owner) : null;

  const record: PasteRecord = {
    id,
    content,
    name,
    permanent,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    owner: normalizedOwner,
    sharedWith: [],
    version: 1,
  };

  const payload = await compressPayload(JSON.stringify(record));
  const db = await getDb();
  await db.execute(
    `INSERT INTO pastes (id, name, payload, permanent, created_at, updated_at, expires_at, owner, shared_with, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 1)`,
    [id, name, payload, permanent ? 1 : 0, nowMs, nowMs, expiresAtMs, normalizedOwner]
  );

  return record;
}

// Reads a paste by ID. Only when `options.touch === true` (an actual visit to
// the public paste view) is a temporary paste's TTL extended. Internal reads
// (dashboard edit, presence checks, delete permission checks) leave TTL intact.
export async function getPaste(
  id: string,
  options: { touch?: boolean } = {}
): Promise<PasteRecord | null> {
  const db = await getDb();
  const nowMs = Date.now();

  if (!options.touch) {
    const row = await db.queryOne<PasteRow>('SELECT * FROM pastes WHERE id = ?', [id]);
    if (!row) return null;
    if (isRowExpired(row, nowMs)) {
      await db.execute('DELETE FROM pastes WHERE id = ?', [id]);
      return null;
    }
    return decodeRow(row);
  }

  return db.transaction(async (tx) => {
    const row = await tx.queryOne<PasteRow>('SELECT * FROM pastes WHERE id = ?', [id]);
    if (!row) return null;
    if (isRowExpired(row, nowMs)) {
      await tx.execute('DELETE FROM pastes WHERE id = ?', [id]);
      return null;
    }

    const decoded = await decodeRow(row);
    if (decoded.permanent) return decoded;

    const newExpiresMs = computeNextExpiryMs(nowMs);
    const refreshed: PasteRecord = {
      ...decoded,
      expiresAt: new Date(newExpiresMs).toISOString(),
    };
    const compressed = await compressPayload(JSON.stringify(refreshed));
    await tx.execute('UPDATE pastes SET payload = ?, expires_at = ? WHERE id = ?', [
      compressed,
      newExpiresMs,
      id,
    ]);
    return refreshed;
  });
}

// Fast metadata lookup that skips Brotli decompression altogether.
export async function getPasteMetadata(id: string): Promise<PasteMetadata | null> {
  const db = await getDb();
  const row = await db.queryOne<Omit<PasteRow, 'payload'>>(
    'SELECT id, name, permanent, created_at, updated_at, expires_at, owner, shared_with, version FROM pastes WHERE id = ?',
    [id]
  );
  if (!row) return null;
  if (isRowExpired(row)) {
    await db.execute('DELETE FROM pastes WHERE id = ?', [id]);
    return null;
  }
  const permanent = Number(row.permanent) === 1;
  const createdMs = Number(row.created_at) || Date.now();
  const updatedMs = Number(row.updated_at) || createdMs;
  const expiresMs = !permanent && row.expires_at !== null ? Number(row.expires_at) : null;
  return {
    id: row.id,
    name: row.name,
    permanent,
    createdAt: new Date(createdMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : null,
    owner: row.owner ? normalizeEmail(row.owner) : null,
    sharedWith: parseSharedWith(row.shared_with),
    version: Number(row.version) || 1,
  };
}

export async function updatePaste(id: string, patch: UpdatePastePatch): Promise<UpdatePasteResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<PasteRow>('SELECT * FROM pastes WHERE id = ?', [id]);
    if (!row) return { status: 'not_found' };
    if (isRowExpired(row)) {
      await tx.execute('DELETE FROM pastes WHERE id = ?', [id]);
      return { status: 'not_found' };
    }

    const current = await decodeRow(row);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== current.version) {
      return { status: 'conflict', paste: current };
    }

    const nowMs = Date.now();
    const next: PasteRecord = {
      ...current,
      name: patch.name !== undefined ? patch.name : current.name,
      content: patch.content !== undefined ? patch.content : current.content,
      owner: patch.owner !== undefined ? (patch.owner ? normalizeEmail(patch.owner) : null) : current.owner,
      sharedWith:
        patch.sharedWith !== undefined
          ? patch.sharedWith.map((e) => normalizeEmail(e)).filter(Boolean)
          : current.sharedWith,
      version: current.version + 1,
      updatedAt: new Date(nowMs).toISOString(),
    };

    const compressed = await compressPayload(JSON.stringify(next));
    await tx.execute(
      `UPDATE pastes
       SET name = ?, payload = ?, updated_at = ?, owner = ?, shared_with = ?, version = ?
       WHERE id = ?`,
      [
        next.name,
        compressed,
        nowMs,
        next.owner,
        JSON.stringify(next.sharedWith),
        next.version,
        id,
      ]
    );

    return { status: 'ok', paste: next };
  });
}

export async function deletePaste(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM pastes WHERE id = ?', [id]);
}

export async function deleteExpiredPastes(): Promise<string[]> {
  const db = await getDb();
  const nowMs = Date.now();
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM pastes WHERE expires_at IS NOT NULL AND expires_at <= ?',
    [nowMs]
  );
  if (rows.length > 0) {
    await db.execute('DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at <= ?', [nowMs]);
  }
  return rows.map((r) => r.id);
}

export async function getAllPastes(): Promise<PasteRecord[]> {
  const db = await getDb();
  await deleteExpiredPastes();
  const rows = await db.query<PasteRow>('SELECT * FROM pastes ORDER BY created_at DESC');
  return Promise.all(rows.map(decodeRow));
}

export async function getPastesPage(
  page: number,
  limit: number
): Promise<{ total: number; items: PasteRecord[] }> {
  const db = await getDb();
  await deleteExpiredPastes();
  const countRow = await db.queryOne<{ total: number | string }>('SELECT COUNT(*) AS total FROM pastes');
  const total = Number(countRow?.total ?? 0);
  const offset = Math.max(0, (page - 1) * limit);
  const rows = await db.query<PasteRow>(
    'SELECT * FROM pastes ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  const items = await Promise.all(rows.map(decodeRow));
  return { total, items };
}
