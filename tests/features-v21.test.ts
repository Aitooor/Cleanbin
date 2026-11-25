import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { resetRateLimitsForTests } from '../src/server/middleware/rateLimit.js';
import { createSessionToken } from '../src/server/services/auth.js';
import { createUserSession } from '../src/server/services/sessions.js';
import { decryptPastePayload, encryptPastePayload, isEncryptedPasteContent } from '../src/client/utils/e2ee.js';
import { buildPasteTarget, parsePasteFragment } from '../src/client/utils/urlHash.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-v21-'));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE__SAVE_TYPE = 'SQLite';
  process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
  process.env.AUTH_SECRET = 'v21-feature-suite-secret-key-at-least-32-chars';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'StrongAdminPassword!';
  process.env.COOKIE_SECURE = '0';
  process.env.RATE_LIMIT_PASTE_PER_MIN = '50';
  process.env.RATE_LIMIT_AUTH_PER_5MIN = '50';
  resetRateLimitsForTests();
  await getDb();
});

afterEach(async () => {
  await resetDbForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Cleanbin v2.1 — E2EE, Selectable TTL, Burn-After-Read, /raw/:id & Registration Mode', () => {
  it('encrypts and decrypts payloads client-side with AES-256-GCM and parses combined #k + #L fragments', async () => {
    const secretCode = 'API_TOKEN="super-secret-value-123"';
    const { payload, keyB64Url } = await encryptPastePayload({
      name: 'Production .env',
      content: secretCode,
    });

    expect(isEncryptedPasteContent(payload)).toBe(true);
    expect(payload).not.toContain('super-secret-value-123');
    expect(payload).not.toContain('Production .env');

    const decrypted = await decryptPastePayload(payload, keyB64Url);
    expect(decrypted).toEqual({ name: 'Production .env', content: secretCode });

    const built = buildPasteTarget('abc12345', {
      key: keyB64Url,
      lines: { start: 10, end: 25 },
      demoMode: false,
    });
    expect(built.routePath).toBe(`/abc12345#k=${encodeURIComponent(keyB64Url)}&L10-L25`);

    const parsed = parsePasteFragment(built.routePath.slice('/abc12345'.length));
    expect(parsed.key).toBe(keyB64Url);
    expect(parsed.lines).toEqual({ start: 10, end: 25 });
  });

  it('supports selectable TTL (1h fixed), /raw/:id plain text, and atomic burn-after-read self-destruction', async () => {
    const app = createApp();

    // 1. Create a 1-hour paste and verify /raw/:id + fixed ~1h expiry
    const t0 = Date.now();
    const res1h = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'echo hello', name: 'One hour', ttl: '1h' }),
    });
    expect(res1h.status).toBe(201);
    const { id: id1h } = (await res1h.json()) as { id: string };

    const rawRes = await app.request(`/raw/${id1h}`);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get('content-type')).toContain('text/plain');
    expect(await rawRes.text()).toBe('echo hello');

    const view1h = await (await app.request(`/api/paste/${id1h}?touch=1`)).json();
    const expDiffMs = new Date(view1h.expiresAt).getTime() - t0;
    // Must stay ~1h (<= 65 min), NOT extended to 30 days on view
    expect(expDiffMs).toBeGreaterThan(55 * 60_000);
    expect(expDiffMs).toBeLessThan(65 * 60_000);

    // 2. Burn-after-read paste: blocked from ?id= preload, returned once on ?touch=1, 404 thereafter
    const resBurn = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'one-time-secret', ttl: 'burn' }),
    });
    expect(resBurn.status).toBe(201);
    const { id: burnId, burnAfterRead } = (await resBurn.json()) as { id: string; burnAfterRead: boolean };
    expect(burnAfterRead).toBe(true);

    // Preload endpoint cannot peek without burning
    const preloadAttempt = await app.request(`/api/paste?id=${burnId}`);
    expect(preloadAttempt.status).toBe(403);

    // First real open succeeds and burns the paste atomically
    const firstOpen = await app.request(`/api/paste/${burnId}?touch=1`);
    expect(firstOpen.status).toBe(200);
    const firstBody = await firstOpen.json();
    expect(firstBody.content).toBe('one-time-secret');
    expect(firstBody.burned).toBe(true);

    // Second open immediately returns 404
    const secondOpen = await app.request(`/api/paste/${burnId}?touch=1`);
    expect(secondOpen.status).toBe(404);
  });

  it('toggles registrationMode between invite-only and open registration from admin settings', async () => {
    const app = createApp();

    // Default is invite-only -> public registration returns 403
    const initSettings = await (await app.request('/api/settings')).json();
    expect(initSettings.registrationMode).toBe('invite');

    const blockedReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'self@example.com', password: 'ValidPassword123!' }),
    });
    expect(blockedReg.status).toBe(403);

    // Admin enables open registration with defaultUserDeleteLimit = 4
    const adminSess = await createUserSession('admin@example.com', 'admin', 'Vitest');
    const adminCookie = `auth-token=${createSessionToken('admin@example.com', 'admin', adminSess.id)}`;

    const patchSettings = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ registrationMode: 'open', defaultUserDeleteLimit: 4 }),
    });
    expect(patchSettings.status).toBe(200);

    // Public self-registration logs standard users in directly WITHOUT forcing 2FA setup
    const openReg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'self@example.com', password: 'ValidPassword123!' }),
    });
    expect(openReg.status).toBe(201);
    const regBody = await openReg.json();
    expect(regBody.authenticated).toBe(true);
    expect(regBody.setupRequired).toBeUndefined();

    const setCookie = openReg.headers.get('set-cookie')!;
    const userCookie = setCookie.match(/auth-token=[^;]+/)![0];
    const whoami = await (await app.request('/api/auth', { headers: { Cookie: userCookie } })).json();
    expect(whoami.authenticated).toBe(true);
    expect(whoami.email).toBe('self@example.com');
    expect(whoami.role).toBe('user');
    expect(whoami.totpEnabled).toBe(false);
    expect(whoami.permanentDeleteLimit).toBe(4);

    // Password re-login for that user succeeds directly without TOTP challenge
    const relogin = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'self@example.com', password: 'ValidPassword123!' }),
    });
    expect(relogin.status).toBe(200);
    expect((await relogin.json()).authenticated).toBe(true);
  });
});
