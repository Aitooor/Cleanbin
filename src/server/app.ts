import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { securityHeaders } from './middleware/security.js';
import { getOptionalActiveSession } from './middleware/auth.js';
import { pasteRoutes } from './routes/paste.js';
import { pastesRoutes } from './routes/pastes.js';
import { authRoutes } from './routes/auth.js';
import { passkeyRoutes } from './routes/passkey.js';
import { setupRoutes } from './routes/setup.js';
import { usersRoutes } from './routes/users.js';
import { sessionsRoutes } from './routes/sessions.js';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function tryServeFile(rootDir: string, urlPath: string): Promise<{ body: Buffer; contentType: string; immutable: boolean } | null> {
  const safeRel = path.posix.normalize(urlPath).replace(/^\/+/, '');
  if (!safeRel || safeRel.includes('..')) return null;

  const fullPath = path.resolve(rootDir, safeRel);
  const resolvedRoot = path.resolve(rootDir);
  if (!fullPath.startsWith(resolvedRoot + path.sep)) return null;

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) return null;
    const body = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
    const immutable = safeRel.startsWith('assets/');
    return { body, contentType, immutable };
  } catch {
    return null;
  }
}

export interface CreateAppOptions {
  clientDistDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const clientDistDir = options.clientDistDir ?? path.resolve(process.cwd(), 'dist/client');
  const publicDir = path.resolve(process.cwd(), 'public');

  app.use('*', securityHeaders);

  // API routes
  app.route('/', pasteRoutes);
  app.route('/', pastesRoutes);
  app.route('/', authRoutes);
  app.route('/', passkeyRoutes);
  app.route('/', setupRoutes);
  app.route('/', usersRoutes);
  app.route('/', sessionsRoutes);

  app.all('/api/*', (c) => {
    return c.json({ error: 'Not found', message: 'API route not found' }, 404);
  });

  // Server-side guard on /dashboard and /dashboard/*: verifies both signature
  // and SQL session state BEFORE serving the SPA shell.
  app.use('/dashboard', async (c, next) => {
    const session = await getOptionalActiveSession(c);
    if (!session) return c.redirect('/login', 302);
    await next();
  });
  app.use('/dashboard/*', async (c, next) => {
    const session = await getOptionalActiveSession(c);
    if (!session) return c.redirect('/login', 302);
    await next();
  });

  // Static files & SPA fallback
  app.get('*', async (c) => {
    const reqPath = c.req.path;

    if (reqPath !== '/') {
      const fromDist = await tryServeFile(clientDistDir, reqPath);
      if (fromDist) {
        c.header('Content-Type', fromDist.contentType);
        if (fromDist.immutable) {
          c.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
        return c.body(new Uint8Array(fromDist.body));
      }

      const fromPublic = await tryServeFile(publicDir, reqPath);
      if (fromPublic) {
        c.header('Content-Type', fromPublic.contentType);
        return c.body(new Uint8Array(fromPublic.body));
      }
    }

    const indexFile = await tryServeFile(clientDistDir, 'index.html');
    if (indexFile) {
      c.header('Content-Type', 'text/html; charset=utf-8');
      c.header('Cache-Control', 'no-cache');
      return c.body(new Uint8Array(indexFile.body));
    }

    return c.text('Cleanbin frontend build not found. Run `npm run build` first.', 503);
  });

  return app;
}
