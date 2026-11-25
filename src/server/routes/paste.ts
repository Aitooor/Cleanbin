import crypto from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConfig } from '../config.js';
import { getOptionalActiveSession, requireSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  createPaste,
  deletePaste,
  getPaste,
  getPasteMetadata,
  updatePaste,
} from '../services/pastes.js';
import {
  addPasteToCache,
  invalidateCache,
  removePasteFromCache,
  updatePasteInCache,
} from '../services/pastesCache.js';
import { canEdit, getOwner, getSharedWith, isAdmin, isOwner } from '../services/pasteAccess.js';
import { getUser } from '../services/users.js';
import { heartbeat } from '../services/presence.js';
import {
  isValidEmail,
  isValidPasteId,
  MAX_PASTE_CONTENT_LENGTH,
  MAX_PASTE_NAME_LENGTH,
  normalizeEmail,
} from '../../shared/validation.js';

export const pasteRoutes = new Hono();

const createLimiter = rateLimit({
  name: 'create-paste',
  windowMs: 60_000,
  limit: () => getConfig().rateLimit.pastePerMin,
});

const jsonBody1Mb = bodyLimit({
  maxSize: 1_100_000,
  onError: (c) => c.json({ message: 'Paste content is too large' }, 413),
});

pasteRoutes.post('/api/paste', createLimiter, jsonBody1Mb, async (c) => {
  const body = await c.req.json().catch(() => null);
  const { content, name, permanent: bodyPermanent } = (body ?? {}) as Record<string, unknown>;

  if (typeof content !== 'string' || !content) {
    return c.json({ message: 'Content is required' }, 400);
  }
  if (content.length > MAX_PASTE_CONTENT_LENGTH) {
    return c.json({ message: 'Paste content is too large' }, 413);
  }

  const session = await getOptionalActiveSession(c);
  const isLoggedIn = !!session;
  const permanent = isLoggedIn && bodyPermanent !== false && bodyPermanent !== 'false';
  const owner = session ? normalizeEmail(session.email) : null;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length > MAX_PASTE_NAME_LENGTH) {
    return c.json({ message: `Name cannot exceed ${MAX_PASTE_NAME_LENGTH} characters.` }, 400);
  }
  if (permanent && !trimmedName) {
    return c.json({ message: 'Name is required for permanent pastes.' }, 400);
  }

  const id = crypto.randomUUID();
  const created = await createPaste(id, content, trimmedName, permanent, owner);
  try {
    addPasteToCache(created);
  } catch {
    invalidateCache();
  }

  return c.json({ id }, 201);
});

pasteRoutes.get('/api/paste', async (c) => {
  const id = c.req.query('id');
  if (!isValidPasteId(id)) {
    return c.json({ message: 'Invalid ID' }, 400);
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

  const session = await getOptionalActiveSession(c);
  const editable = canEdit(paste, session);

  // Never leak private account emails (`owner` / `sharedWith`) to anonymous or
  // unprivileged viewers opening a public paste URL.
  return c.json({
    content: paste.content,
    name: paste.name ?? '',
    permanent: paste.permanent,
    expiresAt: paste.permanent ? null : paste.expiresAt ?? null,
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
