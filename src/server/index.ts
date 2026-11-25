import { serve } from '@hono/node-server';
import { getConfig } from './config.js';
import { getDb, resetDbForTests } from './db/index.js';
import { createApp } from './app.js';
import { startExpiryCron, stopExpiryCron } from './services/pastesCache.js';
import { startBackupCron, stopBackupCron } from './services/backup.js';

async function main() {
  const cfg = getConfig();
  await getDb();
  startExpiryCron();
  startBackupCron();

  const app = createApp();
  const server = serve(
    {
      fetch: app.fetch,
      port: cfg.port,
      hostname: '0.0.0.0',
    },
    (info) => {
      console.log(`Cleanbin listening on http://0.0.0.0:${info.port} (${cfg.database.engine})`);
    }
  );

  const shutdown = async () => {
    stopExpiryCron();
    stopBackupCron();
    server.close();
    await resetDbForTests();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((error) => {
  console.error('Failed to start Cleanbin:', error);
  process.exit(1);
});
