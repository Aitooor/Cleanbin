// Ephemeral client-side in-memory API shim for the static GitHub Pages Live Demo.
// Never imported in production builds (tree-shaken when VITE_DEMO_MODE !== '1').
// Stores data strictly in JS heap memory for the lifetime of the browser tab;
// nothing is ever persisted to disk, cookies, localStorage, or any external server.

import type { ApiTokenInfo, PasteFilterRule, PasteTtlOption, RegistrationMode, StorageStats } from '../../shared/types';

interface DemoPaste {
  id: string;
  name: string;
  content: string;
  permanent: boolean;
  burnAfterRead?: boolean;
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
  status: 'active' | 'invited';
  permanentDeleteLimit: number;
  totpEnabled: boolean;
  invitePending: boolean;
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
let demoTokens: ApiTokenInfo[] = [];
let currentUser: { email: string; role: 'admin' | 'user'; permanentDeleteLimit: number | null } | null = null;
let demoRegistrationMode: RegistrationMode = 'invite';
let demoRequireEmailVerification = false;
let demoDefaultDeleteLimit = 2;
let demoMaxPastesPerUser = 100;
let demoMaxStorageMbPerUser = 10;

function estimateCompressedBytes(text: string): number {
  const raw = new TextEncoder().encode(text).byteLength;
  if (raw <= 12) return raw + 1;
  return Math.max(14, Math.round(raw * 0.22));
}

function computeDemoStorageStats(): StorageStats {
  let rawBytes = 0;
  let storedBytes = 0;
  for (const p of pastes.values()) {
    rawBytes += new TextEncoder().encode(p.content).byteLength;
    storedBytes += estimateCompressedBytes(p.content);
  }
  const savingsPercent =
    rawBytes > 0 ? Math.max(0, Math.round((1 - storedBytes / rawBytes) * 1000) / 10) : 0;
  return {
    pasteCount: pastes.size,
    rawBytes,
    storedBytes,
    dbFileBytes: storedBytes + 16_384,
    savingsPercent,
  };
}

export function resetDemoState(): void {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  currentUser = { email: 'demo@example.com', role: 'admin', permanentDeleteLimit: null };
  demoRegistrationMode = 'invite';
  demoRequireEmailVerification = false;
  demoDefaultDeleteLimit = 2;
  demoMaxPastesPerUser = 100;
  demoMaxStorageMbPerUser = 10;
  demoTokens = [
    {
      id: 'demo-tok-1',
      name: 'workstation-cli',
      tokenPrefix: 'cb_9xK2mPq',
      createdAt: iso(-5 * 86400_000),
      lastUsedAt: iso(-1800_000),
    },
  ];

  users = new Map<string, DemoUser>([
    [
      'demo@example.com',
      {
        email: 'demo@example.com',
        role: 'admin',
        status: 'active',
        permanentDeleteLimit: 0,
        totpEnabled: true,
        invitePending: false,
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
        invitePending: false,
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
        invitePending: true,
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
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/136.0',
      createdAt: iso(-600_000),
      lastSeenAt: iso(0),
      current: true,
    },
    {
      id: 'demo-sess-laptop',
      email: 'demo@example.com',
      role: 'admin',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) Firefox/135.0',
      createdAt: iso(-2 * 86400_000),
      lastSeenAt: iso(-3600_000),
      current: false,
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
    {
      id: 'release-notes-md',
      name: 'RELEASE.md',
      content: `# Cleanbin v2.2 Highlights

- **CLI Raw Upload**: \`cat app.log | curl -fsS --data-binary @- https://cleanbin.xyz/raw\`
- **Personal API Tokens**: Revocable \`cb_...\` tokens hashed with SHA-256
- **Ultra-Compact Storage**: Pure Brotli-11 binary payloads with SQLite \`VACUUM\`

| Layer | Footprint |
| :--- | :--- |
| Metadata | Indexed SQL columns |
| Content | Brotli quality 11 (\`BROTLI_MODE_TEXT\`) |`,
      permanent: true,
      createdAt: iso(-6 * 3600_000),
      updatedAt: iso(-6 * 3600_000),
      owner: 'demo@example.com',
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
    if (params.scope === 'anonymous') return p.owner === null;
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
  const baseUrl = import.meta.env.BASE_URL || '/Cleanbin/';

  // Settings (/api/settings & /api/settings/compact)
  if (path === '/api/settings' && method === 'GET') {
    if (currentUser?.role === 'admin') {
      return jsonResponse({
        registrationMode: demoRegistrationMode,
        requireEmailVerification: demoRequireEmailVerification,
        mailerConfigured: true,
        defaultUserDeleteLimit: demoDefaultDeleteLimit,
        maxPastesPerUser: demoMaxPastesPerUser,
        maxStorageMbPerUser: demoMaxStorageMbPerUser,
        storage: computeDemoStorageStats(),
      });
    }
    return jsonResponse({
      registrationMode: demoRegistrationMode,
      requireEmailVerification: demoRequireEmailVerification,
    });
  }

  if (path === '/api/settings' && method === 'PATCH') {
    if (currentUser?.role !== 'admin') return jsonResponse({ message: 'Forbidden' }, 403);
    const body = await parseJson(init);
    if (body.registrationMode === 'invite' || body.registrationMode === 'open') {
      demoRegistrationMode = body.registrationMode;
    }
    if (typeof body.requireEmailVerification === 'boolean') {
      demoRequireEmailVerification = body.requireEmailVerification;
    }
    if (typeof body.defaultUserDeleteLimit === 'number' && body.defaultUserDeleteLimit >= 0) {
      demoDefaultDeleteLimit = Math.floor(body.defaultUserDeleteLimit);
    }
    if (typeof body.maxPastesPerUser === 'number' && body.maxPastesPerUser >= 0) {
      demoMaxPastesPerUser = Math.floor(body.maxPastesPerUser);
    }
    if (typeof body.maxStorageMbPerUser === 'number' && body.maxStorageMbPerUser >= 0) {
      demoMaxStorageMbPerUser = Math.round(body.maxStorageMbPerUser * 100) / 100;
    }
    return jsonResponse({
      registrationMode: demoRegistrationMode,
      requireEmailVerification: demoRequireEmailVerification,
      mailerConfigured: true,
      defaultUserDeleteLimit: demoDefaultDeleteLimit,
      maxPastesPerUser: demoMaxPastesPerUser,
      maxStorageMbPerUser: demoMaxStorageMbPerUser,
      storage: computeDemoStorageStats(),
    });
  }

  if (path === '/api/settings/compact' && method === 'POST') {
    if (currentUser?.role !== 'admin') return jsonResponse({ message: 'Forbidden' }, 403);
    return jsonResponse({ storage: computeDemoStorageStats() });
  }

  // Personal API tokens (/api/tokens)
  if (path === '/api/tokens' && method === 'GET') {
    if (!currentUser) return jsonResponse({ message: 'Unauthorized' }, 401);
    const owned = Array.from(pastes.values()).filter((p) => p.owner === currentUser!.email);
    const rawBytes = owned.reduce((acc, p) => acc + new TextEncoder().encode(p.content).byteLength, 0);
    const storedBytes = owned.reduce((acc, p) => acc + estimateCompressedBytes(p.content), 0);
    return jsonResponse({
      tokens: demoTokens,
      usage: {
        pasteCount: owned.length,
        rawBytes,
        storedBytes,
        maxPastesPerUser: currentUser.role === 'admin' ? 0 : demoMaxPastesPerUser,
        maxStorageMbPerUser: currentUser.role === 'admin' ? 0 : demoMaxStorageMbPerUser,
      },
    });
  }

  if (path === '/api/tokens' && method === 'POST') {
    if (!currentUser) return jsonResponse({ message: 'Unauthorized' }, 401);
    const body = await parseJson(init);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonResponse({ message: 'Token label is required' }, 400);
    const rawToken = `cb_demo_${randomShortId()}${randomShortId()}${randomShortId()}`;
    const item: ApiTokenInfo = {
      id: `demo-tok-${randomShortId()}`,
      name,
      tokenPrefix: rawToken.slice(0, 10),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    demoTokens = [item, ...demoTokens];
    return jsonResponse({ token: rawToken, item }, 201);
  }

  if (path.startsWith('/api/tokens/') && method === 'DELETE') {
    if (!currentUser) return jsonResponse({ message: 'Unauthorized' }, 401);
    const tokId = decodeURIComponent(path.slice('/api/tokens/'.length));
    demoTokens = demoTokens.filter((t) => t.id !== tokId);
    return jsonResponse({ success: true });
  }

  if (path === '/api/auth/register' && method === 'POST') {
    if (demoRegistrationMode !== 'open') {
      return jsonResponse({ message: 'Public registration is disabled.' }, 403);
    }
    const body = await parseJson(init);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !email.includes('@')) return jsonResponse({ message: 'A valid email is required' }, 400);
    if (password.length < 10) return jsonResponse({ message: 'Password must be at least 10 characters.' }, 400);
    if (users.has(email)) return jsonResponse({ message: 'An account with this email already exists.' }, 409);

    users.set(email, {
      email,
      role: 'user',
      status: 'active',
      permanentDeleteLimit: demoDefaultDeleteLimit,
      totpEnabled: false,
      invitePending: false,
      hasPasskey: false,
      immutable: false,
      createdAt: new Date().toISOString(),
    });
    return jsonResponse({ setupRequired: true, email, challenge: `demo-reg-${encodeURIComponent(email)}` }, 201);
  }

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
    if (found.burnAfterRead) {
      return jsonResponse({ message: 'One-time pastes cannot be preloaded without opening them' }, 403);
    }
    return jsonResponse({
      id: found.id,
      content: found.content,
      name: found.name,
      permanent: found.permanent,
    });
  }

  if (path === '/api/paste' && method === 'POST') {
    const body = await parseJson(init);
    const content = typeof body.content === 'string' ? body.content : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const ttl = (typeof body.ttl === 'string' ? body.ttl : undefined) as PasteTtlOption | undefined;
    const wantsPerm =
      ttl === 'permanent' ||
      (ttl === undefined && body.permanent !== false && body.permanent !== 'false' && body.burnAfterRead !== true);
    const permanent = Boolean(currentUser && wantsPerm);
    const burnAfterRead = !permanent && (body.burnAfterRead === true || ttl === 'burn');
    if (!content.trim()) return jsonResponse({ message: 'Content cannot be empty' }, 400);
    if (permanent && !name) return jsonResponse({ message: 'Name is required for permanent pastes.' }, 400);

    let id = randomShortId();
    while (pastes.has(id)) id = randomShortId();

    const ttlMs =
      ttl === '1h'
        ? 3_600_000
        : ttl === '24h'
          ? 86_400_000
          : ttl === '7d' || burnAfterRead
            ? 7 * 86_400_000
            : 30 * 86_400_000;

    const nowIso = new Date().toISOString();
    const record: DemoPaste = {
      id,
      name,
      content,
      permanent,
      burnAfterRead,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...(permanent ? {} : { expiresAt: new Date(Date.now() + ttlMs).toISOString() }),
      owner: permanent && currentUser ? currentUser.email : null,
      sharedWith: [],
      version: 1,
    };
    pastes.set(id, record);
    return jsonResponse({ id, burnAfterRead }, 201);
  }

  if (path === '/api/pastes/presence' && method === 'GET') {
    return jsonResponse({ editors: {} });
  }

  // Share collaborator add/remove (/api/paste/:id/share)
  const shareMatch = path.match(/^\/api\/paste\/([^/]+)\/share$/);
  if (shareMatch && method === 'POST') {
    const id = decodeURIComponent(shareMatch[1]);
    const item = pastes.get(id);
    if (!item) return jsonResponse({ message: 'Paste not found' }, 404);
    const body = await parseJson(init);
    const target = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const action = body.action;
    if (action === 'add' || action === 'remove') {
      if (!target || !target.includes('@')) {
        return jsonResponse({ message: 'A valid email is required' }, 400);
      }
      if (action === 'add') {
        if (!users.has(target)) {
          return jsonResponse({ message: 'No user account exists with that email' }, 404);
        }
        if (item.owner === target) {
          return jsonResponse({ message: 'The owner already has access' }, 400);
        }
        if (!item.sharedWith.includes(target)) item.sharedWith = [...item.sharedWith, target];
      } else {
        item.sharedWith = item.sharedWith.filter((e) => e !== target);
      }
      return jsonResponse({ sharedWith: item.sharedWith, owner: item.owner });
    }
    if (Array.isArray(body.sharedWith)) {
      item.sharedWith = Array.from(new Set(body.sharedWith.map((v) => String(v).trim().toLowerCase()).filter(Boolean)));
      return jsonResponse({ sharedWith: item.sharedWith, owner: item.owner });
    }
    return jsonResponse({ message: 'Action must be "add" or "remove"' }, 400);
  }

  const presenceMatch = path.match(/^\/api\/paste\/([^/]+)\/presence$/);
  if (presenceMatch) {
    return jsonResponse({ self: currentUser?.email ?? '', editors: [] });
  }

  const pasteMatch = path.match(/^\/api\/paste\/([^/]+)$/);
  if (pasteMatch) {
    const id = decodeURIComponent(pasteMatch[1]);
    const item = pastes.get(id);
    if (!item) return jsonResponse({ message: 'Paste not found' }, 404);

    if (method === 'GET') {
      if (url.searchParams.get('touch') === '1') {
        if (item.burnAfterRead) {
          pastes.delete(id);
          return jsonResponse({
            ...decoratePaste(item),
            burnAfterRead: true,
            burned: true,
            expiresAt: null,
            canEdit: false,
          });
        }
        if (!item.permanent) {
          item.expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
        }
      }
      return jsonResponse({ ...decoratePaste(item), burned: false });
    }

    if (method === 'PATCH' || method === 'PUT') {
      const body = await parseJson(init);
      if (typeof body.version === 'number' && body.version !== item.version) {
        return jsonResponse(
          {
            error: 'This paste was changed by someone else while you were editing it.',
            paste: {
              id: item.id,
              name: item.name,
              content: item.content,
              version: item.version,
              updatedAt: item.updatedAt,
            },
          },
          409
        );
      }
      if (typeof body.name === 'string') {
        const trimmed = body.name.trim();
        if (item.permanent && !trimmed) {
          return jsonResponse({ message: 'Name is required for permanent pastes' }, 400);
        }
        item.name = trimmed;
      }
      if (typeof body.content === 'string') {
        if (!body.content) return jsonResponse({ message: 'Invalid content' }, 400);
        item.content = body.content;
      }
      item.updatedAt = new Date().toISOString();
      item.version += 1;
      return jsonResponse({
        success: true,
        paste: {
          id: item.id,
          name: item.name,
          content: item.content,
          owner: item.owner,
          sharedWith: item.sharedWith,
          version: item.version,
          updatedAt: item.updatedAt,
        },
      });
    }

    if (method === 'DELETE') {
      pastes.delete(id);
      return jsonResponse({ success: true, id });
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

  // Team accounts (/api/users)
  if (path === '/api/users' && method === 'GET') {
    const list = Array.from(users.values()).map((u) => {
      const owned = Array.from(pastes.values()).filter((p) => p.owner === u.email);
      const storedBytes = owned.reduce((acc, p) => acc + estimateCompressedBytes(p.content), 0);
      return {
        ...u,
        pasteCount: owned.length,
        storedBytes,
      };
    });
    return jsonResponse(list);
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
      invitePending: true,
      hasPasskey: false,
      immutable: false,
      createdAt: new Date().toISOString(),
    };
    users.set(email, record);
    const setupUrl = `${window.location.origin}${baseUrl}#/setup?token=demo-${randomShortId()}`;
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
      const setupUrl = `${window.location.origin}${baseUrl}#/setup?token=demo-${randomShortId()}`;
      if (body.action === 'resend-invite' || body.action === 'reset-password') {
        if (body.action === 'reset-password') {
          record.totpEnabled = false;
          record.hasPasskey = false;
          record.invitePending = true;
        }
        return jsonResponse({ emailSent: false, setupUrl });
      }
      if (body.action === 'reset-2fa') {
        record.totpEnabled = false;
        return jsonResponse({ message: 'Two-factor authentication reset' });
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
      groupedSecret: 'JBSW Y3DP EHPK 3PXP',
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
