import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteAdapter, toPostgresPlaceholders } from '../src/server/db/adapter.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { getPaste } from '../src/server/services/pastes.js';
import { listUsers } from '../src/server/services/users.js';
import { isSessionActive } from '../src/server/services/sessions.js';
import { hasPasskey } from '../src/server/services/passkeys.js';
import { runBackup } from '../scripts/backup.js';

let tempDir: string | null = null;

afterEach(async () => {
  await resetDbForTests();
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('SQL adapter & legacy v1 migration', () => {
  it('converts ? placeholders to PostgreSQL $1..$n without touching string literals', () => {
    const sql = "SELECT * FROM pastes WHERE owner = ? AND name LIKE '%?%' AND permanent = ?";
    expect(toPostgresPlaceholders(sql)).toBe(
      "SELECT * FROM pastes WHERE owner = $1 AND name LIKE '%?%' AND permanent = $2"
    );
  });

  it('migrates legacy v1 pastes.db schema, users.json, sessions.json, passkeys.json, and creates online backup', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-mig-'));
    process.env.DATA_DIR = tempDir;
    process.env.DATABASE__SAVE_TYPE = 'SQLite';
    process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'super-secret-password';

    // 1. Seed a genuine Cleanbin v1 SQLite table (only id, payload, expires_at, owner, shared_with)
    const rawV1 = createSqliteAdapter(path.join(tempDir, 'pastes.db'));
    await rawV1.execute(
      'CREATE TABLE pastes (id TEXT PRIMARY KEY, payload TEXT, expires_at INTEGER, owner TEXT, shared_with TEXT)'
    );
    const legacyObj = {
      id: 'legacy-paste-1',
      content: 'console.log("from v1");',
      name: 'Legacy Snippet',
      permanent: 'true',
      createdAt: '2026-09-26T18:00:00.000Z',
      owner: 'teammate@example.com',
      sharedWith: ['collab@example.com'],
      version: 3,
    };
    const compressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(legacyObj))).toString('base64');
    await rawV1.execute(
      'INSERT INTO pastes (id, payload, expires_at, owner, shared_with) VALUES (?, ?, NULL, ?, ?)',
      ['legacy-paste-1', compressed, 'teammate@example.com', JSON.stringify(['collab@example.com'])]
    );
    await rawV1.close();

    // 2. Seed legacy JSON stores in DATA_DIR
    await fs.writeFile(
      path.join(tempDir, 'users.json'),
      JSON.stringify([
        {
          email: 'teammate@example.com',
          passwordHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
          role: 'user',
          permanentDeleteLimit: 4,
          createdAt: '2026-09-26T18:00:00.000Z',
          status: 'active',
          totpSecret: 'JBSWY3DPEHPK3PXP',
          totpEnabledAt: '2026-09-26T18:05:00.000Z',
        },
      ])
    );

    await fs.writeFile(
      path.join(tempDir, 'sessions.json'),
      JSON.stringify([
        {
          id: 'sess-legacy-01',
          email: 'teammate@example.com',
          role: 'user',
          userAgent: 'Mozilla/5.0 Macintosh',
          createdAt: '2026-09-26T18:10:00.000Z',
          lastSeenAt: '2026-09-26T18:15:00.000Z',
          revokedAt: null,
        },
      ])
    );

    await fs.writeFile(
      path.join(tempDir, 'passkeys.json'),
      JSON.stringify({
        'teammate@example.com': {
          credentialID: 'cred-123',
          credentialPublicKey: 'cHVia2V5',
          counter: 7,
          transports: ['internal'],
          userID: 'uid-123',
          email: 'teammate@example.com',
          createdAt: '2026-09-26T19:00:00.000Z',
        },
      })
    );

    // 3. Boot v2 database and verify transparent migration
    await getDb();

    const migratedPaste = await getPaste('legacy-paste-1');
    expect(migratedPaste).not.toBeNull();
    expect(migratedPaste?.name).toBe('Legacy Snippet');
    expect(migratedPaste?.content).toBe('console.log("from v1");');
    expect(migratedPaste?.permanent).toBe(true);
    expect(migratedPaste?.owner).toBe('teammate@example.com');
    expect(migratedPaste?.sharedWith).toEqual(['collab@example.com']);
    expect(migratedPaste?.version).toBe(3);

    const users = await listUsers();
    expect(users.map((u) => u.email)).toEqual(['admin@example.com', 'teammate@example.com']);
    const teammate = users.find((u) => u.email === 'teammate@example.com');
    expect(teammate?.permanentDeleteLimit).toBe(4);
    expect(teammate?.totpEnabled).toBe(true);

    expect(await isSessionActive('sess-legacy-01')).toBe(true);
    expect(await hasPasskey('teammate@example.com')).toBe(true);

    // Original JSON files remain untouched on disk as safety backup
    const stillExists = await fs
      .stat(path.join(tempDir, 'users.json'))
      .then(() => true)
      .catch(() => false);
    expect(stillExists).toBe(true);

    // 4. Online hot backup creates valid SQLite snapshot
    const backupFile = await runBackup();
    const stat = await fs.stat(backupFile);
    expect(stat.size).toBeGreaterThan(0);
  });
});
