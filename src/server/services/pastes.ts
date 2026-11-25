import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import type { SqlAdapter } from '../db/adapter.js';
import {
  compressContentCompact,
  decompressRowContent,
  measureStoredBytes,
} from '../db/compression.js';
import { normalizeEmail } from '../../shared/validation.js';
import type { PasteRecord, PasteTtlOption, StorageStats } from '../../shared/types.js';

interface PasteRow {
  id: string;
  name: string;
  payload: string | Buffer | Uint8Array;
  permanent: number | string;
  burn_after_read?: number | string;
  sliding_ttl?: number | string;
  raw_bytes?: number | string;
  stored_bytes?: number | string;
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
  burnAfterRead: boolean;
  rawBytes: number;
  storedBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  owner: string | null;
  sharedWith: string[];
  version: number;
}

export interface CreatePasteOptions {
  ttl?: PasteTtlOption;
  burnAfterRead?: boolean;
  sharedWith?: string[];
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

const TTL_MS_BY_OPTION: Record<'1h' | '24h' | '7d' | '30d', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

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
  const decoded = await decompressRowContent(row.payload);
  const legacy = decoded.legacyMeta ?? {};
  const permanent = Number(row.permanent) === 1;
  const burnAfterRead =
    Number(row.burn_after_read ?? 0) === 1 || legacy.burnAfterRead === true;
  const slidingTtl =
    row.sliding_ttl !== undefined
      ? Number(row.sliding_ttl) !== 0 && legacy.slidingTtl !== false
      : legacy.slidingTtl !== false;
  const createdAtMs = Number(row.created_at) || Date.now();
  const updatedAtMs = Number(row.updated_at) || createdAtMs;
  const expiresAtMs = !permanent && row.expires_at !== null ? Number(row.expires_at) : null;

  return {
    id: row.id,
    content: decoded.content,
    name: row.name || (typeof legacy.name === 'string' ? legacy.name : ''),
    permanent,
    burnAfterRead,
    slidingTtl,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    owner: row.owner ? normalizeEmail(row.owner) : null,
    sharedWith: parseSharedWith(row.shared_with),
    version: Number(row.version) || 1,
  };
}

function computeDefaultExpiryMs(nowMs = Date.now()): number {
  const days = getConfig().pasteExpirationDays;
  return nowMs + days * 24 * 60 * 60 * 1000;
}

export async function createPaste(
  id: string,
  content: string,
  name: string,
  permanent: boolean,
  owner: string | null = null,
  sharedWithOrOptions?: string[] | CreatePasteOptions
): Promise<PasteRecord> {
  const opts: CreatePasteOptions = Array.isArray(sharedWithOrOptions)
    ? { sharedWith: sharedWithOrOptions }
    : sharedWithOrOptions ?? {};

  const burnAfterRead = !permanent && (opts.burnAfterRead === true || opts.ttl === 'burn');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let expiresAtMs: number | null = null;
  let slidingTtl = true;

  if (!permanent) {
    if (opts.ttl === '1h' || opts.ttl === '24h' || opts.ttl === '7d') {
      expiresAtMs = nowMs + TTL_MS_BY_OPTION[opts.ttl];
      slidingTtl = false;
    } else if (burnAfterRead) {
      // Unopened burn-after-read pastes auto-expire after 7 days if never read.
      expiresAtMs = nowMs + TTL_MS_BY_OPTION['7d'];
      slidingTtl = false;
    } else {
      expiresAtMs = computeDefaultExpiryMs(nowMs);
      slidingTtl = true;
    }
  } else {
    slidingTtl = false;
  }

  const normalizedOwner = owner ? normalizeEmail(owner) : null;
  const shared = (opts.sharedWith ?? []).map((e) => normalizeEmail(e)).filter(Boolean);

  const db = await getDb();
  const compact = await compressContentCompact(content, db.dialect);

  await db.execute(
    `INSERT INTO pastes (
      id, name, payload, permanent, burn_after_read, sliding_ttl,
      raw_bytes, stored_bytes, created_at, updated_at, expires_at, owner, shared_with, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      name,
      compact.payload,
      permanent ? 1 : 0,
      burnAfterRead ? 1 : 0,
      slidingTtl ? 1 : 0,
      compact.rawBytes,
      compact.storedBytes,
      nowMs,
      nowMs,
      expiresAtMs,
      normalizedOwner,
      JSON.stringify(shared),
    ]
  );

  return {
    id,
    content,
    name,
    permanent,
    burnAfterRead,
    slidingTtl,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    owner: normalizedOwner,
    sharedWith: shared,
    version: 1,
  };
}

// Reads a paste by ID.
// - When `options.touch === true` (an actual visit to `/:id` or `/raw/:id`):
//   * If `burnAfterRead` is true, atomically deletes the paste from SQL and returns `burned: true`.
//   * If `slidingTtl` is true on a temporary paste, updates ONLY `expires_at` (zero payload re-write!).
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
      await db.reclaimPages?.();
      return null;
    }
    return decodeRow(row);
  }

  const outcome = await db.transaction(async (tx) => {
    const row = await tx.queryOne<PasteRow>('SELECT * FROM pastes WHERE id = ?', [id]);
    if (!row) return { record: null as PasteRecord | null, deleted: false };
    if (isRowExpired(row, nowMs)) {
      await tx.execute('DELETE FROM pastes WHERE id = ?', [id]);
      return { record: null as PasteRecord | null, deleted: true };
    }

    const decoded = await decodeRow(row);

    if (decoded.burnAfterRead) {
      await tx.execute('DELETE FROM pastes WHERE id = ?', [id]);
      return {
        record: {
          ...decoded,
          burned: true,
          expiresAt: null,
        },
        deleted: true,
      };
    }

    if (decoded.permanent || decoded.slidingTtl === false) {
      return { record: decoded, deleted: false };
    }

    const newExpiresMs = computeDefaultExpiryMs(nowMs);
    await tx.execute('UPDATE pastes SET expires_at = ? WHERE id = ?', [newExpiresMs, id]);
    return {
      record: {
        ...decoded,
        expiresAt: new Date(newExpiresMs).toISOString(),
      },
      deleted: false,
    };
  });

  if (outcome.deleted) {
    await db.reclaimPages?.();
  }
  return outcome.record;
}

// Fast metadata lookup that skips Brotli decompression and SQLite overflow pages.
export async function getPasteMetadata(id: string): Promise<PasteMetadata | null> {
  const db = await getDb();
  const row = await db.queryOne<Omit<PasteRow, 'payload'>>(
    `SELECT id, name, permanent, burn_after_read, raw_bytes, stored_bytes,
            created_at, updated_at, expires_at, owner, shared_with, version
     FROM pastes WHERE id = ?`,
    [id]
  );
  if (!row) return null;
  if (isRowExpired(row)) {
    await db.execute('DELETE FROM pastes WHERE id = ?', [id]);
    await db.reclaimPages?.();
    return null;
  }
  const permanent = Number(row.permanent) === 1;
  const burnAfterRead = Number(row.burn_after_read ?? 0) === 1;
  const createdMs = Number(row.created_at) || Date.now();
  const updatedMs = Number(row.updated_at) || createdMs;
  const expiresMs = !permanent && row.expires_at !== null ? Number(row.expires_at) : null;
  return {
    id: row.id,
    name: row.name,
    permanent,
    burnAfterRead,
    rawBytes: Number(row.raw_bytes ?? 0),
    storedBytes: Number(row.stored_bytes ?? 0),
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

    if (patch.content !== undefined) {
      const compact = await compressContentCompact(next.content, tx.dialect);
      await tx.execute(
        `UPDATE pastes
         SET name = ?, payload = ?, raw_bytes = ?, stored_bytes = ?, updated_at = ?, owner = ?, shared_with = ?, version = ?
         WHERE id = ?`,
        [
          next.name,
          compact.payload,
          compact.rawBytes,
          compact.storedBytes,
          nowMs,
          next.owner,
          JSON.stringify(next.sharedWith),
          next.version,
          id,
        ]
      );
    } else {
      await tx.execute(
        `UPDATE pastes
         SET name = ?, updated_at = ?, owner = ?, shared_with = ?, version = ?
         WHERE id = ?`,
        [
          next.name,
          nowMs,
          next.owner,
          JSON.stringify(next.sharedWith),
          next.version,
          id,
        ]
      );
    }

    return { status: 'ok', paste: next };
  });
}

export async function deletePaste(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM pastes WHERE id = ?', [id]);
  await db.reclaimPages?.();
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
    await db.reclaimPages?.();
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

export async function getUserPasteUsage(
  email: string
): Promise<{ pasteCount: number; rawBytes: number; storedBytes: number }> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { pasteCount: 0, rawBytes: 0, storedBytes: 0 };
  const db = await getDb();
  const nowMs = Date.now();
  const row = await db.queryOne<{
    paste_count: number | string;
    raw_bytes: number | string;
    stored_bytes: number | string;
  }>(
    `SELECT COUNT(*) AS paste_count,
            COALESCE(SUM(raw_bytes), 0) AS raw_bytes,
            COALESCE(SUM(stored_bytes), 0) AS stored_bytes
     FROM pastes
     WHERE owner = ? AND (permanent = 1 OR expires_at IS NULL OR expires_at > ?)`,
    [normalized, nowMs]
  );
  return {
    pasteCount: Number(row?.paste_count ?? 0),
    rawBytes: Number(row?.raw_bytes ?? 0),
    storedBytes: Number(row?.stored_bytes ?? 0),
  };
}

export async function getAllUsersPasteUsage(): Promise<
  Map<string, { pasteCount: number; storedBytes: number }>
> {
  const db = await getDb();
  const nowMs = Date.now();
  const rows = await db.query<{
    owner: string;
    paste_count: number | string;
    stored_bytes: number | string;
  }>(
    `SELECT owner,
            COUNT(*) AS paste_count,
            COALESCE(SUM(stored_bytes), 0) AS stored_bytes
     FROM pastes
     WHERE owner IS NOT NULL AND (permanent = 1 OR expires_at IS NULL OR expires_at > ?)
     GROUP BY owner`,
    [nowMs]
  );
  const out = new Map<string, { pasteCount: number; storedBytes: number }>();
  for (const r of rows) {
    if (r.owner) {
      out.set(normalizeEmail(r.owner), {
        pasteCount: Number(r.paste_count ?? 0),
        storedBytes: Number(r.stored_bytes ?? 0),
      });
    }
  }
  return out;
}

export async function getStorageStats(adapter?: SqlAdapter): Promise<StorageStats> {
  const db = adapter ?? (await getDb());
  const row = await db.queryOne<{
    paste_count: number | string;
    raw_bytes: number | string;
    stored_bytes: number | string;
  }>(
    `SELECT COUNT(*) AS paste_count,
            COALESCE(SUM(raw_bytes), 0) AS raw_bytes,
            COALESCE(SUM(stored_bytes), 0) AS stored_bytes
     FROM pastes`
  );
  const pasteCount = Number(row?.paste_count ?? 0);
  const rawBytes = Number(row?.raw_bytes ?? 0);
  const storedBytes = Number(row?.stored_bytes ?? 0);
  const dbFileBytes = db.fileSizeBytes ? await db.fileSizeBytes() : null;
  const savingsPercent =
    rawBytes > 0 ? Math.max(0, Math.round((1 - storedBytes / rawBytes) * 1000) / 10) : 0;

  return {
    pasteCount,
    rawBytes,
    storedBytes,
    dbFileBytes,
    savingsPercent,
  };
}

// Re-encodes all pastes into the ultra-compact Brotli-11 raw binary format
// and runs SQLite VACUUM + WAL truncation to reclaim every unused 4 KB page on disk.
export async function compactAllPastes(adapter?: SqlAdapter): Promise<StorageStats> {
  const db = adapter ?? (await getDb());
  const nowMs = Date.now();
  await db.execute('DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at <= ?', [nowMs]);

  const rows = await db.query<PasteRow>('SELECT * FROM pastes');
  if (rows.length > 0) {
    const updates: Array<{
      id: string;
      payload: string | Buffer;
      slidingTtl: number;
      rawBytes: number;
      storedBytes: number;
      changed: boolean;
    }> = [];

    for (const row of rows) {
      try {
        const decoded = await decompressRowContent(row.payload);
        const legacy = decoded.legacyMeta ?? {};
        const permanent = Number(row.permanent) === 1;
        const slidingTtl = permanent
          ? 0
          : row.sliding_ttl !== undefined
            ? Number(row.sliding_ttl) !== 0 && legacy.slidingTtl !== false
              ? 1
              : 0
            : legacy.slidingTtl === false
              ? 0
              : 1;

        const compact = await compressContentCompact(decoded.content, db.dialect);
        const currentStored = measureStoredBytes(row.payload);
        const needsRewrite =
          !decoded.isCompact ||
          compact.storedBytes < currentStored ||
          Number(row.raw_bytes ?? 0) !== compact.rawBytes ||
          Number(row.stored_bytes ?? 0) !== Math.min(currentStored, compact.storedBytes);

        if (needsRewrite) {
          const useNew = !decoded.isCompact || compact.storedBytes <= currentStored;
          const finalPayload = useNew ? compact.payload : (row.payload as string | Buffer);
          const finalStored = useNew ? compact.storedBytes : currentStored;
          updates.push({
            id: row.id,
            payload: finalPayload,
            slidingTtl,
            rawBytes: compact.rawBytes,
            storedBytes: finalStored,
            changed: true,
          });
        }
      } catch {
        // Leave unreadable row untouched
      }
    }

    if (updates.length > 0) {
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx.execute(
            `UPDATE pastes
             SET payload = ?, sliding_ttl = ?, raw_bytes = ?, stored_bytes = ?
             WHERE id = ?`,
            [u.payload, u.slidingTtl, u.rawBytes, u.storedBytes, u.id]
          );
        }
      });
    }
  }

  await db.vacuum?.();
  return getStorageStats(db);
}
