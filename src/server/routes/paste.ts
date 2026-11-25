import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { compressContentCompact } from '../db/compression.js';
import { getOptionalActiveSession, requireSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { resolveOrigin } from '../services/auth.js';
import {
  createPaste,
  deletePaste,
  getPaste,
  getPasteMetadata,
  getUserPasteUsage,
  updatePaste,
  type PasteMetadata,
} from '../services/pastes.js';
import {
  addPasteToCache,
  invalidateCache,
  removePasteFromCache,
  updatePasteInCache,
} from '../services/pastesCache.js';
import { canEdit, getOwner, getSharedWith, isAdmin, isOwner } from '../services/pasteAccess.js';
import { getServerSettings } from '../services/settings.js';
import { getAccountState, getUser } from '../services/users.js';
import { heartbeat } from '../services/presence.js';
import {
  isValidEmail,
  isValidPasteId,
  MAX_PASTE_CONTENT_LENGTH,
  MAX_PASTE_NAME_LENGTH,
  normalizeEmail,
} from '../../shared/validation.js';
import type { PasteTtlOption, SessionRole } from '../../shared/types.js';

export const pasteRoutes = new Hono();

const VALID_TTL_OPTIONS = new Set<PasteTtlOption>(['1h', '24h', '7d', '30d', 'burn', 'permanent']);

const createLimiter = rateLimit({
  name: 'create-paste',
  windowMs: 60_000,
  limit: () => getConfig().rateLimit.pastePerMin,
});

const jsonBody1Mb = bodyLimit({
  maxSize: 1_100_000,
  onError: (c) => c.json({ message: 'Paste content is too large' }, 413),
});

const rawBody1Mb = bodyLimit({
  maxSize: 1_100_000,
  onError: (c) => c.text('Paste content is too large\n', 413),
});

function hasExplicitBearerHeader(c: Context): boolean {
  const header = c.req.header('authorization');
  return Boolean(header && /^Bearer\s+/i.test(header));
}

async function checkQuotaBeforeCreate(
  ownerEmail: string | null,
  role: SessionRole | null,
  content: string
): Promise<string | null> {
  if (!ownerEmail || role === 'admin') return null;

  const [settings, usage, db] = await Promise.all([
    getServerSettings(),
    getUserPasteUsage(ownerEmail),
    getDb(),
  ]);

  if (settings.maxPastesPerUser > 0 && usage.pasteCount >= settings.maxPastesPerUser) {
    return `Paste limit reached (${settings.maxPastesPerUser} pastes max). Delete unused pastes first.`;
  }

  if (settings.maxStorageMbPerUser > 0) {
    const compact = await compressContentCompact(content, db.dialect);
    const maxBytes = Math.round(settings.maxStorageMbPerUser * 1024 * 1024);
    if (usage.storedBytes + compact.storedBytes > maxBytes) {
      return `Disk quota reached (${settings.maxStorageMbPerUser} MB max on disk).`;
    }
  }

  return null;
}

async function checkQuotaBeforeUpdate(meta: PasteMetadata, content: string): Promise<string | null> {
  if (!meta.owner) return null;
  const ownerState = await getAccountState(meta.owner);
  if (!ownerState || ownerState.role === 'admin') return null;

  const [settings, usage, db] = await Promise.all([
    getServerSettings(),
    getUserPasteUsage(meta.owner),
    getDb(),
  ]);

  if (settings.maxStorageMbPerUser > 0) {
    const compact = await compressContentCompact(content, db.dialect);
    const maxBytes = Math.round(settings.maxStorageMbPerUser * 1024 * 1024);
    const projected = Math.max(0, usage.storedBytes - meta.storedBytes) + compact.storedBytes;
    if (projected > maxBytes) {
      return `Disk quota reached (${settings.maxStorageMbPerUser} MB max on disk).`;
    }
  }

  return null;
}

async function handleCliRawUpload(c: Context): Promise<Response> {
  const session = await getOptionalActiveSession(c);
  if (hasExplicitBearerHeader(c) && !session) {
    return c.text('Invalid or revoked API token\n', 401);
  }

  const content = await c.req.text().catch(() => '');
  if (!content) {
    return c.text('Content is required\n', 400);
  }
  if (content.length > MAX_PASTE_CONTENT_LENGTH) {
    return c.text('Paste content is too large\n', 413);
  }

  const rawTtl = (c.req.header('x-ttl') || c.req.query('ttl') || '').trim().toLowerCase();
  if (rawTtl && !VALID_TTL_OPTIONS.has(rawTtl as PasteTtlOption)) {
    return c.text('Invalid TTL (use 1h, 24h, 7d, 30d, burn, or permanent)\n', 400);
  }
  const ttlOption = rawTtl ? (rawTtl as PasteTtlOption) : undefined;

  if (ttlOption === 'permanent' && !session) {
    return c.text('Authentication required for permanent pastes (Authorization: Bearer cb_...)\n', 401);
  }

  const permanent = Boolean(session && ttlOption === 'permanent');
  const burnAfterRead = !permanent && ttlOption === 'burn';
  const owner = session ? normalizeEmail(session.email) : null;

  const filenameParam = c.req.param('filename') ? decodeURIComponent(c.req.param('filename')!) : '';
  let trimmedName = (c.req.header('x-name') || c.req.query('name') || filenameParam || '').trim();
  if (permanent && !trimmedName) {
    trimmedName = `cli-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  }
  if (trimmedName.length > MAX_PASTE_NAME_LENGTH) {
    trimmedName = trimmedName.slice(0, MAX_PASTE_NAME_LENGTH);
  }

  const quotaError = await checkQuotaBeforeCreate(owner, session?.role ?? null, content);
  if (quotaError) {
    return c.text(`${quotaError}\n`, 403);
  }

  const id = crypto.randomUUID();
  const created = await createPaste(id, content, trimmedName, permanent, owner, {
    ttl: ttlOption,
    burnAfterRead,
  });
  try {
    addPasteToCache(created);
  } catch {
    invalidateCache();
  }

  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  return c.body(`${resolveOrigin(c)}/${id}\n`, 201);
}

pasteRoutes.post('/raw', createLimiter, rawBody1Mb, handleCliRawUpload);
pasteRoutes.put('/raw', createLimiter, rawBody1Mb, handleCliRawUpload);
pasteRoutes.put('/raw/:filename', createLimiter, rawBody1Mb, handleCliRawUpload);
pasteRoutes.post('/api/raw', createLimiter, rawBody1Mb, handleCliRawUpload);

pasteRoutes.post('/api/paste', createLimiter, jsonBody1Mb, async (c) => {
  const session = await getOptionalActiveSession(c);
  if (hasExplicitBearerHeader(c) && !session) {
    return c.json({ message: 'Invalid or revoked API token' }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const {
    content,
    name,
    permanent: bodyPermanent,
    ttl: bodyTtl,
    burnAfterRead: bodyBurn,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof content !== 'string' || !content) {
    return c.json({ message: 'Content is required' }, 400);
  }
  if (content.length > MAX_PASTE_CONTENT_LENGTH) {
    return c.json({ message: 'Paste content is too large' }, 413);
  }

  const ttlOption: PasteTtlOption | undefined =
    typeof bodyTtl === 'string' && VALID_TTL_OPTIONS.has(bodyTtl as PasteTtlOption)
      ? (bodyTtl as PasteTtlOption)
      : undefined;

  const isLoggedIn = !!session;
  const wantsPermanent =
    ttlOption === 'permanent' ||
    (ttlOption === undefined && bodyPermanent !== false && bodyPermanent !== 'false' && bodyBurn !== true);
  const permanent = isLoggedIn && wantsPermanent;
  const burnAfterRead = !permanent && (bodyBurn === true || ttlOption === 'burn');
  const owner = session ? normalizeEmail(session.email) : null;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length > MAX_PASTE_NAME_LENGTH) {
    return c.json({ message: `Name cannot exceed ${MAX_PASTE_NAME_LENGTH} characters.` }, 400);
  }
  if (permanent && !trimmedName) {
    return c.json({ message: 'Name is required for permanent pastes.' }, 400);
  }

  const quotaError = await checkQuotaBeforeCreate(owner, session?.role ?? null, content);
  if (quotaError) {
    return c.json({ message: quotaError, error: quotaError }, 403);
  }

  const id = crypto.randomUUID();
  const created = await createPaste(id, content, trimmedName, permanent, owner, {
    ttl: ttlOption,
    burnAfterRead,
  });
  try {
    addPasteToCache(created);
  } catch {
    invalidateCache();
  }

  return c.json({ id, burnAfterRead }, 201);
});

pasteRoutes.get('/api/paste', async (c) => {
  const id = c.req.query('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }
  const meta = await getPasteMetadata(id);
  if (!meta) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (meta.burnAfterRead) {
    return c.json({ message: 'One-time pastes cannot be preloaded without opening them' }, 403);
  }
  const paste = await getPaste(id, { touch: false });
  if (!paste) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  return c.json({
    id,
    content: paste.content,
    name: paste.name ?? '',
    permanent: paste.permanent,
  });
});

pasteRoutes.get('/raw/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.text('Invalid paste ID\n', 400);
  }
  const paste = await getPaste(id, { touch: true });
  if (!paste) {
    return c.text('Paste not found\n', 404);
  }
  if (paste.burned) {
    removePasteFromCache(id);
  }
  if (paste.content.startsWith('cb-e2ee:v1:')) {
    return c.text(
      'This paste is end-to-end encrypted in the browser (#k=...) and cannot be decrypted by the server.\n',
      400
    );
  }
  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(paste.content);
});

pasteRoutes.get('/api/paste/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }

  const touch = c.req.query('touch') === '1';
  const paste = await getPaste(id, { touch });
  if (!paste) {
    return c.json({ error: 'Paste not found', message: 'Paste not found' }, 404);
  }
  if (paste.burned) {
    removePasteFromCache(id);
  }

  const session = await getOptionalActiveSession(c);
  const editable = !paste.burned && canEdit(paste, session);

  // Never leak private account emails (`owner` / `sharedWith`) to anonymous or
  // unprivileged viewers opening a public paste URL.
  return c.json({
    content: paste.content,
    name: paste.name ?? '',
    permanent: paste.permanent,
    burnAfterRead: Boolean(paste.burnAfterRead),
    burned: Boolean(paste.burned),
    expiresAt: paste.permanent || paste.burned ? null : paste.expiresAt ?? null,
    owner: editable ? getOwner(paste) : null,
    sharedWith: editable ? getSharedWith(paste) : [],
    canEdit: editable,
    version: paste.version,
    updatedAt: paste.updatedAt ?? paste.createdAt ?? null,
  });
});

pasteRoutes.delete('/api/paste/:id', async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }

  const meta = await getPasteMetadata(id);
  if (!meta) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (!canEdit(meta, auth)) {
    return c.json({ error: 'You do not have access to this paste' }, 403);
  }

  await deletePaste(id);
  try {
    removePasteFromCache(id);
  } catch {
    invalidateCache();
  }
  return c.json({ success: true });
});

pasteRoutes.patch('/api/paste/:id', jsonBody1Mb, async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }

  const meta = await getPasteMetadata(id);
  if (!meta) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (!canEdit(meta, auth)) {
    return c.json({ error: 'You do not have access to this paste' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { name, content, version } = (body ?? {}) as Record<string, unknown>;
  const patch: { name?: string; content?: string; expectedVersion?: number } = {};

  if (name !== undefined) {
    if (typeof name !== 'string') {
      return c.json({ message: 'Invalid name' }, 400);
    }
    const trimmed = name.trim();
    if (meta.permanent && trimmed.length === 0) {
      return c.json({ message: 'Name is required for permanent pastes' }, 400);
    }
    if (trimmed.length > MAX_PASTE_NAME_LENGTH) {
      return c.json({ message: `Name cannot exceed ${MAX_PASTE_NAME_LENGTH} characters` }, 400);
    }
    patch.name = trimmed;
  }

  if (content !== undefined) {
    if (typeof content !== 'string' || content.length === 0) {
      return c.json({ message: 'Invalid content' }, 400);
    }
    if (content.length > MAX_PASTE_CONTENT_LENGTH) {
      return c.json({ message: 'Paste content is too large' }, 413);
    }
    const quotaError = await checkQuotaBeforeUpdate(meta, content);
    if (quotaError) {
      return c.json({ message: quotaError, error: quotaError }, 403);
    }
    patch.content = content;
  }

  if (version !== undefined) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      return c.json({ message: 'Invalid version' }, 400);
    }
    patch.expectedVersion = version;
  }

  if (patch.name === undefined && patch.content === undefined) {
    return c.json({ message: 'No changes provided' }, 400);
  }

  const result = await updatePaste(id, patch);
  if (result.status === 'not_found') {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (result.status === 'conflict') {
    return c.json(
      {
        error: 'This paste was changed by someone else while you were editing it.',
        paste: {
          id,
          name: result.paste.name ?? '',
          content: result.paste.content,
          version: result.paste.version,
          updatedAt: result.paste.updatedAt ?? null,
        },
      },
      409
    );
  }

  const updated = result.paste;
  try {
    updatePasteInCache(id, updated);
  } catch {
    invalidateCache();
  }

  return c.json({
    success: true,
    paste: {
      id,
      name: updated.name ?? '',
      content: updated.content,
      owner: getOwner(updated),
      sharedWith: getSharedWith(updated),
      version: updated.version,
      updatedAt: updated.updatedAt ?? null,
    },
  });
});

pasteRoutes.post('/api/paste/:id/share', async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }

  const meta = await getPasteMetadata(id);
  if (!meta) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (!isAdmin(auth) && !isOwner(meta, auth.email)) {
    return c.json({ error: 'Only the owner or an admin can manage access', message: 'Forbidden' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { email, action } = (body ?? {}) as Record<string, unknown>;
  if (!isValidEmail(email)) {
    return c.json({ message: 'A valid email is required' }, 400);
  }
  if (action !== 'add' && action !== 'remove') {
    return c.json({ message: 'Action must be "add" or "remove"' }, 400);
  }

  const target = normalizeEmail(email);
  if (action === 'add') {
    const user = await getUser(target);
    if (!user) {
      return c.json({ message: 'No user account exists with that email' }, 404);
    }
    const owner = getOwner(meta);
    if (owner !== null && owner === target) {
      return c.json({ message: 'The owner already has access' }, 400);
    }
  }

  const shared = new Set(getSharedWith(meta));
  if (action === 'add') shared.add(target);
  else shared.delete(target);

  const owner = getOwner(meta);
  if (owner !== null) shared.delete(owner);

  const result = await updatePaste(id, { sharedWith: [...shared] });
  if (result.status === 'not_found') {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (result.status === 'conflict') {
    return c.json({ error: 'The paste changed, please retry' }, 409);
  }

  updatePasteInCache(id, { sharedWith: getSharedWith(result.paste) });
  return c.json({
    sharedWith: getSharedWith(result.paste),
    owner: getOwner(result.paste),
  });
});

pasteRoutes.post('/api/paste/:id/presence', async (c) => {
  const auth = await requireSession(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }

  const meta = await getPasteMetadata(id);
  if (!meta) {
    return c.json({ message: 'Paste not found' }, 404);
  }
  if (!canEdit(meta, auth)) {
    return c.json({ error: 'You do not have access to this paste' }, 403);
  }

  const editors = heartbeat(id, auth.email);
  return c.json({ self: normalizeEmail(auth.email), editors });
});
