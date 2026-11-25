// Ephemeral client-side in-memory API shim for the static GitHub Pages Live Demo.
// Never imported in production builds (tree-shaken when VITE_DEMO_MODE !== '1').
// Stores data strictly in JS heap memory for the lifetime of the browser tab;
// nothing is ever persisted to disk, cookies, localStorage, or any external server.

import type { PasteFilterRule } from '../../shared/types';

interface DemoPaste {
  id: string;
  name: string;
  content: string;
  permanent: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  owner: string | null;
  sharedWith: string[];
  version: number;
}

interface DemoUser {
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'invited' | 'pending_2fa';
  permanentDeleteLimit: number;
  totpEnabled: boolean;
  hasPasskey: boolean;
  immutable: boolean;
  createdAt: string;
}

interface DemoSession {
  id: string;
  email: string;
  role: 'admin' | 'user';
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

let pastes = new Map<string, DemoPaste>();
let users = new Map<string, DemoUser>();
let sessions: DemoSession[] = [];
let currentUser: { email: string; role: 'admin' | 'user'; permanentDeleteLimit: number | null } | null = null;

export function resetDemoState(): void {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  currentUser = { email: 'demo@example.com', role: 'admin', permanentDeleteLimit: null };

  users = new Map<string, DemoUser>([
    [
      'demo@example.com',
      {
        email: 'demo@example.com',
        role: 'admin',
        status: 'active',
        permanentDeleteLimit: 0,
        totpEnabled: true,
        hasPasskey: false,
        immutable: true,
        createdAt: iso(-14 * 86400_000),
      },
    ],
    [
      'alex@example.com',
      {
        email: 'alex@example.com',
        role: 'user',
        status: 'active',
        permanentDeleteLimit: 5,
        totpEnabled: true,
        hasPasskey: true,
        immutable: false,
        createdAt: iso(-7 * 86400_000),
      },
    ],
    [
      'sam@example.com',
      {
        email: 'sam@example.com',
        role: 'user',
        status: 'invited',
        permanentDeleteLimit: 3,
        totpEnabled: false,
        hasPasskey: false,
        immutable: false,
        createdAt: iso(-86400_000),
      },
    ],
  ]);

  sessions = [
    {
      id: 'demo-sess-current',
      email: 'demo@example.com',
      role: 'admin',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser Live Demo',
      createdAt: iso(-600_000),
      lastSeenAt: iso(0),
      current: true,
    },
  ];

  const seed: DemoPaste[] = [
    {
      id: 'hono-rate-limiter',
      name: 'Hono sliding-window rate limiter',
      content: `import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import crypto from 'node:crypto';

interface WindowBucket {
  timestamps: number[];
}

export function slidingWindowLimiter(maxRequests: number, windowMs: number): MiddlewareHandler {
  const buckets = new Map<string, WindowBucket>();

  return async (c: Context, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
    const now = Date.now();
    const cutoff = now - windowMs;

    const bucket = buckets.get(ip) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((bucket.timestamps[0] + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new HTTPException(429, { message: \`Too many requests (\${crypto.randomUUID().slice(0, 8)})\` });
    }

    bucket.timestamps.push(now);
    buckets.set(ip, bucket);
    await next();
  };
}`,
      permanent: true,
      createdAt: iso(-3 * 86400_000),
      updatedAt: iso(-3600_000),
      owner: 'demo@example.com',
      sharedWith: ['alex@example.com'],
      version: 2,
    },
    {
      id: 'sqlite-hot-backup',
      name: 'SQLite online VACUUM INTO backup',
      content: `import path from 'node:path';
import Database from 'better-sqlite3';

export function snapshotDatabase(dbPath: string, outDir: string): string {
  const db = new Database(dbPath, { readonly: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(outDir, \`cleanbin-\${stamp}.db\`);
  db.exec(\`VACUUM INTO '\${target.replace(/'/g, "''")}'\`);
  db.close();
  return target;
}`,
      permanent: true,
      createdAt: iso(-2 * 86400_000),
      updatedAt: iso(-2 * 86400_000),
      owner: 'demo@example.com',
      sharedWith: [],
      version: 1,
    },
    {
      id: 'docker-compose-sql',
      name: 'Production compose stack (PostgreSQL)',
      content: `services:
  web:
    image: ghcr.io/example/cleanbin:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      NODE_ENV: production
      DATABASE__SAVE_TYPE: PostgreSQL
      DATABASE__POSTGRES_URI: postgresql://cleanbin:secret@db:5432/cleanbin`,
      permanent: true,
      createdAt: iso(-86400_000),
      updatedAt: iso(-86400_000),
      owner: 'alex@example.com',
      sharedWith: ['demo@example.com'],
      version: 1,
    },
    {
      id: 'pg-placeholder-parser',
      name: 'SQL ? -> $n placeholder converter',
      content: `export function toPostgresPlaceholders(sql: string): string {
  let idx = 0;
  let inQuotes = false;
  let out = '';
  for (const ch of sql) {
    if (ch === "'") inQuotes = !inQuotes;
    out += ch === '?' && !inQuotes ? \`$\${++idx}\` : ch;
  }
  return out;
}`,
      permanent: false,
      createdAt: iso(-12 * 3600_000),
      updatedAt: iso(-12 * 3600_000),
      expiresAt: iso(29 * 86400_000),
      owner: null,
      sharedWith: [],
      version: 1,
    },
    {
      id: 'expiring-debug-log',
      name: 'Temporary build trace',
      content: `[02:14:09] vite v8 building client environment for production...
[02:14:09] 77 modules transformed in 208ms
[02:14:09] Cleanbin listening on http://0.0.0.0:3000 (sqlite)`,
      permanent: false,
      createdAt: iso(-26 * 86400_000),
      updatedAt: iso(-26 * 86400_000),
      expiresAt: iso(3 * 86400_000),
      owner: null,
      sharedWith: [],
      version: 1,
    },
  ];

  pastes = new Map(seed.map((p) => [p.id, p]));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function randomShortId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseJson(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  try {
    if (typeof init.body === 'string') return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function decoratePaste(item: DemoPaste) {
  const email = currentUser?.email ?? '';
  const mine = Boolean(email && item.owner === email);
  const sharedWithMe = Boolean(email && item.sharedWith.includes(email));
  const canEdit = Boolean(currentUser && (currentUser.role === 'admin' || mine || sharedWithMe));
  return { ...item, mine, sharedWithMe, canEdit };
}

function getFieldValue(item: DemoPaste, field?: string): string {
  if (field === 'name') return item.name || '';
  if (field === 'content') return item.content || '';
  if (field === 'id') return item.id || '';
  if (field === 'owner') return item.owner || '';
  return `${item.name || ''} ${item.content || ''} ${item.id || ''} ${item.owner || ''}`;
}

function matchesRule(rule: PasteFilterRule, item: DemoPaste): boolean {
  const val = String(rule?.value ?? '').toLowerCase();
  const fieldVal = getFieldValue(item, rule?.field);
  const lower = fieldVal.toLowerCase();
  let matched = false;
  if (rule?.op === 'contains') matched = lower.includes(val);
  else if (rule?.op === 'exact') matched = lower === val;
  else if (rule?.op === 'starts') matched = lower.startsWith(val);
  else if (rule?.op === 'regex') {
    try {
      matched = new RegExp(String(rule.value ?? ''), 'i').test(fieldVal);
    } catch {
      matched = false;
    }
  }
  return rule?.negate ? !matched : matched;
}

function filterPastesList(params: {
  scope: string;
  type?: string;
  filter?: string;
  filterField?: string;
  filterRules?: PasteFilterRule[];
  matchMode?: string;
  sort?: string;
  dir?: string;
}): DemoPaste[] {
  const email = currentUser?.email ?? '';
  let list = Array.from(pastes.values()).filter((p) => {
    if (params.scope === 'mine') return Boolean(email && p.owner === email);
    if (params.scope === 'shared') return Boolean(email && p.sharedWith.includes(email));
    if (currentUser?.role === 'admin') return true;
    return Boolean(email && (p.owner === email || p.sharedWith.includes(email)));
  });

  if (params.type === 'permanent') list = list.filter((p) => p.permanent);
  else if (params.type === 'temporary' || params.type === 'temp') list = list.filter((p) => !p.permanent);

  if (params.filterRules && params.filterRules.length > 0) {
    const isOr = (params.matchMode || 'AND').toUpperCase() === 'OR';
    list = list.filter((p) => {
      const res = params.filterRules!.map((r) => matchesRule(r, p));
      return isOr ? res.some(Boolean) : res.every(Boolean);
    });
  } else if (params.filter && params.filter.trim()) {
    const q = params.filter.trim().toLowerCase();
    list = list.filter((p) => getFieldValue(p, params.filterField).toLowerCase().includes(q));
  }

  const dir = params.dir === 'asc' ? 'asc' : 'desc';
  list.sort((a, b) => {
    if (!params.sort || params.sort === 'createdAt') {
      const cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return dir === 'asc' ? -cmp : cmp;
    }
    const cmp =
      params.sort === 'name'
        ? (a.name || '').localeCompare(b.name || '')
        : (a.permanent ? 1 : 0) - (b.permanent ? 1 : 0);
    return dir === 'asc' ? cmp : -cmp;
  });

  return list;
}

async function handleApiRequest(url: URL, method: string, init?: RequestInit): Promise<Response> {
  const path = url.pathname;

  // Auth & Session
  if (path === '/api/auth' && method === 'GET') {
    if (!currentUser) {
      return jsonResponse({ authenticated: false, email: null, role: null, permanentDeleteLimit: null });
    }
    return jsonResponse({
      authenticated: true,
      email: currentUser.email,
      role: currentUser.role,
      permanentDeleteLimit: currentUser.permanentDeleteLimit,
    });
  }

  if (path === '/api/auth' && method === 'POST') {
    const body = await parseJson(init);
    const email = (typeof body.email === 'string' && body.email.trim().toLowerCase()) || 'demo@example.com';
    const existing = users.get(email);
    currentUser = {
      email,
      role: existing?.role ?? 'admin',
      permanentDeleteLimit: existing?.role === 'user' ? existing.permanentDeleteLimit : null,
    };
    return jsonResponse({ authenticated: true, email: currentUser.email, role: currentUser.role });
  }

  if (path === '/api/auth/2fa' && method === 'POST') {
    currentUser = { email: 'demo@example.com', role: 'admin', permanentDeleteLimit: null };
    return jsonResponse({ authenticated: true, email: 'demo@example.com', role: 'admin' });
  }

  if (path === '/api/auth/passkey/status') {
    const qEmail = (url.searchParams.get('email') || currentUser?.email || '').trim().toLowerCase();
    const u = qEmail ? users.get(qEmail) : undefined;
    const anyReg = Array.from(users.values()).some((item) => item.hasPasskey && item.email === 'demo@example.com');
    return jsonResponse({ registered: anyReg, hasPasskey: Boolean(u?.hasPasskey) });
  }

  if (path === '/api/auth/passkey/register' && method === 'POST') {
    if (!currentUser) return jsonResponse({ message: 'Unauthorized' }, 401);
    const u = users.get(currentUser.email);
    if (u) u.hasPasskey = true;
    return jsonResponse({ verified: true, passwordLoginDisabled: true, totpRemoved: false });
  }

  if (path === '/api/auth/passkey' && method === 'DELETE') {
    if (!currentUser) return jsonResponse({ message: 'Unauthorized' }, 401);
    const u = users.get(currentUser.email);
    if (u) u.hasPasskey = false;
    return jsonResponse({ message: 'Passkey removed' });
  }

  // Sessions (/api/sessions)
  if (path === '/api/sessions' && method === 'GET') {
    return jsonResponse({ currentId: 'demo-sess-current', sessions });
  }

  if (path === '/api/sessions' && method === 'DELETE') {
    currentUser = null;
    return jsonResponse({ message: 'Signed out' });
  }

  if (path.startsWith('/api/sessions/') && method === 'DELETE') {
    const sid = decodeURIComponent(path.slice('/api/sessions/'.length));
    sessions = sessions.filter((s) => s.id !== sid);
    if (sid === 'demo-sess-current') currentUser = null;
    return jsonResponse({ message: 'Session revoked' });
  }

  // Single paste (/api/paste & /api/paste/:id)
  if (path === '/api/paste' && method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const found = pastes.get(id);
    if (!found) return jsonResponse({ message: 'Paste not found' }, 404);
    return jsonResponse(decoratePaste(found));
  }

  if (path === '/api/paste' && method === 'POST') {
    const body = await parseJson(init);
    const content = typeof body.content === 'string' ? body.content : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const permanent = Boolean(body.permanent && currentUser);
    if (!content.trim()) return jsonResponse({ message: 'Content cannot be empty' }, 400);

    let id = randomShortId();
    while (pastes.has(id)) id = randomShortId();

    const nowIso = new Date().toISOString();
    const record: DemoPaste = {
      id,
      name,
      content,
      permanent,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...(permanent ? {} : { expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }),
      owner: permanent && currentUser ? currentUser.email : null,
      sharedWith: [],
      version: 1,
    };
    pastes.set(id, record);
    return jsonResponse({ id }, 201);
  }

  if (path === '/api/pastes/presence' && method === 'GET') {
    return jsonResponse({ editors: {} });
  }

  const shareMatch = path.match(/^\/api\/paste\/([^/]+)\/share$/);
  if (shareMatch && method === 'POST') {
    const id = decodeURIComponent(shareMatch[1]);
    const item = pastes.get(id);
    if (!item) return jsonResponse({ message: 'Not found' }, 404);
    const body = await parseJson(init);
    const sharedWith = Array.isArray(body.sharedWith)
      ? body.sharedWith.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
      : [];
    item.sharedWith = Array.from(new Set(sharedWith));
    return jsonResponse({ id, sharedWith: item.sharedWith });
  }

  const presenceMatch = path.match(/^\/api\/paste\/([^/]+)\/presence$/);
  if (presenceMatch) {
    return jsonResponse({ editors: [] });
  }

  const pasteMatch = path.match(/^\/api\/paste\/([^/]+)$/);
  if (pasteMatch) {
    const id = decodeURIComponent(pasteMatch[1]);
    const item = pastes.get(id);
    if (!item) return jsonResponse({ message: 'Paste not found' }, 404);

    if (method === 'GET') {
      if (url.searchParams.get('touch') === '1' && !item.permanent) {
        item.expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
      }
      return jsonResponse(decoratePaste(item));
    }

    if (method === 'PUT') {
      const body = await parseJson(init);
      if (typeof body.content === 'string') item.content = body.content;
      if (typeof body.name === 'string') item.name = body.name;
      if (typeof body.permanent === 'boolean') {
        item.permanent = body.permanent;
        item.expiresAt = body.permanent ? undefined : new Date(Date.now() + 30 * 86400_000).toISOString();
      }
      item.updatedAt = new Date().toISOString();
      item.version += 1;
      return jsonResponse(decoratePaste(item));
    }

    if (method === 'DELETE') {
      pastes.delete(id);
      return jsonResponse({ message: 'Deleted', id });
    }
  }

  // Dashboard listing & bulk delete (/api/pastes)
  if (path === '/api/pastes' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'all';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const idsOnly = url.searchParams.get('ids_only') === '1';
    const matchMode = url.searchParams.get('matchMode') || 'AND';
    const filter = url.searchParams.get('filter') || undefined;
    const filterField = url.searchParams.get('filterField') || undefined;
    const sort = url.searchParams.get('sort') || undefined;
    const dir = url.searchParams.get('dir') || 'desc';
    const type = url.searchParams.get('type') || undefined;

    let filterRules: PasteFilterRule[] | undefined;
    const rulesRaw = url.searchParams.get('filterRules');
    if (rulesRaw) {
      try {
        const parsed = JSON.parse(rulesRaw);
        if (Array.isArray(parsed)) filterRules = parsed;
      } catch {
        filterRules = undefined;
      }
    }

    const matched = filterPastesList({ scope, type, filter, filterField, filterRules, matchMode, sort, dir });
    const total = matched.length;
    const start = (page - 1) * limit;
    const slice = matched.slice(start, start + limit);

    const items = idsOnly
      ? slice.map((p) => ({
          id: p.id,
          name: p.name,
          permanent: p.permanent,
          owner: p.owner,
          mine: Boolean(currentUser && p.owner === currentUser.email),
        }))
      : slice.map(decoratePaste);

    return jsonResponse({ total, page, limit, items, truncated: false });
  }

  if (path === '/api/pastes' && method === 'DELETE') {
    const body = await parseJson(init);
    let toDeleteIds: string[] = [];

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      toDeleteIds = body.ids.map(String);
    } else {
      const matched = filterPastesList({
        scope: (body.scope as string) || url.searchParams.get('scope') || 'all',
        type: (body.type as string) || url.searchParams.get('type') || undefined,
        filter: typeof body.filter === 'string' ? body.filter : undefined,
        filterField: typeof body.filterField === 'string' ? body.filterField : undefined,
        filterRules: Array.isArray(body.filterRules) ? (body.filterRules as PasteFilterRule[]) : undefined,
        matchMode: (body.matchMode as string) || url.searchParams.get('matchMode') || 'AND',
      });
      toDeleteIds = matched.map((p) => p.id);
    }

    const deleted: string[] = [];
    for (const id of toDeleteIds) {
      if (pastes.delete(id)) deleted.push(id);
    }
    return jsonResponse({ deleted: deleted.length, ids: deleted });
  }

  // Team accounts (/api/users) — returns array matching usersRoutes.get('/api/users')
  if (path === '/api/users' && method === 'GET') {
    return jsonResponse(Array.from(users.values()));
  }

  if (path === '/api/users' && method === 'POST') {
    const body = await parseJson(init);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) return jsonResponse({ message: 'A valid email is required' }, 400);
    if (users.has(email)) return jsonResponse({ message: 'User already exists' }, 409);

    const role = body.role === 'admin' ? 'admin' : 'user';
    const limit = typeof body.permanentDeleteLimit === 'number' ? body.permanentDeleteLimit : 0;
    const record: DemoUser = {
      email,
      role,
      status: 'invited',
      permanentDeleteLimit: limit,
      totpEnabled: false,
      hasPasskey: false,
      immutable: false,
      createdAt: new Date().toISOString(),
    };
    users.set(email, record);
    const setupUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/setup?invite=demo-${randomShortId()}`;
    return jsonResponse({ ...record, emailSent: false, setupUrl }, 201);
  }

  if (path.startsWith('/api/users/')) {
    const email = decodeURIComponent(path.slice('/api/users/'.length)).toLowerCase();
    const record = users.get(email);
    if (!record) return jsonResponse({ message: 'User not found' }, 404);

    if (method === 'DELETE') {
      if (record.immutable) return jsonResponse({ message: 'Primary admin account cannot be deleted' }, 403);
      users.delete(email);
      return jsonResponse({ message: 'User deleted' });
    }

    if (method === 'PATCH') {
      const body = await parseJson(init);
      const setupUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/setup?invite=demo-${randomShortId()}`;
      if (body.action === 'resend-invite' || body.action === 'reset-password') {
        if (body.action === 'reset-password') {
          record.totpEnabled = false;
          record.hasPasskey = false;
        }
        return jsonResponse({ emailSent: false, setupUrl });
      }
      if (body.action === 'remove-passkey') {
        record.hasPasskey = false;
        return jsonResponse({ message: 'Passkey removed' });
      }
      if (!record.immutable && (body.role === 'admin' || body.role === 'user')) {
        record.role = body.role;
      }
      if (typeof body.permanentDeleteLimit === 'number') {
        record.permanentDeleteLimit = body.permanentDeleteLimit;
      }
      return jsonResponse(record);
    }
  }

  if (path === '/api/setup/start' && method === 'POST') {
    return jsonResponse({
      email: 'invited@example.com',
      needsPassword: true,
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Cleanbin:invited@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Cleanbin',
    });
  }

  if (path === '/api/setup/complete' && method === 'POST') {
    currentUser = { email: 'demo@example.com', role: 'admin', permanentDeleteLimit: null };
    return jsonResponse({ verified: true, email: 'demo@example.com', role: 'admin' });
  }

  return jsonResponse({ message: `Demo endpoint not mocked: ${method} ${path}` }, 404);
}

let installed = false;

export function installDemoMode(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  resetDemoState();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const resolved = new URL(rawUrl, window.location.origin);
    if (resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/')) {
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      return handleApiRequest(resolved, method, init);
    }
    return nativeFetch(input, init);
  };
}
