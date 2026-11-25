import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { resetRateLimitsForTests } from '../src/server/middleware/rateLimit.js';
import { createApiToken } from '../src/server/services/apiTokens.js';
import { createSessionToken } from '../src/server/services/auth.js';
import { createUserSession } from '../src/server/services/sessions.js';
import { generateTotp } from '../src/server/services/totp.js';
import { createUser } from '../src/server/services/users.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-v23-'));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE__SAVE_TYPE = 'SQLite';
  process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
  process.env.AUTH_SECRET = 'v23-feature-suite-secret-key-at-least-32-chars';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'StrongAdminPassword!';
  process.env.COOKIE_SECURE = '0';
  process.env.RATE_LIMIT_PASTE_PER_MIN = '100';
  process.env.RATE_LIMIT_AUTH_PER_5MIN = '100';
  resetRateLimitsForTests();
  await getDb();
});

afterEach(async () => {
  await resetDbForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Cleanbin v2.3 — Public/Private Visibility, Per-Visibility Quotas & Mutable Paste States', () => {
  it('enforces private paste isolation across JSON, preload, and /raw/:id while allowing owner, collaborator, and admin', async () => {
    const app = createApp();

    // Anonymous user cannot create a private paste
    const anonPrivate = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'secret', visibility: 'private' }),
    });
    expect(anonPrivate.status).toBe(401);

    await createUser({
      email: 'alice@example.com',
      password: 'AlicePassword123!',
      role: 'user',
      permanentDeleteLimit: 2,
    });
    await createUser({
      email: 'bob@example.com',
      password: 'BobPassword123!',
      role: 'user',
      permanentDeleteLimit: 2,
    });

    const aliceSess = await createUserSession('alice@example.com', 'user', 'Vitest');
    const aliceCookie = `auth-token=${createSessionToken('alice@example.com', 'user', aliceSess.id)}`;
    const bobSess = await createUserSession('bob@example.com', 'user', 'Vitest');
    const bobCookie = `auth-token=${createSessionToken('bob@example.com', 'user', bobSess.id)}`;
    const adminSess = await createUserSession('admin@example.com', 'admin', 'Vitest');
    const adminCookie = `auth-token=${createSessionToken('admin@example.com', 'admin', adminSess.id)}`;

    // Alice creates a private paste via CLI Bearer token
    const { token: aliceCli } = await createApiToken('alice@example.com', 'alice-cli');
    const cliPrivate = await app.request('http://localhost/raw', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceCli}`,
        'X-TTL': 'permanent',
        'X-Name': 'Alice Secret Notes',
        'X-Visibility': 'private',
      },
      body: 'private-secret-body',
    });
    expect(cliPrivate.status).toBe(201);
    const privId = (await cliPrivate.text()).trim().split('/').pop()!;

    // Anonymous + unrelated user (Bob) receive 404 on every endpoint (existence is hidden)
    expect((await app.request(`/api/paste/${privId}?touch=1`)).status).toBe(404);
    expect((await app.request(`/api/paste?id=${privId}`)).status).toBe(404);
    expect((await app.request(`/raw/${privId}`)).status).toBe(404);
    expect((await app.request(`/api/paste/${privId}`, { headers: { Cookie: bobCookie } })).status).toBe(404);
    expect((await app.request(`/raw/${privId}`, { headers: { Cookie: bobCookie } })).status).toBe(404);

    // Owner and Admin can read it
    const aliceRead = await app.request(`/api/paste/${privId}`, { headers: { Cookie: aliceCookie } });
    expect(aliceRead.status).toBe(200);
    const aliceJson = await aliceRead.json();
    expect(aliceJson.visibility).toBe('private');
    expect(aliceJson.canManageState).toBe(true);

    expect((await app.request(`/raw/${privId}`, { headers: { Cookie: adminCookie } })).status).toBe(200);

    // Alice shares with Bob -> Bob can now view & edit content, but CANNOT change state (`canManageState = false`)
    const shareRes = await app.request(`/api/paste/${privId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ email: 'bob@example.com', action: 'add' }),
    });
    expect(shareRes.status).toBe(200);

    const bobRead = await app.request(`/api/paste/${privId}`, { headers: { Cookie: bobCookie } });
    expect(bobRead.status).toBe(200);
    expect((await bobRead.json()).canManageState).toBe(false);
    expect((await app.request(`/raw/${privId}`, { headers: { Cookie: bobCookie } })).status).toBe(200);

    // Bob (collaborator, not owner) is forbidden from flipping visibility or TTL
    const bobFlip = await app.request(`/api/paste/${privId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: bobCookie },
      body: JSON.stringify({ visibility: 'public' }),
    });
    expect(bobFlip.status).toBe(403);
  });

  it('enforces independent maxPublicPastesPerUser and maxPrivatePastesPerUser quotas and allows state transitions', async () => {
    const app = createApp();

    const adminSess = await createUserSession('admin@example.com', 'admin', 'Vitest');
    const adminCookie = `auth-token=${createSessionToken('admin@example.com', 'admin', adminSess.id)}`;

    await createUser({
      email: 'carol@example.com',
      password: 'CarolPassword123!',
      role: 'user',
      permanentDeleteLimit: 2,
    });
    const carolSess = await createUserSession('carol@example.com', 'user', 'Vitest');
    const carolCookie = `auth-token=${createSessionToken('carol@example.com', 'user', carolSess.id)}`;

    // Configure quota: 1 public paste max, 1 private paste max, 10 total max
    const quotaRes = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        maxPastesPerUser: 10,
        maxPublicPastesPerUser: 1,
        maxPrivatePastesPerUser: 1,
      }),
    });
    expect(quotaRes.status).toBe(200);

    // Create 1 temporary public paste (untitled) -> succeeds
    const pub1 = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ content: 'public 1', ttl: '24h', visibility: 'public' }),
    });
    expect(pub1.status).toBe(201);
    const { id: pubId } = (await pub1.json()) as { id: string };

    // 2nd public paste hits maxPublicPastesPerUser = 1 (403)
    const pub2 = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ content: 'public 2', ttl: '24h', visibility: 'public' }),
    });
    expect(pub2.status).toBe(403);

    // Create 1 private paste -> succeeds because private quota has room
    const priv1 = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ name: 'Priv 1', content: 'private 1', ttl: 'permanent', visibility: 'private' }),
    });
    expect(priv1.status).toBe(201);
    const { id: privId } = (await priv1.json()) as { id: string };

    // Switching pubId -> private is blocked because Carol already has 1/1 private paste
    const blockedSwitch = await app.request(`/api/paste/${pubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ visibility: 'private' }),
    });
    expect(blockedSwitch.status).toBe(403);

    // Raise private limit to 2; verify Carol can mutate existing pastes cleanly:
    await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ maxPrivatePastesPerUser: 2 }),
    });

    // 1) Switching untitled temporary paste to permanent WITHOUT name -> 400
    const noNamePerm = await app.request(`/api/paste/${pubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ ttl: 'permanent' }),
    });
    expect(noNamePerm.status).toBe(400);

    // 2) Switching untitled 24h public paste -> Named Permanent Private paste in one PATCH -> 200
    const promotePatch = await app.request(`/api/paste/${pubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({
        name: 'Promoted Note',
        ttl: 'permanent',
        visibility: 'private',
      }),
    });
    expect(promotePatch.status).toBe(200);
    const promoted = (await promotePatch.json()).paste;
    expect(promoted.name).toBe('Promoted Note');
    expect(promoted.permanent).toBe(true);
    expect(promoted.visibility).toBe('private');
    expect(promoted.expiresAt).toBeNull();

    // Anonymous viewer now gets 404 after pubId flipped to private
    expect((await app.request(`/api/paste/${pubId}`)).status).toBe(404);

    // 3) Demote permanent private paste (privId) -> temporary 1h public paste -> now visible publicly with ~1h TTL!
    const t0 = Date.now();
    const demotePatch = await app.request(`/api/paste/${privId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({
        ttl: '1h',
        visibility: 'public',
      }),
    });
    expect(demotePatch.status).toBe(200);
    const demoted = (await demotePatch.json()).paste;
    expect(demoted.permanent).toBe(false);
    expect(demoted.visibility).toBe('public');
    const expMs = Date.parse(demoted.expiresAt) - t0;
    expect(expMs).toBeGreaterThan(55 * 60_000);
    expect(expMs).toBeLessThan(65 * 60_000);

    // Anonymous viewer can now access the newly-public paste
    expect((await app.request(`/raw/${privId}`)).status).toBe(200);

    // 4) Non-admin cannot reassign ownership; admin CAN reassign ownership
    const nonAdminOwner = await app.request(`/api/paste/${pubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: carolCookie },
      body: JSON.stringify({ owner: 'admin@example.com' }),
    });
    expect(nonAdminOwner.status).toBe(403);

    const adminOwner = await app.request(`/api/paste/${pubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ owner: 'admin@example.com' }),
    });
    expect(adminOwner.status).toBe(200);
    expect((await adminOwner.json()).paste.owner).toBe('admin@example.com');
  });

  it('keeps 2FA/passkeys optional for users while keeping 2FA strictly mandatory for admins', async () => {
    const app = createApp();

    // Invited standard user can set password and skip 2FA completely
    const invitedUser = await createUser({
      email: 'opt@example.com',
      role: 'user',
      permanentDeleteLimit: 2,
    });
    const startUserSetup = await (
      await app.request('/api/setup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitedUser.inviteToken, password: 'UserPassword123!' }),
      })
    ).json();
    expect(startUserSetup.totpOptional).toBe(true);

    const skipUserSetup = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitedUser.inviteToken, skipTotp: true }),
    });
    expect(skipUserSetup.status).toBe(200);
    const userCookie = skipUserSetup.headers.get('set-cookie')!.match(/auth-token=[^;]+/)![0];

    // Admin CANNOT skip 2FA during invite setup OR password login
    const invitedAdmin = await createUser({
      email: 'secadmin@example.com',
      role: 'admin',
      permanentDeleteLimit: 0,
    });
    const startAdminSetup = await (
      await app.request('/api/setup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitedAdmin.inviteToken, password: 'AdminPassword123!' }),
      })
    ).json();
    expect(startAdminSetup.totpOptional).toBe(false);

    const skipAdminAttempt = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitedAdmin.inviteToken, skipTotp: true }),
    });
    expect(skipAdminAttempt.status).toBe(403);

    // Active admin created directly with a password MUST configure 2FA on first login
    await createUser({
      email: 'directadmin@example.com',
      password: 'AdminPassword123!',
      role: 'admin',
      permanentDeleteLimit: 0,
    });
    const adminLogin = await (
      await app.request('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'directadmin@example.com', password: 'AdminPassword123!' }),
      })
    ).json();
    expect(adminLogin.setupRequired).toBe(true);

    // User logged in without 2FA can optionally enable and later disable 2FA from account settings
    const userAuth = await (await app.request('/api/auth', { headers: { Cookie: userCookie } })).json();
    expect(userAuth.totpEnabled).toBe(false);

    const optStart = await (
      await app.request('/api/auth/totp/start', { method: 'POST', headers: { Cookie: userCookie } })
    ).json();
    expect(optStart.otpauthUrl).toContain('otpauth://totp/');
    const optCode = generateTotp(optStart.secret);
    const optEnable = await app.request('/api/auth/totp/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({ code: optCode }),
    });
    expect(optEnable.status).toBe(200);
    expect((await (await app.request('/api/auth', { headers: { Cookie: userCookie } })).json()).totpEnabled).toBe(true);

    const optDisable = await app.request('/api/auth/totp', {
      method: 'DELETE',
      headers: { Cookie: userCookie },
    });
    expect(optDisable.status).toBe(200);

    // Admins CANNOT disable 2FA
    const delFailAdmin = await app.request('/api/auth/totp', {
      method: 'DELETE',
      headers: {
        Cookie: `auth-token=${createSessionToken('admin@example.com', 'admin', (await createUserSession('admin@example.com', 'admin', 'Vitest')).id)}`,
      },
    });
    expect(delFailAdmin.status).toBe(403);
  });
});
