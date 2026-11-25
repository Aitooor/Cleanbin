import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { SqlEngineType } from '../config.js';

const require = createRequire(import.meta.url);

export interface SqlRunResult {
  changes: number;
}

export interface SqlAdapter {
  readonly dialect: SqlEngineType;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<SqlRunResult>;
  transaction<T>(fn: (tx: SqlAdapter) => Promise<T>): Promise<T>;
  backup?(destinationPath: string): Promise<void>;
  vacuum?(): Promise<void>;
  reclaimPages?(): Promise<void>;
  fileSizeBytes?(): Promise<number>;
  close(): Promise<void>;
}

// Translates standard `?` placeholders into PostgreSQL `$1, $2, ...` parameters
// while leaving `?` inside single-quoted string literals untouched.
export function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  let inSingleQuote = false;
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

interface SyncSqliteDriver {
  exec(sql: string): void;
  queryAll(sql: string, params: unknown[]): Record<string, unknown>[];
  queryGet(sql: string, params: unknown[]): Record<string, unknown> | undefined;
  run(sql: string, params: unknown[]): { changes: number };
  close(): void;
}

function openSqliteDriver(sqlitePath: string): SyncSqliteDriver {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  // Prefer better-sqlite3 when native bindings are available; fall back cleanly
  // to Node's built-in node:sqlite (Node 22.5+ / 24 / 26) if native compilation
  // was skipped on a host without C++ build tools.
  try {
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(sqlitePath);
    return {
      exec: (sql) => db.exec(sql),
      queryAll: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
      queryGet: (sql, params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      run: (sql, params) => {
        const res = db.prepare(sql).run(...params);
        return { changes: Number(res.changes ?? 0) };
      },
      close: () => db.close(),
    };
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(sqlitePath);
    return {
      exec: (sql) => db.exec(sql),
      queryAll: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
      queryGet: (sql, params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      run: (sql, params) => {
        const res = db.prepare(sql).run(...params);
        return { changes: Number(res.changes ?? 0) };
      },
      close: () => db.close(),
    };
  }
}

export function createSqliteAdapter(sqlitePath: string): SqlAdapter {
  const driver = openSqliteDriver(sqlitePath);
  driver.exec('PRAGMA auto_vacuum = INCREMENTAL;');
  driver.exec('PRAGMA journal_mode = WAL;');
  driver.exec('PRAGMA synchronous = NORMAL;');
  driver.exec('PRAGMA foreign_keys = ON;');
  driver.exec('PRAGMA busy_timeout = 5000;');

  // Serializes transactions on this single SQLite connection so async callbacks
  // inside a transaction can never interleave statements from concurrent requests.
  let txLock: Promise<void> = Promise.resolve();

  const baseAdapter: SqlAdapter = {
    dialect: 'sqlite',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return driver.queryAll(sql, params) as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const row = driver.queryGet(sql, params);
      return (row as T | undefined) ?? null;
    },
    async execute(sql: string, params: unknown[] = []): Promise<SqlRunResult> {
      if (params.length === 0 && !sql.trim().match(/^(INSERT|UPDATE|DELETE)/i)) {
        driver.exec(sql);
        return { changes: 0 };
      }
      return driver.run(sql, params);
    },
    async transaction<T>(fn: (tx: SqlAdapter) => Promise<T>): Promise<T> {
      let release!: () => void;
      const previous = txLock;
      txLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      driver.exec('BEGIN IMMEDIATE');
      try {
        const txAdapter: SqlAdapter = {
          ...baseAdapter,
          transaction: (nestedFn) => nestedFn(txAdapter),
        };
        const out = await fn(txAdapter);
        driver.exec('COMMIT');
        return out;
      } catch (error) {
        try {
          driver.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure if SQLite already rolled back
        }
        throw error;
      } finally {
        release();
      }
    },
    async backup(destinationPath: string): Promise<void> {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
      const escaped = destinationPath.replace(/'/g, "''");
      driver.exec(`VACUUM INTO '${escaped}'`);
    },
    async vacuum(): Promise<void> {
      let release!: () => void;
      const previous = txLock;
      txLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        driver.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        driver.exec('PRAGMA auto_vacuum = INCREMENTAL;');
        driver.exec('VACUUM;');
        driver.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } finally {
        release();
      }
    },
    async reclaimPages(): Promise<void> {
      try {
        driver.exec('PRAGMA incremental_vacuum(64);');
      } catch {
        // Best-effort incremental page reclamation
      }
    },
    async fileSizeBytes(): Promise<number> {
      let total = 0;
      for (const candidate of [sqlitePath, `${sqlitePath}-wal`]) {
        try {
          const st = fs.statSync(candidate);
          if (st.isFile()) total += st.size;
        } catch {
          // Ignore missing -wal file
        }
      }
      return total;
    },
    async close(): Promise<void> {
      await txLock;
      driver.close();
    },
  };

  return baseAdapter;
}

export async function createPostgresAdapter(connectionString: string): Promise<SqlAdapter> {
  const pgModule = await import('pg');
  const PoolCtor = pgModule.default?.Pool ?? pgModule.Pool;
  const pool = new PoolCtor({ connectionString, max: 10 });

  const makeRunner = (queryable: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): SqlAdapter => ({
    dialect: 'postgres',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await queryable.query(toPostgresPlaceholders(sql), params);
      return res.rows as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const res = await queryable.query(toPostgresPlaceholders(sql), params);
      return (res.rows[0] as T | undefined) ?? null;
    },
    async execute(sql: string, params: unknown[] = []): Promise<SqlRunResult> {
      const res = await queryable.query(toPostgresPlaceholders(sql), params);
      return { changes: Number(res.rowCount ?? 0) };
    },
    async transaction<T>(fn: (tx: SqlAdapter) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txRunner: SqlAdapter = {
          ...makeRunner(client),
          transaction: (nested) => nested(txRunner),
        };
        const result = await fn(txRunner);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  });

  return makeRunner(pool);
}

export async function createMysqlAdapter(uri: string): Promise<SqlAdapter> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    uri,
    connectionLimit: 10,
    waitForConnections: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeRunner = (conn: { query: (sql: string, values?: any[]) => Promise<[unknown, unknown]> }): SqlAdapter => ({
    dialect: 'mysql',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await conn.query(sql, params);
      return (Array.isArray(rows) ? rows : []) as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const [rows] = await conn.query(sql, params);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows[0] as T;
    },
    async execute(sql: string, params: unknown[] = []): Promise<SqlRunResult> {
      const [result] = await conn.query(sql, params);
      const affected = (result as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
      return { changes: Number(affected) };
    },
    async transaction<T>(fn: (tx: SqlAdapter) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const txRunner: SqlAdapter = {
          ...makeRunner(connection),
          transaction: (nested) => nested(txRunner),
        };
        const out = await fn(txRunner);
        await connection.commit();
        return out;
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  });

  return makeRunner(pool);
}
