import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderSVG } from 'uqr';
import { createApp } from '../src/server/app.js';
import {
  compressContentCompact,
  compressPayload,
  decompressRowContent,
  measureStoredBytes,
} from '../src/server/db/compression.js';
import { getDb, resetDbForTests } from '../src/server/db/index.js';
import { resetRateLimitsForTests } from '../src/server/middleware/rateLimit.js';
import { createSessionToken } from '../src/server/services/auth.js';
import { getPaste } from '../src/server/services/pastes.js';
import { createUserSession } from '../src/server/services/sessions.js';
import { createUser } from '../src/server/services/users.js';
import { renderSafeMarkdown } from '../src/client/utils/markdown.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanbin-v22-'));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE__SAVE_TYPE = 'SQLite';
  process.env.DATABASE__SQLITE_DB_PATH = path.join(tempDir, 'pastes.db');
  process.env.AUTH_SECRET = 'v22-feature-suite-secret-key-at-least-32-chars';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'StrongAdminPassword!';
  process.env.COOKIE_SECURE = '0';
  process.env.RATE_LIMIT_PASTE_PER_MIN = '100';
  process.env.RATE_LIMIT_AUTH_PER_5MIN = '100';
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  resetRateLimitsForTests();
  await getDb();
});

afterEach(async () => {
  await resetDbForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Cleanbin v2.2 — Ultra-Compact Storage, CLI /raw + API Tokens, Quotas & Safe Markdown', () => {
  it('compacts pastes to raw binary Brotli-11 without Base64/JSON overhead and maintains legacy compatibility', async () => {
    const app = createApp();
    const db = await getDb();

    // 1. Insert a legacy Base64 JSON paste row directly into SQLite
    const sampleCode = Array.from(
      { length: 80 },
      (_, i) => `export function computeMetric${i}(input: number): number { return input * ${i + 1}; }`
    ).join('\n');
    const legacyRecord = {
      id: 'legacy-row-1',
      name: 'Legacy Code',
      content: sampleCode,
      permanent: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      owner: 'admin@example.com',
      sharedWith: [],
      version: 3,
    };
    const legacyPayload = await compressPayload(JSON.stringify(legacyRecord));
    const legacyByteLen = Buffer.byteLength(legacyPayload, 'utf-8');

    await db.execute(
      `INSERT INTO pastes (id, name, payload, permanent, created_at, updated_at, expires_at, owner, shared_with, version)
       VALUES (?, ?, ?, 1, ?, ?, NULL, ?, '[]', 3)`,
      ['legacy-row-1', 'Legacy Code', legacyPayload, Date.now(), Date.now(), 'admin@example.com']
    );

    // Verify legacy row reads cleanly BEFORE compaction
    const readBefore = await getPaste('legacy-row-1');
    expect(readBefore?.content).toBe(sampleCode);
    expect(readBefore?.version).toBe(3);

    // 2. Also insert a tiny 4-byte paste via API -> must store raw binary (5 bytes) instead of 200+ byte JSON
    const tinyRes = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hola' }),
    });
    expect(tinyRes.status).toBe(201);
    const { id: tinyId } = (await tinyRes.json()) as { id: string };
    const tinyRow = await db.queryOne<{ payload: Buffer | string; stored_bytes: number }>(
      'SELECT payload, stored_bytes FROM pastes WHERE id = ?',
      [tinyId]
    );
    expect(measureStoredBytes(tinyRow?.payload)).toBe(5);
    expect(Number(tinyRow?.stored_bytes)).toBe(5);

    // 3. Run /api/settings/compact as admin -> legacy row is re-encoded to binary Brotli-11 + VACUUM
    const adminSess = await createUserSession('admin@example.com', 'admin', 'Vitest');
    const adminCookie = `auth-token=${createSessionToken('admin@example.com', 'admin', adminSess.id)}`;

    const compactRes = await app.request('/api/settings/compact', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(compactRes.status).toBe(200);
    const compactBody = (await compactRes.json()) as {
      storage: { pasteCount: number; rawBytes: number; storedBytes: number; dbFileBytes: number; savingsPercent: number };
    };
    expect(compactBody.storage.pasteCount).toBe(2);
    expect(compactBody.storage.savingsPercent).toBeGreaterThan(75);
    expect(compactBody.storage.dbFileBytes).toBeGreaterThan(0);

    const compactedRow = await db.queryOne<{ payload: Buffer | string; stored_bytes: number }>(
      'SELECT payload, stored_bytes FROM pastes WHERE id = ?',
      ['legacy-row-1']
    );
    const compactedLen = measureStoredBytes(compactedRow?.payload);
    // Binary Brotli-11 without Base64 or JSON wrapper is significantly smaller than legacy Base64 JSON
    expect(compactedLen).toBeLessThan(legacyByteLen * 0.8);

    const readAfter = await getPaste('legacy-row-1');
    expect(readAfter?.content).toBe(sampleCode);
    expect(readAfter?.name).toBe('Legacy Code');

    // 4. Verify deleting/burning a large paste immediately shrinks SQLite + WAL on disk via reclaimPages()
    const bigPayload = crypto.randomBytes(120_000).toString('base64');
    const bigRes = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: bigPayload, ttl: 'burn' }),
    });
    expect(bigRes.status).toBe(201);
    const { id: bigId } = (await bigRes.json()) as { id: string };
    const sizeWithBig = await db.fileSizeBytes!();
    expect(sizeWithBig).toBeGreaterThan(150_000);

    // Opening the burn-after-read paste deletes it and immediately reclaims disk pages + truncates WAL
    const burnRead = await app.request(`/raw/${bigId}`);
    expect(burnRead.status).toBe(200);
    const sizeAfterBurn = await db.fileSizeBytes!();
    expect(sizeAfterBurn).toBeLessThan(sizeWithBig - 100_000);
  });

  it('supports CLI terminal uploads (POST /raw, PUT /raw/:filename) and SHA-256 personal API tokens', async () => {
    const app = createApp();
    const db = await getDb();

    // 1. Anonymous CLI upload via POST /raw
    const anonCli = await app.request('http://localhost:3000/raw', {
      method: 'POST',
      headers: { 'X-TTL': '24h' },
      body: 'line 1\nline 2\n',
    });
    expect(anonCli.status).toBe(201);
    const anonUrl = (await anonCli.text()).trim();
    expect(anonUrl).toMatch(/^http:\/\/localhost:3000\/[a-f0-9-]+$/);
    const anonId = anonUrl.split('/').pop()!;

    const rawFetch = await app.request(`/raw/${anonId}`);
    expect(rawFetch.status).toBe(200);
    expect(await rawFetch.text()).toBe('line 1\nline 2\n');

    // 2. PUT /raw/deploy.sh sets paste name from URL filename
    const putCli = await app.request('http://localhost:3000/raw/deploy.sh', {
      method: 'PUT',
      body: '#!/usr/bin/env bash\necho ok\n',
    });
    expect(putCli.status).toBe(201);
    const putId = (await putCli.text()).trim().split('/').pop()!;
    const putJson = await (await app.request(`/api/paste/${putId}`)).json();
    expect(putJson.name).toBe('deploy.sh');

    // 3. Create a personal API token from browser session and upload a permanent paste via CLI
    await createUser({
      email: 'dev@example.com',
      password: 'SecurePassword123!',
      role: 'user',
      permanentDeleteLimit: 2,
    });
    const devSess = await createUserSession('dev@example.com', 'user', 'Vitest');
    const devCookie = `auth-token=${createSessionToken('dev@example.com', 'user', devSess.id)}`;

    const tokCreateRes = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: devCookie },
      body: JSON.stringify({ name: 'macbook-cli' }),
    });
    expect(tokCreateRes.status).toBe(201);
    const { token, item } = (await tokCreateRes.json()) as {
      token: string;
      item: { id: string; tokenPrefix: string };
    };
    expect(token.startsWith('cb_')).toBe(true);

    // Ensure plaintext token is NEVER stored in SQL
    const sqlTok = await db.queryOne<{ token_hash: string }>(
      'SELECT token_hash FROM api_tokens WHERE id = ?',
      [item.id]
    );
    expect(sqlTok?.token_hash).not.toBe(token);
    expect(sqlTok?.token_hash).toHaveLength(64);

    // Defense-in-depth: API token cannot mint more tokens or access admin settings
    const forbiddenMint = await app.request('/api/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'rogue' }),
    });
    expect(forbiddenMint.status).toBe(403);

    // CLI permanent paste creation with Bearer token succeeds
    const authedCli = await app.request('http://localhost:3000/raw', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-TTL': 'permanent',
        'X-Name': 'Prod Nginx Config',
      },
      body: 'server { listen 443 ssl; }',
    });
    expect(authedCli.status).toBe(201);
    const permId = (await authedCli.text()).trim().split('/').pop()!;

    const permView = await (
      await app.request(`/api/paste/${permId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(permView.permanent).toBe(true);
    expect(permView.owner).toBe('dev@example.com');
    expect(permView.canEdit).toBe(true);

    // Revoking token immediately blocks subsequent CLI requests
    const delTok = await app.request(`/api/tokens/${item.id}`, {
      method: 'DELETE',
      headers: { Cookie: devCookie },
    });
    expect(delTok.status).toBe(200);

    const revokedAttempt = await app.request('http://localhost:3000/raw', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: 'should fail',
    });
    expect(revokedAttempt.status).toBe(401);
  });

  it('enforces per-user paste count and compressed disk quotas while keeping admins unlimited', async () => {
    const app = createApp();

    const adminSess = await createUserSession('admin@example.com', 'admin', 'Vitest');
    const adminCookie = `auth-token=${createSessionToken('admin@example.com', 'admin', adminSess.id)}`;

    await createUser({
      email: 'hobby@example.com',
      password: 'SecurePassword123!',
      role: 'user',
      permanentDeleteLimit: 2,
    });
    const userSess = await createUserSession('hobby@example.com', 'user', 'Vitest');
    const userCookie = `auth-token=${createSessionToken('hobby@example.com', 'user', userSess.id)}`;

    // Admin sets maxPastesPerUser = 2
    const saveQuota = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ maxPastesPerUser: 2, maxStorageMbPerUser: 10 }),
    });
    expect(saveQuota.status).toBe(200);

    for (let i = 1; i <= 2; i += 1) {
      const ok = await app.request('/api/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: `Paste ${i}`, content: `hello ${i}` }),
      });
      expect(ok.status).toBe(201);
    }

    // 3rd paste by standard user is rejected (403)
    const overCount = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({ name: 'Paste 3', content: 'blocked' }),
    });
    expect(overCount.status).toBe(403);

    // Admin is never capped
    for (let i = 1; i <= 3; i += 1) {
      const adminOk = await app.request('/api/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: `Admin ${i}`, content: `admin ${i}` }),
      });
      expect(adminOk.status).toBe(201);
    }

    // Raise paste count cap, set tight disk cap (0.01 MB = ~10.4 KB) and send uncompressible pseudo-random payload
    await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ maxPastesPerUser: 50, maxStorageMbPerUser: 0.01 }),
    });

    const randomBlob = crypto.randomBytes(16_000).toString('base64');

    const overBytes = await app.request('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({ name: 'Too heavy', content: randomBlob }),
    });
    expect(overBytes.status).toBe(403);
  });

  it('sanitizes XSS vectors in Markdown preview and generates valid monochrome SVG QR codes', () => {
    const maliciousMd = [
      '# Safe Heading',
      '',
      '<script>window.__pwned = true;</script>',
      '',
      '<img src="https://evil.example/pixel.png" onerror="alert(1)" />',
      '',
      '<svg onload="alert(2)"><circle cx="10" cy="10" r="5" /></svg>',
      '',
      '[bad link](javascript:alert(3))',
      '[encoded bad](java&#x09;script:alert(4))',
      '[good link](https://cleanbin.xyz/docs)',
      '',
      '- [x] Task done',
      '- [ ] Task pending',
    ].join('\n');

    const safeHtml = renderSafeMarkdown(maliciousMd);
    expect(safeHtml).toContain('<h1>Safe Heading</h1>');
    expect(safeHtml).toContain('href="https://cleanbin.xyz/docs"');
    expect(safeHtml).toContain('rel="noopener noreferrer"');
    expect(safeHtml).toContain('<input type="checkbox" disabled="" checked="" />');
    expect(safeHtml).not.toContain('<script');
    expect(safeHtml).not.toContain('onerror');
    expect(safeHtml).not.toContain('onload');
    expect(safeHtml).not.toContain('<svg');
    expect(safeHtml).not.toContain('<img');
    expect(safeHtml).not.toContain('javascript:');

    const svg = renderSVG('otpauth://totp/Cleanbin:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Cleanbin', {
      whiteColor: '#e8e8e8',
      blackColor: '#141414',
      border: 2,
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#e8e8e8');
    expect(svg).toContain('#141414');
  });

  it('round-trips compact payloads across Uint8Array (node:sqlite) and PostgreSQL/MySQL string dialects', async () => {
    const text = 'export const answer = 42;\n'.repeat(20);
    const sqliteOut = await compressContentCompact(text, 'sqlite');
    expect(Buffer.isBuffer(sqliteOut.payload)).toBe(true);

    // Simulate node:sqlite returning Uint8Array instead of Buffer
    const asUint8 = new Uint8Array(sqliteOut.payload as Buffer);
    const decodedUint8 = await decompressRowContent(asUint8);
    expect(decodedUint8.isCompact).toBe(true);
    expect(decodedUint8.content).toBe(text);

    // Simulate PostgreSQL TEXT dialect
    const pgOut = await compressContentCompact(text, 'postgres');
    expect(typeof pgOut.payload).toBe('string');
    expect((pgOut.payload as string).startsWith('b11:')).toBe(true);
    const decodedPg = await decompressRowContent(pgOut.payload);
    expect(decodedPg.isCompact).toBe(true);
    expect(decodedPg.content).toBe(text);
  });
});
