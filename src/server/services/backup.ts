import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import cron, { type ScheduledTask } from 'node-cron';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';

const brotliCompress = promisify(zlib.brotliCompress);

let backupTask: ScheduledTask | null = null;

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

export function startBackupCron(): void {
  if (backupTask) return;
  const schedule = (process.env.BACKUP_CRON ?? '30 3 * * *').trim();
  if (!schedule || schedule.toLowerCase() === 'off' || schedule === '0') return;
  if (!cron.validate(schedule)) return;

  backupTask = cron.schedule(schedule, async () => {
    try {
      await runBackup();
    } catch {
      // Best-effort scheduled hot backup
    }
  });
}

export function stopBackupCron(): void {
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }
}
