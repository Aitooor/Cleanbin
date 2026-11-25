import { getDb } from '../db/index.js';
import type { RegistrationMode } from '../../shared/types.js';

const KEY_REG_MODE = 'registration_mode';
const KEY_DEFAULT_DELETE_LIMIT = 'default_user_delete_limit';

export interface ServerSettings {
  registrationMode: RegistrationMode;
  defaultUserDeleteLimit: number;
}

async function getMetaValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.queryOne<{ meta_value: string }>(
    'SELECT meta_value FROM cleanbin_meta WHERE meta_key = ?',
    [key]
  );
  return row ? row.meta_value : null;
}

async function setMetaValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  const existing = await db.queryOne<{ meta_key: string }>(
    'SELECT meta_key FROM cleanbin_meta WHERE meta_key = ?',
    [key]
  );
  if (existing) {
    await db.execute('UPDATE cleanbin_meta SET meta_value = ? WHERE meta_key = ?', [value, key]);
  } else {
    await db.execute('INSERT INTO cleanbin_meta (meta_key, meta_value) VALUES (?, ?)', [key, value]);
  }
}

export async function getServerSettings(): Promise<ServerSettings> {
  const [rawMode, rawLimit] = await Promise.all([
    getMetaValue(KEY_REG_MODE),
    getMetaValue(KEY_DEFAULT_DELETE_LIMIT),
  ]);

  const envFallback = process.env.REGISTRATION_MODE?.trim().toLowerCase() === 'open' ? 'open' : 'invite';
  const registrationMode: RegistrationMode =
    rawMode === 'open' || rawMode === 'invite' ? rawMode : envFallback;

  const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : 2;
  const defaultUserDeleteLimit = Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 2;

  return { registrationMode, defaultUserDeleteLimit };
}

export async function updateServerSettings(patch: {
  registrationMode?: RegistrationMode;
  defaultUserDeleteLimit?: number;
}): Promise<ServerSettings> {
  if (patch.registrationMode === 'invite' || patch.registrationMode === 'open') {
    await setMetaValue(KEY_REG_MODE, patch.registrationMode);
  }
  if (
    patch.defaultUserDeleteLimit !== undefined &&
    Number.isInteger(patch.defaultUserDeleteLimit) &&
    patch.defaultUserDeleteLimit >= 0
  ) {
    await setMetaValue(KEY_DEFAULT_DELETE_LIMIT, String(patch.defaultUserDeleteLimit));
  }
  return getServerSettings();
}
