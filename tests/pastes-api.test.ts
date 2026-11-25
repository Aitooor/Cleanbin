import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { resetRateLimitsForTests } from '../src/server/middleware/rateLimit.js';
import { invalidateCache } from '../src/server/services/pastesCache.js';
import { clearPresence } from '../src/server/services/presence.js';
import { createSessionToken } from '../src/server/services/auth.js';
import { createUserSession } from '../src/server/services/sessions.js';
import { createUser } from '../src/server/services/users.js';
import { compileSafeRegex } from '../src/shared/validation.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-pastes-'));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE__SAVE_TYPE = 'SQLite';
  process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
  process.env.AUTH_SECRET = 'test-secret-for-cleanbin-hmac-signing-32bytes';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'admin-password-123';
  process.env.COOKIE_SECURE = '0';
  resetRateLimitsForTests();
  invalidateCache();
  clearPresence();
  await getDb();
});

afterEach(async () => {
  await resetDbForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function makeSessionCookie(email: string, role: 'admin' | 'user'): Promise<string> {
  const session = await createUserSession(email, role, 'VitestAgent/1.0');
  const token = createSessionToken(email, role, session.id);
  return `auth-token=${token}`;
}

describe('Pastes API, privacy, optimistic concurrency, and TTL behavior', () => {
  it('blocks legacy POST /api/pastes unauthenticated overwrite vulnerability', async () => {
    const app = createApp();
    const res = await app.request('/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'victim-id', content: 'pwned' }),
    });
    expect(res.status).toBe(404);
  });

  it('hides owner and sharedWith from anonymous viewers while exposing them to authorized editors', async () => {
    const app = createApp();
    await createUser({ email: 'alice@example.com', password: 'password123', role: 'user', permanentDeleteLimit: 2 });
    await createUser({ email: 'bob@example.com', password: 'password123', role: 'user', permanentDeleteLimit: 2 });

    const aliceCookie = await makeSessionCookie('alice@example.com', 'user');

    const createRes = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ name: 'Secret Plan', content: 'top secret', permanent: true }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const shareRes = await app.request(`/api/paste/${id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ email: 'bob@example.com', action: 'add' }),
    });
    expect(shareRes.status).toBe(200);

    // Anonymous viewer does NOT see Alice's or Bob's private email addresses
    const anonView = await app.request(`/api/paste/${id}`);
    expect(anonView.status).toBe(200);
    const anonBody = await anonView.json();
    expect(anonBody.content).toBe('top secret');
    expect(anonBody.owner).toBeNull();
    expect(anonBody.sharedWith).toEqual([]);
    expect(anonBody.canEdit).toBe(false);

    // Bob (collaborator) DOES see owner/sharedWith and can edit with optimistic concurrency
    const bobCookie = await makeSessionCookie('bob@example.com', 'user');
    const bobView = await app.request(`/api/paste/${id}`, {
      headers: { Cookie: bobCookie },
    });
    const bobBody = await bobView.json();
    expect(bobBody.owner).toBe('alice@example.com');
    expect(bobBody.sharedWith).toEqual(['bob@example.com']);
    expect(bobBody.canEdit).toBe(true);
    expect(bobBody.version).toBe(2);

    // Stale version triggers 409 Conflict
    const conflictRes = await app.request(`/api/paste/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ content: 'updated by bob', version: 1 }),
    });
    expect(conflictRes.status).toBe(409);

    // Matching version succeeds
    const okPatch = await app.request(`/api/paste/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ content: 'updated by bob', version: 2 }),
    });
    expect(okPatch.status).toBe(200);
    const patchedBody = await okPatch.json();
    expect(patchedBody.paste.version).toBe(3);
  });

  it('only refreshes temporary paste TTL when touch=1 is passed', async () => {
    const app = createApp();
    const adminCookie = await makeSessionCookie('admin@example.com', 'admin');

    const createRes = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'ephemeral text' }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const firstRead = await (await app.request(`/api/paste/${id}`)).json();
    const initialExpires = firstRead.expiresAt as string;
    expect(typeof initialExpires).toBe('string');

    await new Promise((r) => setTimeout(r, 25));

    // Presence polling and non-touch reads must NOT move expiresAt
    await app.request(`/api/pastes/presence?ids=${id}`, { headers: { Cookie: adminCookie } });
    await app.request(`/api/paste/${id}/presence`, { method: 'POST', headers: { Cookie: adminCookie } });
    const secondRead = await (await app.request(`/api/paste/${id}`)).json();
    expect(secondRead.expiresAt).toBe(initialExpires);

    // Public view visit (?touch=1) refreshes expiresAt forward
    const touchedRead = await (await app.request(`/api/paste/${id}?touch=1`)).json();
    expect(new Date(touchedRead.expiresAt).getTime()).toBeGreaterThan(
      new Date(initialExpires).getTime()
    );
  });

  it('rejects unsafe catastrophic backtracking regex patterns (ReDoS guard)', () => {
    expect(compileSafeRegex('^(a+)+$')).toBeNull();
    expect(compileSafeRegex('([a-zA-Z]+)*')).toBeNull();
    expect(compileSafeRegex('^import\\s+React')).not.toBeNull();
  });
});
