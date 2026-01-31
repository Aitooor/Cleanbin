import config from './config';

// Keep server-only requires lazy to avoid bundling drivers into client code
let fs: typeof import('fs/promises') | undefined;
let pathModule: typeof import('path') | undefined;
if (typeof window === 'undefined') {
  fs = require('fs/promises');
  pathModule = require('path');
}

type Paste = {
  id: string;
  content: string;
  name?: string;
  permanent?: boolean | string;
  createdAt: string;
  expiresAt?: string;
};

// Cache abstraction (minimal): in-memory, Redis and Cassandra placeholders
interface CacheBackend {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
}

class InMemoryCache implements CacheBackend {
  private map = new Map<string, { value: any; expiresAt: number }>();
  constructor(private ttlMs: number) {}
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: any, ttlMs?: number) {
    const ttl = ttlMs ?? this.ttlMs;
    this.map.set(key, { value, expiresAt: Date.now() + ttl });
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

function createCache(): CacheBackend {
  const ttlMs = (config.cache.ttl || 3600) * 1000;
  const t = config.cache.type?.toLowerCase() || 'in-memory';
  if (t === 'in-memory' || t === 'in_memory') {
    return new InMemoryCache(ttlMs);
  }
  // Redis
  if (t === 'redis') {
    try {
      // Prefer ioredis if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require('ioredis');
      const client = new IORedis(process.env.REDIS_URL || process.env.REDIS_URI || undefined);
      return {
        get: async (k: string) => {
          const v = await client.get(k);
          return v ? JSON.parse(v) : null;
        },
        set: async (k: string, v: any, ttlMs?: number) => {
          const str = JSON.stringify(v);
          if (ttlMs) await client.set(k, str, 'PX', ttlMs);
          else await client.set(k, str);
        },
        del: async (k: string) => client.del(k),
      };
    } catch (err) {
      throw new Error('Redis cache selected but "ioredis" is not installed. npm i ioredis');
    }
  }
  // Cassandra as cache (advanced) - placeholder that attempts to use cassandra-driver
  if (t === 'cassandra') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cassandra = require('cassandra-driver');
      const client = new cassandra.Client({ contactPoints: ['127.0.0.1'], localDataCenter: 'datacenter1', keyspace: process.env.CASSANDRA_KEYSPACE || 'pastes' });
      return {
        get: async (k: string) => {
          const res = await client.execute('SELECT value FROM cache WHERE key = ?', [k], { prepare: true });
          if (res.rowLength === 0) return null;
          return JSON.parse(res.rows[0].value);
        },
        set: async (k: string, v: any) => {
          await client.execute('INSERT INTO cache (key,value) VALUES (?,?)', [k, JSON.stringify(v)], { prepare: true });
        },
        del: async (k: string) => {
          await client.execute('DELETE FROM cache WHERE key = ?', [k], { prepare: true });
        },
      };
    } catch (err) {
      throw new Error('Cassandra cache selected but "cassandra-driver" is not installed. npm i cassandra-driver');
    }
  }
  // LevelDB (embedded) - stores JSON {value,expiresAt}
  if (t === 'leveldb' || t === 'level' || t === 'level-db') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const level = require('level');
      const levelPath = config.cache_settings.leveldb_path || './data/cache/';
      const db = level(levelPath, { valueEncoding: 'utf8' });
      return {
        get: async (k: string) => {
          try {
            const raw = await db.get(k);
            const parsed = JSON.parse(raw);
            if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
              await db.del(k);
              return null;
            }
            return parsed.value;
          } catch (e: any) {
            if (e.notFound) return null;
            throw e;
          }
        },
        set: async (k: string, v: any, ttlMs?: number) => {
          const expiresAt = ttlMs ? Date.now() + ttlMs : null;
          await db.put(k, JSON.stringify({ value: v, expiresAt }));
        },
        del: async (k: string) => {
          try {
            await db.del(k);
          } catch (e: any) {
            if (e.notFound) return;
            throw e;
          }
        },
      };
    } catch (err) {
      throw new Error('LevelDB cache selected but "level" is not installed. npm i level');
    }
  }
  // SQLite-as-cache (embedded) using better-sqlite3
  if (t === 'sqlite' || t === 'sqlite-cache' || t === 'sqlite3-cache') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const sqlitePath = config.cache_settings.sqlite_db_path || process.env.CACHE__SQLITE_DB_PATH || './data/cache.db';
      const db = new Database(sqlitePath);
      db.exec('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expiresAt INTEGER)');
      return {
        get: async (k: string) => {
          const row = db.prepare('SELECT value, expiresAt FROM cache WHERE key = ?').get(k);
          if (!row) return null;
          if (row.expiresAt && Date.now() > row.expiresAt) {
            db.prepare('DELETE FROM cache WHERE key = ?').run(k);
            return null;
          }
          return JSON.parse(row.value);
        },
        set: async (k: string, v: any, ttlMs?: number) => {
          const expiresAt = ttlMs ? Date.now() + ttlMs : null;
          const str = JSON.stringify(v);
          db.prepare('INSERT OR REPLACE INTO cache (key, value, expiresAt) VALUES (?,?,?)').run(k, str, expiresAt);
        },
        del: async (k: string) => {
          db.prepare('DELETE FROM cache WHERE key = ?').run(k);
        },
      };
    } catch (err) {
      throw new Error('SQLite cache selected but "better-sqlite3" is not installed. npm i better-sqlite3');
    }
  }
  // Default
  return new InMemoryCache(ttlMs);
}

const cache = createCache();

// Database abstraction
interface DatabaseBackend {
  savePaste(id: string, content: string, name: string, permanent: boolean): Promise<string>;
  getPaste(id: string): Promise<Paste | null>;
  deletePaste(id: string): Promise<void>;
  updatePasteName(id: string, newName: string): Promise<Paste | null>;
  deleteExpiredPastes(): Promise<void>;
  getAllPastes(): Promise<Paste[]>;
}

class JsonDatabase implements DatabaseBackend {
  private jsonPath: string;
  constructor(jsonPath: string) {
    this.jsonPath = jsonPath;
  }
  private ensureServer() {
    if (!fs || !pathModule) throw new Error('This function can only be used on the server side.');
  }
  private getFilePath(id: string) {
    return pathModule!.join(this.jsonPath, `${id}.json`);
  }
  async savePaste(id: string, content: string, name: string, permanent: boolean) {
    this.ensureServer();
    const filePath = this.getFilePath(id);
    const data: Paste = {
      id,
      content,
      name,
      permanent: permanent ? 'true' : 'false',
      createdAt: new Date().toISOString(),
    };
    await fs!.mkdir(this.jsonPath, { recursive: true });
    await fs!.writeFile(filePath, JSON.stringify(data, null, 2));
    await cache.set(`paste_${id}`, data);
    return id;
  }
  async getPaste(id: string) {
    this.ensureServer();
    const cacheKey = `paste_${id}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached as Paste;
    const filePath = this.getFilePath(id);
    try {
      const content = await fs!.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as Paste;
      await cache.set(cacheKey, data);
      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  async deletePaste(id: string) {
    this.ensureServer();
    const filePath = this.getFilePath(id);
    await fs!.unlink(filePath).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
    await cache.del(`paste_${id}`);
  }
  async updatePasteName(id: string, newName: string) {
    this.ensureServer();
    const filePath = this.getFilePath(id);
    try {
      const content = await fs!.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as Paste;
      data.name = newName;
      await fs!.writeFile(filePath, JSON.stringify(data, null, 2));
      await cache.set(`paste_${id}`, data);
      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  async deleteExpiredPastes() {
    this.ensureServer();
    const files = await fs!.readdir(this.jsonPath).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = pathModule!.join(this.jsonPath, file);
      const content = await fs!.readFile(filePath, 'utf-8');
      const paste = JSON.parse(content) as Paste;
      if (paste.expiresAt && new Date() > new Date(paste.expiresAt)) {
        await fs!.unlink(filePath);
        await cache.del(`paste_${paste.id}`);
      }
    }
  }
  async getAllPastes() {
    this.ensureServer();
    const files = await fs!.readdir(this.jsonPath).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    const out: Paste[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = pathModule!.join(this.jsonPath, file);
      const content = await fs!.readFile(filePath, 'utf-8');
      out.push(JSON.parse(content));
    }
    return out;
  }
}

// Placeholders for SQL/NoSQL drivers. They lazy-require driver packages and provide minimal implementations.
class NotImplementedDB implements DatabaseBackend {
  async savePaste(id: string, content: string, name: string, permanent: boolean): Promise<string> {
    throw new Error('This database driver is not implemented in this environment. Install and implement the driver.');
  }
  async getPaste(id: string): Promise<Paste | null> {
    throw new Error('This database driver is not implemented in this environment. Install and implement the driver.');
  }
  async deletePaste(id: string): Promise<void> {
    throw new Error('This database driver is not implemented in this environment. Install and implement the driver.');
  }
  async updatePasteName(id: string, newName: string): Promise<Paste | null> {
    throw new Error('This database driver is not implemented in this environment. Install and implement the driver.');
  }
  async deleteExpiredPastes(): Promise<void> {
    // best-effort noop
  }
  async getAllPastes(): Promise<Paste[]> {
    return [];
  }
}

function createDatabase(): DatabaseBackend {
  const t = (config.database.save_type || 'JSON').toString().toLowerCase();
  if (t === 'json') {
    return new JsonDatabase(config.database.json_db_path || './data/pastes/');
  }
  if (t === 'sqlite' || t === 'sqlite3') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(config.database.sqlite_db_path || './data/pastes.db');
      // Minimal implementation that uses a simple table "pastes" (id TEXT PRIMARY KEY, payload TEXT)
      db.exec(`CREATE TABLE IF NOT EXISTS pastes (id TEXT PRIMARY KEY, payload TEXT)`);
      return {
        savePaste: async (id: string, content: string, name: string, permanent: boolean) => {
          const payload = JSON.stringify({ id, content, name, permanent, createdAt: new Date().toISOString() });
          const stmt = db.prepare('INSERT OR REPLACE INTO pastes (id,payload) VALUES (?,?)');
          stmt.run(id, payload);
          await cache.set(`paste_${id}`, JSON.parse(payload));
          return id;
        },
        getPaste: async (id: string) => {
          const row = db.prepare('SELECT payload FROM pastes WHERE id = ?').get(id);
          if (!row) return null;
          const parsed = JSON.parse(row.payload);
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deletePaste: async (id: string) => {
          db.prepare('DELETE FROM pastes WHERE id = ?').run(id);
          await cache.del(`paste_${id}`);
        },
        updatePasteName: async (id: string, newName: string) => {
          const row = db.prepare('SELECT payload FROM pastes WHERE id = ?').get(id);
          if (!row) return null;
          const parsed = JSON.parse(row.payload);
          parsed.name = newName;
          db.prepare('UPDATE pastes SET payload = ? WHERE id = ?').run(JSON.stringify(parsed), id);
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deleteExpiredPastes: async () => {
          // No-op by default; user can implement TTL handling in payload
        },
        getAllPastes: async () => {
          const rows = db.prepare('SELECT payload FROM pastes').all();
          return rows.map((r: any) => JSON.parse(r.payload));
        },
      };
    } catch (err) {
      throw new Error('SQLite selected but "better-sqlite3" is not installed. npm i better-sqlite3');
    }
  }
  // MongoDB
  if (t === 'mongodb' || t === 'mongo') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MongoClient } = require('mongodb');
      const uri = config.database.mongodb_uri;
      if (!uri) throw new Error('MONGODB URI not provided');
      const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
      // connect lazily
      const collPromise = client.connect().then(() => client.db().collection('pastes'));
      return {
        savePaste: async (id: string, content: string, name: string, permanent: boolean) => {
          const coll = await collPromise;
          const doc = { id, content, name, permanent, createdAt: new Date().toISOString() };
          await coll.updateOne({ id }, { $set: doc }, { upsert: true });
          await cache.set(`paste_${id}`, doc);
          return id;
        },
        getPaste: async (id: string) => {
          const coll = await collPromise;
          const doc = await coll.findOne({ id });
          if (!doc) return null;
          await cache.set(`paste_${id}`, doc);
          return doc;
        },
        deletePaste: async (id: string) => {
          const coll = await collPromise;
          await coll.deleteOne({ id });
          await cache.del(`paste_${id}`);
        },
        updatePasteName: async (id: string, newName: string) => {
          const coll = await collPromise;
          const res = await coll.findOneAndUpdate({ id }, { $set: { name: newName } }, { returnDocument: 'after' });
          if (!res.value) return null;
          await cache.set(`paste_${id}`, res.value);
          return res.value;
        },
        deleteExpiredPastes: async () => {
          // implement TTL via expiresAt if present
        },
        getAllPastes: async () => {
          const coll = await collPromise;
          return await coll.find().toArray();
        },
      };
    } catch (err) {
      throw new Error('MongoDB selected but "mongodb" driver is not installed. npm i mongodb');
    }
  }
  // Postgres / MariaDB (via knex would be ideal) - provide not-implemented stubs that suggest installing pg/mysql2
  if (t === 'postgres' || t === 'postgresql' || t === 'mariadb' || t === 'mysql') {
    try {
      // Try knex for cross-db support
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Knex = require('knex');
      const client = config.database.postgres_uri ? 'pg' : 'mysql2';
      const knex = Knex({
        client,
        connection: config.database.postgres_uri || config.database.mariadb_uri,
      });
      // ensure table
      knex.schema.hasTable('pastes').then((exists: boolean) => {
        if (!exists) {
          return knex.schema.createTable('pastes', (t: any) => {
            t.string('id').primary();
            t.text('payload');
          });
        }
      });
      return {
        savePaste: async (id: string, content: string, name: string, permanent: boolean) => {
          const payload = JSON.stringify({ id, content, name, permanent, createdAt: new Date().toISOString() });
          await knex('pastes').insert({ id, payload }).onConflict('id').merge();
          await cache.set(`paste_${id}`, JSON.parse(payload));
          return id;
        },
        getPaste: async (id: string) => {
          const row = await knex('pastes').where({ id }).first();
          if (!row) return null;
          const parsed = JSON.parse(row.payload);
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deletePaste: async (id: string) => {
          await knex('pastes').where({ id }).del();
          await cache.del(`paste_${id}`);
        },
        updatePasteName: async (id: string, newName: string) => {
          const row = await knex('pastes').where({ id }).first();
          if (!row) return null;
          const parsed = JSON.parse(row.payload);
          parsed.name = newName;
          await knex('pastes').where({ id }).update({ payload: JSON.stringify(parsed) });
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deleteExpiredPastes: async () => {},
        getAllPastes: async () => {
          const rows = await knex('pastes').select('payload');
          return rows.map((r: any) => JSON.parse(r.payload));
        },
      };
    } catch (err) {
      throw new Error('SQL DB selected but required drivers (knex + client) are not installed. npm i knex pg mysql2');
    }
  }
  // Cassandra
  if (t === 'cassandra') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cassandra = require('cassandra-driver');
      const client = new cassandra.Client({ contactPoints: ['127.0.0.1'], localDataCenter: 'datacenter1', keyspace: process.env.CASSANDRA_KEYSPACE || 'pastes' });
      return {
        savePaste: async (id: string, content: string, name: string, permanent: boolean) => {
          const payload = JSON.stringify({ id, content, name, permanent, createdAt: new Date().toISOString() });
          await client.execute('INSERT INTO pastes (id,payload) VALUES (?,?)', [id, payload], { prepare: true });
          await cache.set(`paste_${id}`, JSON.parse(payload));
          return id;
        },
        getPaste: async (id: string) => {
          const res = await client.execute('SELECT payload FROM pastes WHERE id = ?', [id], { prepare: true });
          if (res.rowLength === 0) return null;
          const parsed = JSON.parse(res.rows[0].payload);
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deletePaste: async (id: string) => {
          await client.execute('DELETE FROM pastes WHERE id = ?', [id], { prepare: true });
          await cache.del(`paste_${id}`);
        },
        updatePasteName: async (id: string, newName: string) => {
          const res = await client.execute('SELECT payload FROM pastes WHERE id = ?', [id], { prepare: true });
          if (res.rowLength === 0) return null;
          const parsed = JSON.parse(res.rows[0].payload);
          parsed.name = newName;
          await client.execute('INSERT INTO pastes (id,payload) VALUES (?,?)', [id, JSON.stringify(parsed)], { prepare: true });
          await cache.set(`paste_${id}`, parsed);
          return parsed;
        },
        deleteExpiredPastes: async () => {},
        getAllPastes: async () => {
          const res = await client.execute('SELECT payload FROM pastes');
          return res.rows.map((r: any) => JSON.parse(r.payload));
        },
      };
    } catch (err) {
      throw new Error('Cassandra selected but "cassandra-driver" is not installed. npm i cassandra-driver');
    }
  }
  return new NotImplementedDB();
}

const db = createDatabase();

export async function savePaste(id: string, content: string, name: string, permanent: boolean): Promise<string> {
  return db.savePaste(id, content, name, permanent);
}

export async function getPaste(id: string): Promise<Paste | null> {
  return db.getPaste(id);
}

export async function deletePaste(id: string): Promise<void> {
  return db.deletePaste(id);
}

export async function updatePasteName(id: string, newName: string): Promise<Paste | null> {
  return db.updatePasteName(id, newName);
}

export async function deleteExpiredPastes(): Promise<void> {
  return db.deleteExpiredPastes();
}

export async function getAllPastes() {
  return db.getAllPastes();
}

export async function fetchPastes() {
  return await getAllPastes();
}