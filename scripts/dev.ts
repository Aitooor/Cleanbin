import { serve } from '@hono/node-server';
import { createServer as createViteServer } from 'vite';
import { getConfig } from '../src/server/config.js';
import { getDb } from '../src/server/db/index.js';
import { createApp } from '../src/server/app.js';
import { startExpiryCron } from '../src/server/services/pastesCache.js';

async function startDev() {
  const cfg = getConfig();
  await getDb();
  startExpiryCron();

  const apiPort = cfg.port + 1;
  const apiApp = createApp();
  serve({ fetch: apiApp.fetch, port: apiPort, hostname: '127.0.0.1' });

  const vite = await createViteServer({
    server: {
      port: cfg.port,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
    appType: 'spa',
  });

  await vite.listen();
  console.log(`Cleanbin dev server running at http://localhost:${cfg.port}`);
}

void startDev();
