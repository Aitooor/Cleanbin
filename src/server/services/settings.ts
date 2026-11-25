import { getDb } from '../db/index.js';
import type { RegistrationMode } from '../../shared/types.js';

const KEY_REG_MODE = 'registration_mode';
const KEY_REQUIRE_EMAIL_VERIFICATION = 'require_email_verification';
const KEY_DEFAULT_DELETE_LIMIT = 'default_user_delete_limit';
const KEY_MAX_PASTES_PER_USER = 'max_pastes_per_user';
const KEY_MAX_PUBLIC_PASTES_PER_USER = 'max_public_pastes_per_user';
const KEY_MAX_PRIVATE_PASTES_PER_USER = 'max_private_pastes_per_user';
const KEY_MAX_STORAGE_MB_PER_USER = 'max_storage_mb_per_user';

export interface ServerSettings {
  registrationMode: RegistrationMode;
  requireEmailVerification: boolean;
  defaultUserDeleteLimit: number;
  maxPastesPerUser: number;
  maxPublicPastesPerUser: number;
  maxPrivatePastesPerUser: number;
  maxStorageMbPerUser: number;
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
  const [rawMode, rawVerify, rawLimit, rawMaxPastes, rawMaxPublic, rawMaxPrivate, rawMaxStorageMb] =
    await Promise.all([
      getMetaValue(KEY_REG_MODE),
      getMetaValue(KEY_REQUIRE_EMAIL_VERIFICATION),
      getMetaValue(KEY_DEFAULT_DELETE_LIMIT),
      getMetaValue(KEY_MAX_PASTES_PER_USER),
      getMetaValue(KEY_MAX_PUBLIC_PASTES_PER_USER),
      getMetaValue(KEY_MAX_PRIVATE_PASTES_PER_USER),
      getMetaValue(KEY_MAX_STORAGE_MB_PER_USER),
    ]);

  const envFallback = process.env.REGISTRATION_MODE?.trim().toLowerCase() === 'open' ? 'open' : 'invite';
  const registrationMode: RegistrationMode =
    rawMode === 'open' || rawMode === 'invite' ? rawMode : envFallback;

  const requireEmailVerification = rawVerify === '1' || rawVerify === 'true';

  const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : 2;
  const defaultUserDeleteLimit = Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 2;

  const readCount = (raw: string | null, fallback: number): number => {
    const parsed = raw !== null ? Number.parseInt(raw, 10) : fallback;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const maxPastesPerUser = readCount(rawMaxPastes, 100);
  const maxPublicPastesPerUser = readCount(rawMaxPublic, 0);
  const maxPrivatePastesPerUser = readCount(rawMaxPrivate, 25);

  const parsedMaxMb = rawMaxStorageMb !== null ? Number.parseFloat(rawMaxStorageMb) : 10;
  const maxStorageMbPerUser =
    Number.isFinite(parsedMaxMb) && parsedMaxMb >= 0 ? Math.round(parsedMaxMb * 100) / 100 : 10;

  return {
    registrationMode,
    requireEmailVerification,
    defaultUserDeleteLimit,
    maxPastesPerUser,
    maxPublicPastesPerUser,
    maxPrivatePastesPerUser,
    maxStorageMbPerUser,
  };
}

export async function updateServerSettings(patch: {
  registrationMode?: RegistrationMode;
  requireEmailVerification?: boolean;
  defaultUserDeleteLimit?: number;
  maxPastesPerUser?: number;
  maxPublicPastesPerUser?: number;
  maxPrivatePastesPerUser?: number;
  maxStorageMbPerUser?: number;
}): Promise<ServerSettings> {
  if (patch.registrationMode === 'invite' || patch.registrationMode === 'open') {
    await setMetaValue(KEY_REG_MODE, patch.registrationMode);
  }
  if (typeof patch.requireEmailVerification === 'boolean') {
    await setMetaValue(KEY_REQUIRE_EMAIL_VERIFICATION, patch.requireEmailVerification ? '1' : '0');
  }
  if (
    patch.defaultUserDeleteLimit !== undefined &&
    Number.isInteger(patch.defaultUserDeleteLimit) &&
    patch.defaultUserDeleteLimit >= 0
  ) {
    await setMetaValue(KEY_DEFAULT_DELETE_LIMIT, String(patch.defaultUserDeleteLimit));
  }
  const countKeys: Array<[number | undefined, string]> = [
    [patch.maxPastesPerUser, KEY_MAX_PASTES_PER_USER],
    [patch.maxPublicPastesPerUser, KEY_MAX_PUBLIC_PASTES_PER_USER],
    [patch.maxPrivatePastesPerUser, KEY_MAX_PRIVATE_PASTES_PER_USER],
  ];
  for (const [value, key] of countKeys) {
    if (value !== undefined && Number.isInteger(value) && value >= 0) {
      await setMetaValue(key, String(value));
    }
  }
  if (
    patch.maxStorageMbPerUser !== undefined &&
    Number.isFinite(patch.maxStorageMbPerUser) &&
    patch.maxStorageMbPerUser >= 0
  ) {
    const rounded = Math.round(patch.maxStorageMbPerUser * 100) / 100;
    await setMetaValue(KEY_MAX_STORAGE_MB_PER_USER, String(rounded));
  }
  return getServerSettings();
}
