import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export type CompressionType = 'brotli' | 'gzip' | 'none';
export type SqlEngineType = 'sqlite' | 'postgres' | 'mysql';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  dataDir: string;
  trustProxy: boolean;
  pasteExpirationDays: number;
  database: {
    engine: SqlEngineType;
    sqlitePath: string;
    postgresUri?: string;
    mysqlUri?: string;
  };
  compression: {
    type: CompressionType;
    quality: number;
  };
  rateLimit: {
    pastePerMin: number;
    authPer5Min: number;
    totpPer5Min: number;
  };
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDataDir(): string {
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveDataPath(value: string | undefined, fallback: string, dataDir = getDataDir()): string {
  const raw = value && value.trim() ? value.trim() : fallback;
  if (path.isAbsolute(raw)) return raw;
  const relative = raw.replace(/^\.\//, '').replace(/^data[\\/]/, '');
  return path.join(dataDir, relative);
}

function resolveSqlEngine(raw: string | undefined): SqlEngineType {
  const normalized = (raw || 'SQLite').trim().toLowerCase();
  if (normalized === 'postgres' || normalized === 'postgresql' || normalized === 'pg') {
    return 'postgres';
  }
  if (normalized === 'mysql' || normalized === 'mariadb') {
    return 'mysql';
  }
  return 'sqlite';
}

function resolveCompressionType(raw: string | undefined): CompressionType {
  const normalized = (raw || 'brotli').trim().toLowerCase();
  if (normalized === 'gzip') return 'gzip';
  if (normalized === 'none') return 'none';
  return 'brotli';
}

function toBrotliQuality(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(11, Math.max(0, parsed));
}

export function getConfig(): AppConfig {
  const dataDir = getDataDir();
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: toInt(process.env.PORT, 3000),
    dataDir,
    trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
    pasteExpirationDays: toInt(process.env.PASTE_EXPIRATION_DAYS, 30),
    database: {
      engine: resolveSqlEngine(process.env.DATABASE__SAVE_TYPE),
      sqlitePath: resolveDataPath(process.env.DATABASE__SQLITE_DB_PATH, 'pastes.db', dataDir),
      postgresUri: process.env.DATABASE__POSTGRES_URI?.trim() || undefined,
      mysqlUri: (process.env.DATABASE__MARIADB_URI || process.env.DATABASE__MYSQL_URI)?.trim() || undefined,
    },
    compression: {
      type: resolveCompressionType(process.env.COMPRESSION_TYPE || process.env.COMPRESSION__TYPE),
      quality: toBrotliQuality(process.env.COMPRESSION_QUALITY || process.env.COMPRESSION__QUALITY, 11),
    },
    rateLimit: {
      pastePerMin: toInt(process.env.RATE_LIMIT_PASTE_PER_MIN, 30),
      authPer5Min: toInt(process.env.RATE_LIMIT_AUTH_PER_5MIN, 10),
      totpPer5Min: toInt(process.env.RATE_LIMIT_2FA_PER_5MIN, 6),
    },
  };
}
