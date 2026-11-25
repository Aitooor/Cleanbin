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
  getUserVisibilityCounts,
  updatePaste,
  updatePasteState,
  type PasteMetadata,
  type PasteStatePatch,
} from '../services/pastes.js';
import {
  addPasteToCache,
  invalidateCache,
  removePasteFromCache,
  updatePasteInCache,
} from '../services/pastesCache.js';
import {
  canEdit,
  canManageState,
  canView,
  getOwner,
  getSharedWith,
  isAdmin,
  isOwner,
} from '../services/pasteAccess.js';
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
import type { PasteTtlOption, PasteVisibility, SessionRole } from '../../shared/types.js';

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

function parseVisibility(raw: unknown): PasteVisibility | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value === 'private' || value === 'public' ? value : null;
}

// Counts + disk quota check applied before storing a NEW paste for a standard user.
async function checkQuotaBeforeCreate(
  ownerEmail: string | null,
  role: SessionRole | null,
  content: string,
  visibility: PasteVisibility
): Promise<string | null> {
  if (!ownerEmail || role === 'admin') return null;

  const [settings, usage, counts, db] = await Promise.all([
    getServerSettings(),
    getUserPasteUsage(ownerEmail),
    getUserVisibilityCounts(ownerEmail),
    getDb(),
  ]);

  if (settings.maxPastesPerUser > 0 && usage.pasteCount >= settings.maxPastesPerUser) {
    return `Paste limit reached (${settings.maxPastesPerUser} pastes max). Delete unused pastes first.`;
  }
  if (
    visibility === 'private' &&
    settings.maxPrivatePastesPerUser > 0 &&
    counts.privateCount >= settings.maxPrivatePastesPerUser
  ) {
    return `Private paste limit reached (${settings.maxPrivatePastesPerUser} max). Make one public or delete it first.`;
  }
  if (
    visibility === 'public' &&
    settings.maxPublicPastesPerUser > 0 &&
    counts.publicCount >= settings.maxPublicPastesPerUser
  ) {
    return `Public paste limit reached (${settings.maxPublicPastesPerUser} max). Make one private or delete it first.`;
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

// Switching an existing paste to another visibility bucket must respect that bucket's limit.
async function checkQuotaBeforeVisibilityChange(
  ownerEmail: string | null,
  next: PasteVisibility
): Promise<string | null> {
  if (!ownerEmail) return null;
  const account = await getAccountState(ownerEmail);
  if (!account || account.role === 'admin') return null;

  const [settings, counts] = await Promise.all([getServerSettings(), getUserVisibilityCounts(ownerEmail)]);
  if (next === 'private' && settings.maxPrivatePastesPerUser > 0 && counts.privateCount >= settings.maxPrivatePastesPerUser) {
    return `Private paste limit reached (${settings.maxPrivatePastesPerUser} max).`;
  }
  if (next === 'public' && settings.maxPublicPastesPerUser > 0 && counts.publicCount >= settings.maxPublicPastesPerUser) {
    return `Public paste limit reached (${settings.maxPublicPastesPerUser} max).`;
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

  const rawVisibility = (c.req.header('x-visibility') || c.req.query('visibility') || '').trim();
  const visibility = parseVisibility(rawVisibility) ?? 'public';
  if (rawVisibility && !parseVisibility(rawVisibility)) {
    return c.text('Invalid visibility (use public or private)\n', 400);
  }
  if (visibility === 'private' && !session) {
    return c.text('Authentication required for private pastes (Authorization: Bearer cb_...)\n', 401);
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

  const quotaError = await checkQuotaBeforeCreate(owner, session?.role ?? null, content, visibility);
  if (quotaError) {
    return c.text(`${quotaError}\n`, 403);
  }

  const id = crypto.randomUUID();
  const created = await createPaste(id, content, trimmedName, permanent, owner, {
    ttl: ttlOption,
    burnAfterRead,
    visibility,
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
    visibility: bodyVisibility,
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

  if (bodyVisibility !== undefined && !parseVisibility(bodyVisibility)) {
    return c.json({ message: 'visibility must be "public" or "private"' }, 400);
  }
  const visibility = parseVisibility(bodyVisibility) ?? 'public';
  if (visibility === 'private' && !session) {
    return c.json({ message: 'Sign in to create private pastes.' }, 401);
  }

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

  const quotaError = await checkQuotaBeforeCreate(owner, session?.role ?? null, content, visibility);
  if (quotaError) {
    return c.json({ message: quotaError, error: quotaError }, 403);
  }

  const id = crypto.randomUUID();
  const created = await createPaste(id, content, trimmedName, permanent, owner, {
    ttl: ttlOption,
    burnAfterRead,
    visibility,
  });
  try {
    addPasteToCache(created);
  } catch {
    invalidateCache();
  }

  return c.json({ id, burnAfterRead, visibility }, 201);
});

pasteRoutes.get('/api/paste', async (c) => {
  const id = c.req.query('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
  }
  const [meta, session] = await Promise.all([getPasteMetadata(id), getOptionalActiveSession(c)]);
  // Private pastes answer 404 to everyone without access so their existence never leaks.
  if (!meta || !canView(meta, session)) {
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

  // Visibility must be verified BEFORE touching: a touch can burn the paste.
  const [meta, session] = await Promise.all([getPasteMetadata(id), getOptionalActiveSession(c)]);
  if (!meta || !canView(meta, session)) {
    return c.text('Paste not found\n', 404);
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

  const [meta, session] = await Promise.all([getPasteMetadata(id), getOptionalActiveSession(c)]);
  if (!meta || !canView(meta, session)) {
    return c.json({ error: 'Paste not found', message: 'Paste not found' }, 404);
  }

  const touch = c.req.query('touch') === '1';
  const paste = await getPaste(id, { touch });
  if (!paste) {
    return c.json({ error: 'Paste not found', message: 'Paste not found' }, 404);
  }
  if (paste.burned) {
    removePasteFromCache(id);
  }

  const editable = !paste.burned && canEdit(paste, session);
  const manageable = !paste.burned && canManageState(paste, session);

  // Never leak private account emails (`owner` / `sharedWith`) to anonymous or
  // unprivileged viewers opening a public paste URL.
  return c.json({
    content: paste.content,
    name: paste.name ?? '',
    permanent: paste.permanent,
    visibility: paste.visibility ?? 'public',
    burnAfterRead: Boolean(paste.burnAfterRead),
    burned: Boolean(paste.burned),
    expiresAt: paste.permanent || paste.burned ? null : paste.expiresAt ?? null,
    owner: editable ? getOwner(paste) : null,
    sharedWith: editable ? getSharedWith(paste) : [],
    canEdit: editable,
    canManageState: manageable,
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

// Edits content/name (owner, collaborators, admin) AND/OR changes lifecycle state of an
// existing paste: visibility, expiration/permanent/burn mode and (admin) owner reassignment.
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
  const {
    name,
    content,
    version,
    visibility,
    ttl,
    owner: bodyOwner,
  } = (body ?? {}) as Record<string, unknown>;
  const patch: { name?: string; content?: string; expectedVersion?: number } = {};
  const statePatch: PasteStatePatch = {};

  if (name !== undefined) {
    if (typeof name !== 'string') {
      return c.json({ message: 'Invalid name' }, 400);
    }
    const trimmed = name.trim();
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

  if (visibility !== undefined) {
    const parsed = parseVisibility(visibility);
    if (!parsed) return c.json({ message: 'visibility must be "public" or "private"' }, 400);
    statePatch.visibility = parsed;
  }

  if (ttl !== undefined) {
    if (typeof ttl !== 'string' || !VALID_TTL_OPTIONS.has(ttl as PasteTtlOption)) {
      return c.json({ message: 'ttl must be 1h, 24h, 7d, 30d, burn, or permanent' }, 400);
    }
    statePatch.ttl = ttl as PasteTtlOption;
  }

  if (bodyOwner !== undefined) {
    if (!isAdmin(auth)) {
      return c.json({ message: 'Only an administrator can reassign ownership' }, 403);
    }
    if (bodyOwner === null || bodyOwner === '') {
      statePatch.owner = null;
    } else {
      if (!isValidEmail(bodyOwner)) return c.json({ message: 'A valid owner email is required' }, 400);
      const target = normalizeEmail(bodyOwner);
      if (!(await getUser(target))) return c.json({ message: 'No user account exists with that email' }, 404);
      statePatch.owner = target;
    }
  }

  const wantsState = Object.keys(statePatch).length > 0;
  if (wantsState && !canManageState(meta, auth)) {
    return c.json(
      { message: 'Only the owner or an administrator can change visibility, expiration, or ownership.' },
      403
    );
  }

  const effectiveName = (patch.name ?? meta.name ?? '').trim();
  const finalIsPermanent = statePatch.ttl ? statePatch.ttl === 'permanent' : meta.permanent;
  if (finalIsPermanent && !effectiveName) {
    return c.json({ message: 'Name is required for permanent pastes' }, 400);
  }

  if (statePatch.visibility && statePatch.visibility !== meta.visibility) {
    const targetOwner = statePatch.owner !== undefined ? statePatch.owner : meta.owner;
    const visibilityQuotaError = await checkQuotaBeforeVisibilityChange(targetOwner, statePatch.visibility);
    if (visibilityQuotaError) {
      return c.json({ message: visibilityQuotaError, error: visibilityQuotaError }, 403);
    }
  }

  if (patch.name === undefined && patch.content === undefined && !wantsState) {
    return c.json({ message: 'No changes provided' }, 400);
  }

  let updated = null as Awaited<ReturnType<typeof getPaste>>;

  if (patch.name !== undefined || patch.content !== undefined) {
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
    updated = result.paste;
  }

  if (wantsState) {
    const stateResult = await updatePasteState(id, statePatch);
    if (stateResult.status === 'not_found') {
      return c.json({ message: 'Paste not found' }, 404);
    }
    if (stateResult.status === 'invalid') {
      return c.json({ message: stateResult.message }, 400);
    }
    updated = updated ? { ...updated, ...stateResult.paste, content: updated.content, name: updated.name, version: updated.version } : stateResult.paste;
  }

  invalidateCache();

  const finalPaste = updated!;
  try {
    updatePasteInCache(id, finalPaste);
  } catch {
    invalidateCache();
  }

  return c.json({
    success: true,
    paste: {
      id,
      name: finalPaste.name ?? '',
      content: finalPaste.content,
      owner: getOwner(finalPaste),
      sharedWith: getSharedWith(finalPaste),
      permanent: finalPaste.permanent,
      visibility: finalPaste.visibility ?? 'public',
      burnAfterRead: Boolean(finalPaste.burnAfterRead),
      expiresAt: finalPaste.expiresAt ?? null,
      version: finalPaste.version,
      updatedAt: finalPaste.updatedAt ?? null,
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

  const heartbeatEditors = heartbeat(id, auth.email);
  return c.json({ self: normalizeEmail(auth.email), editors: heartbeatEditors });
});
