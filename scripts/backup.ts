import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getConfig } from '../src/server/config.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';

const brotliCompress = promisify(zlib.brotliCompress);

function formatStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

async function pruneOldBackups(backupDir: string, keepCount: number): Promise<void> {
  const entries = await fs.readdir(backupDir).catch(() => [] as string[]);
  const matching = entries
    .filter((name) => name.startsWith('cleanbin-') && (name.endsWith('.db') || name.endsWith('.json.br')))
    .sort()
    .reverse();

  for (const stale of matching.slice(keepCount)) {
    await fs.unlink(path.join(backupDir, stale)).catch(() => {});
  }
}

export async function runBackup(): Promise<string> {
  const cfg = getConfig();
  const db = await getDb();
  const backupDir = path.join(cfg.dataDir, 'backups');
  await fs.mkdir(backupDir, { recursive: true });

  const keep = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || '7', 10) || 7);
  const stamp = formatStamp();

  let targetPath: string;
  if (db.dialect === 'sqlite' && db.backup) {
    targetPath = path.join(backupDir, `cleanbin-${stamp}.db`);
    await db.backup(targetPath);
  } else {
    targetPath = path.join(backupDir, `cleanbin-${stamp}.json.br`);
    const [meta, pastes, users, sessions, passkeys] = await Promise.all([
      db.query('SELECT * FROM cleanbin_meta'),
      db.query('SELECT * FROM pastes'),
      db.query('SELECT * FROM users'),
      db.query('SELECT * FROM sessions'),
      db.query('SELECT * FROM passkeys'),
    ]);
    const dump = JSON.stringify({
      exportedAt: new Date().toISOString(),
      dialect: db.dialect,
      tables: { cleanbin_meta: meta, pastes, users, sessions, passkeys },
    });
    const compressed = await brotliCompress(Buffer.from(dump, 'utf-8'));
    await fs.writeFile(targetPath, compressed);
  }

  await pruneOldBackups(backupDir, keep);
  return targetPath;
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'backup.ts'));

if (isDirectExecution) {
  runBackup()
    .then(async (outPath) => {
      console.log(`Backup written to ${outPath}`);
      await resetDbForTests();
    })
    .catch(async (err) => {
      console.error('Backup failed:', err);
      await resetDbForTests();
      process.exit(1);
    });
}
