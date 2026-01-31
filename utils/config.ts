// Lightweight config loader that supports "namespaced" env keys using double underscores.
// Example: DATABASE__SAVE_TYPE -> config.database.save_type
type AnyObj = Record<string, any>;

function parseNamespaced(prefix: string): AnyObj {
  const out: AnyObj = {};
  const upperPrefix = prefix.toUpperCase() + '__';
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(upperPrefix)) continue;
    const sub = key.slice(upperPrefix.length); // rest after prefix__
    const parts = sub.split('__').map(p => p.toLowerCase());
    let cur = out;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = process.env[key];
      } else {
        cur[p] = cur[p] ?? {};
        cur = cur[p];
      }
    }
  }
  return out;
}

export type DatabaseConfig = {
  save_type: string;
  json_db_path?: string;
  sqlite_db_path?: string;
  mongodb_uri?: string;
  postgres_uri?: string;
  mariadb_uri?: string;
  cassandra_uri?: string;
};

export type CacheConfig = {
  type: string;
  ttl: number;
};

export type AppConfig = {
  database: DatabaseConfig;
  cache: CacheConfig;
  // raw parsed cache-specific settings (from CACHE__* namespaced vars)
  cache_settings: AnyObj;
};

function toNumber(v: string | undefined, fallback = 3600) {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AppConfig = {
  database: {
    save_type: (process.env.DATABASE__SAVE_TYPE ||
      process.env.DATABASE__SAVE_TYPE?.toString() ||
      parseNamespaced('DATABASE').save_type ||
      process.env.DATABASE__SAVE_TYPE ||
      'JSON') as string,
    json_db_path:
      process.env.DATABASE__JSON_DB_PATH || parseNamespaced('DATABASE').json_db_path || './data/pastes/',
    sqlite_db_path:
      process.env.DATABASE__SQLITE_DB_PATH || parseNamespaced('DATABASE').sqlite_db_path || './data/pastes.db',
    mongodb_uri:
      process.env.DATABASE__MONGODB_URI || parseNamespaced('DATABASE').mongodb_uri,
    postgres_uri:
      process.env.DATABASE__POSTGRES_URI || parseNamespaced('DATABASE').postgres_uri,
    mariadb_uri:
      process.env.DATABASE__MARIADB_URI || parseNamespaced('DATABASE').mariadb_uri,
    cassandra_uri:
      process.env.DATABASE__CASSANDRA_URI || parseNamespaced('DATABASE').cassandra_uri,
  },
  cache: {
    type:
      process.env.CACHE_TYPE ||
      (parseNamespaced('CACHE').type as string) ||
      'In-memory',
    ttl: toNumber(process.env.CACHE_TTL || String(parseNamespaced('CACHE').ttl), 3600),
  },
  cache_settings: parseNamespaced('CACHE'),
};

export default config;

