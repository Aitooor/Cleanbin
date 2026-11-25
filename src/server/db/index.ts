import { getConfig } from '../config.js';
import {
  createMysqlAdapter,
  createPostgresAdapter,
  createSqliteAdapter,
  type SqlAdapter,
} from './adapter.js';
import { ensureSchema } from './schema.js';
import { runLegacyMigrations } from './migrateLegacy.js';

let activeAdapter: SqlAdapter | null = null;
let initPromise: Promise<SqlAdapter> | null = null;

export async function getDb(): Promise<SqlAdapter> {
  if (activeAdapter) return activeAdapter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cfg = getConfig();
    let adapter: SqlAdapter;
    if (cfg.database.engine === 'postgres') {
      if (!cfg.database.postgresUri) {
        throw new Error('DATABASE__POSTGRES_URI is required when DATABASE__SAVE_TYPE=PostgreSQL');
      }
      adapter = await createPostgresAdapter(cfg.database.postgresUri);
    } else if (cfg.database.engine === 'mysql') {
      if (!cfg.database.mysqlUri) {
        throw new Error('DATABASE__MARIADB_URI is required when DATABASE__SAVE_TYPE=MariaDB/MySQL');
      }
      adapter = await createMysqlAdapter(cfg.database.mysqlUri);
    } else {
      adapter = createSqliteAdapter(cfg.database.sqlitePath);
    }

    await ensureSchema(adapter);
    await runLegacyMigrations(adapter, cfg.dataDir);
    activeAdapter = adapter;
    return adapter;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

// Allows tests and graceful shutdown hooks to close and reset the SQL connection.
export async function resetDbForTests(): Promise<void> {
  if (activeAdapter) {
    await activeAdapter.close();
    activeAdapter = null;
  }
  initPromise = null;
}
