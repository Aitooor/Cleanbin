import type { SqlAdapter } from './adapter.js';

async function createIndexSafe(adapter: SqlAdapter, indexName: string, tableName: string, columnsSql: string): Promise<void> {
  if (adapter.dialect === 'mysql') {
    try {
      await adapter.execute(`CREATE INDEX ${indexName} ON ${tableName} (${columnsSql})`);
    } catch (error) {
      const code = (error as { code?: string; errno?: number } | undefined)?.code;
      const errno = (error as { errno?: number } | undefined)?.errno;
      if (code === 'ER_DUP_KEYNAME' || errno === 1061) return;
      throw error;
    }
    return;
  }
  await adapter.execute(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnsSql})`);
}

async function upgradeExistingSqliteSchema(adapter: SqlAdapter): Promise<void> {
  if (adapter.dialect !== 'sqlite') return;

  // Legacy Cleanbin v1 used schema_meta(key, value) instead of (meta_key, meta_value).
  // Keep our metadata table distinct as cleanbin_meta so legacy keys never collide.
  const pasteCols = await adapter.query<{ name: string }>('PRAGMA table_info(pastes)');
  if (pasteCols.length > 0) {
    const existing = new Set(pasteCols.map((c) => c.name));
    if (!existing.has('name')) {
      await adapter.execute("ALTER TABLE pastes ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    }
    if (!existing.has('permanent')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0');
    }
    if (!existing.has('created_at')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0');
    }
    if (!existing.has('updated_at')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0');
    }
    if (!existing.has('expires_at')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN expires_at BIGINT NULL');
    }
    if (!existing.has('owner')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN owner TEXT NULL');
    }
    if (!existing.has('shared_with')) {
      await adapter.execute("ALTER TABLE pastes ADD COLUMN shared_with TEXT NOT NULL DEFAULT '[]'");
    }
    if (!existing.has('version')) {
      await adapter.execute('ALTER TABLE pastes ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
  }
}

export async function ensureSchema(adapter: SqlAdapter): Promise<void> {
  const payloadType = adapter.dialect === 'mysql' ? 'LONGTEXT' : 'TEXT';

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS cleanbin_meta (
      meta_key VARCHAR(128) PRIMARY KEY,
      meta_value TEXT NOT NULL
    )
  `);

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS pastes (
      id VARCHAR(64) PRIMARY KEY,
      name TEXT NOT NULL,
      payload ${payloadType} NOT NULL,
      permanent INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      expires_at BIGINT NULL,
      owner VARCHAR(255) NULL,
      shared_with TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )
  `);

  await upgradeExistingSqliteSchema(adapter);

  await createIndexSafe(adapter, 'idx_pastes_expires_at', 'pastes', 'expires_at');
  await createIndexSafe(adapter, 'idx_pastes_created_at', 'pastes', 'created_at');
  await createIndexSafe(adapter, 'idx_pastes_owner', 'pastes', 'owner');

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS users (
      email VARCHAR(255) PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role VARCHAR(16) NOT NULL,
      permanent_delete_limit INTEGER NOT NULL DEFAULT 0,
      created_at VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL,
      totp_secret TEXT NULL,
      totp_enabled_at VARCHAR(64) NULL,
      last_totp_step BIGINT NULL,
      invite_token_hash VARCHAR(128) NULL,
      invite_expires_at VARCHAR(64) NULL
    )
  `);

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(16) NOT NULL,
      user_agent VARCHAR(512) NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      last_seen_at VARCHAR(64) NOT NULL,
      revoked_at VARCHAR(64) NULL
    )
  `);
  await createIndexSafe(adapter, 'idx_sessions_email', 'sessions', 'email');

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS passkeys (
      email VARCHAR(255) NOT NULL,
      rp_id VARCHAR(255) NOT NULL DEFAULT '',
      credential_id VARCHAR(512) NOT NULL UNIQUE,
      credential_public_key TEXT NOT NULL,
      counter BIGINT NOT NULL,
      transports TEXT NOT NULL,
      user_id VARCHAR(128) NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      PRIMARY KEY (email, rp_id)
    )
  `);
}
