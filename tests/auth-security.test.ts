import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { resetRateLimitsForTests } from '../src/server/middleware/rateLimit.js';
import { generateTotp } from '../src/server/services/totp.js';
import { createPaste } from '../src/server/services/pastes.js';
import { createUser } from '../src/server/services/users.js';
import { createUserSession } from '../src/server/services/sessions.js';
import { createSessionToken } from '../src/server/services/auth.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-auth-'));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE__SAVE_TYPE = 'SQLite';
  process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
  process.env.AUTH_SECRET = 'test-secret-for-cleanbin-auth-suite-32bytes';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'StrongAdminPassword!';
  process.env.COOKIE_SECURE = '0';
  process.env.RATE_LIMIT_AUTH_PER_5MIN = '20';
  process.env.RATE_LIMIT_2FA_PER_5MIN = '20';
  process.env.RATE_LIMIT_PASTE_PER_MIN = '5';
  resetRateLimitsForTests();
  await getDb();
});

afterEach(async () => {
  await resetDbForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe('Authentication, TOTP anti-replay, session revocation, and rate limits', () => {
  it('enforces mandatory TOTP setup, blocks TOTP replay, and blocks revoked cookies everywhere', async () => {
    const app = createApp();

    // Unauthenticated /dashboard redirects server-side with 302
    const dashGuard = await app.request('/dashboard');
    expect(dashGuard.status).toBe(302);
    expect(dashGuard.headers.get('location')).toBe('/login');

    // Step 1: First login with env admin requires TOTP setup
    const login1 = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'StrongAdminPassword!' }),
    });
    expect(login1.status).toBe(200);
    const body1 = await login1.json();
    expect(body1.setupRequired).toBe(true);

    // Step 2: Start TOTP setup and complete it
    const startRes = await app.request('/api/setup/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: body1.challenge }),
    });
    expect(startRes.status).toBe(200);
    const { secret } = (await startRes.json()) as { secret: string };

    const nowMs = Date.now();
    const firstCode = generateTotp(secret, nowMs);
    const completeRes = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: body1.challenge, code: firstCode }),
    });
    expect(completeRes.status).toBe(200);
    const sessionCookie = extractCookieValue(completeRes.headers.get('set-cookie'), 'auth-token');
    expect(sessionCookie).toBeTruthy();

    // Step 3: Re-login and attempt to replay the exact same TOTP time-step -> rejected!
    const login2 = await app.request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'StrongAdminPassword!' }),
    });
    const body2 = await login2.json();
    expect(body2.totpRequired).toBe(true);

    const replayAttempt = await app.request('/api/auth/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: body2.challenge, code: firstCode }),
    });
    expect(replayAttempt.status).toBe(401);

    // Next 30s step (+30s, still inside the +/-1 step clock-drift window) succeeds
    const nextStepCode = generateTotp(secret, nowMs + 30_000);
    const valid2fa = await app.request('/api/auth/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: body2.challenge, code: nextStepCode }),
    });
    expect(valid2fa.status).toBe(200);

    // Step 4: Revoke session -> old valid HMAC cookie is rejected immediately
    const signOutRes = await app.request('/api/sessions', {
      method: 'DELETE',
      headers: { Cookie: sessionCookie! },
    });
    expect(signOutRes.status).toBe(200);

    const checkRevokedAuth = await (
      await app.request('/api/auth', { headers: { Cookie: sessionCookie! } })
    ).json();
    expect(checkRevokedAuth.authenticated).toBe(false);

    const checkRevokedDash = await app.request('/dashboard/pastes', {
      headers: { Cookie: sessionCookie! },
    });
    expect(checkRevokedDash.status).toBe(302);
  });

  it('enforces per-user permanentDeleteLimit and rate-limits paste spam', async () => {
    const app = createApp();
    await createUser({
      email: 'limited@example.com',
      password: 'password1234',
      role: 'user',
      permanentDeleteLimit: 1,
    });

    await createPaste('perm-1', 'one', 'First Perm', true, 'limited@example.com');
    await createPaste('perm-2', 'two', 'Second Perm', true, 'limited@example.com');

    const sess = await createUserSession('limited@example.com', 'user', 'Vitest');
    const cookie = `auth-token=${createSessionToken('limited@example.com', 'user', sess.id)}`;

    // Deleting 2 permanent pastes when cap is 1 returns 403
    const overLimit = await app.request('/api/pastes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids: ['perm-1', 'perm-2'], confirm: true }),
    });
    expect(overLimit.status).toBe(403);

    // Deleting 1 permanent paste succeeds
    const withinLimit = await app.request('/api/pastes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids: ['perm-1'], confirm: true }),
    });
    expect(withinLimit.status).toBe(200);

    // Rate limit kicks in after RATE_LIMIT_PASTE_PER_MIN (5) requests
    for (let i = 0; i < 5; i += 1) {
      const r = await app.request('/api/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `paste ${i}` }),
      });
      expect(r.status).toBe(201);
    }
    const sixth = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'spam' }),
    });
    expect(sixth.status).toBe(429);
  });
});
