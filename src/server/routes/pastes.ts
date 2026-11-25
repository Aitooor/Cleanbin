import { Hono } from 'hono';
import { requireSession } from '../middleware/auth.js';
import { deletePaste, getAllPastes, getPasteMetadata } from '../services/pastes.js';
import { getCachedPage, invalidateCache, removePasteFromCache } from '../services/pastesCache.js';
import { getPermanentDeleteLimit } from '../services/users.js';
import {
  canEdit,
  resolveScope,
  selectVisible,
  toAccessFields,
  type PasteViewer,
} from '../services/pasteAccess.js';
import { activeEntriesFor } from '../services/presence.js';
import { compileSafeRegex, isValidPasteId, normalizeEmail } from '../../shared/validation.js';
import type { PasteFilterRule, PasteRecord } from '../../shared/types.js';

export const pastesRoutes = new Hono();

function byCreatedAtDesc(a: PasteRecord, b: PasteRecord): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function filterByType(items: PasteRecord[], type?: string): PasteRecord[] {
  if (type === 'permanent') return items.filter((item) => item.permanent);
  if (type === 'temporary' || type === 'temp') return items.filter((item) => !item.permanent);
  return items;
}

function sortForListing(items: PasteRecord[], sort?: string, dir?: string): PasteRecord[] {
  if (!sort || sort === 'createdAt') {
    const sorted = [...items].sort(byCreatedAtDesc);
    return dir === 'asc' ? sorted.reverse() : sorted;
  }
  const sorted = [...items].sort((a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (sort === 'permanent') return (a.permanent ? 1 : 0) - (b.permanent ? 1 : 0);
    return 0;
  });
  return dir === 'asc' ? sorted : sorted.reverse();
}

function withAccess(item: PasteRecord, viewer: PasteViewer) {
  return { ...item, ...toAccessFields(item, viewer) };
}

function getFieldValue(item: PasteRecord, field?: string): string {
  if (field === 'name') return item.name || '';
  if (field === 'content') return item.content || '';
  if (field === 'id') return item.id || '';
  if (field === 'owner') return item.owner || '';
  return `${item.name || ''} ${item.content || ''} ${item.id || ''} ${item.owner || ''}`;
}

function matchesRule(rule: PasteFilterRule, item: PasteRecord): boolean {
  const value = String(rule?.value ?? '').toLowerCase();
  const fieldValue = getFieldValue(item, rule?.field);
  const lowerFieldValue = fieldValue.toLowerCase();
  let matched = false;
  if (rule?.op === 'contains') matched = lowerFieldValue.includes(value);
  else if (rule?.op === 'exact') matched = lowerFieldValue === value;
  else if (rule?.op === 'starts') matched = lowerFieldValue.startsWith(value);
  else if (rule?.op === 'regex') {
    const rx = compileSafeRegex(String(rule.value ?? ''));
    matched = rx ? rx.test(fieldValue) : false;
  }
  return rule?.negate ? !matched : matched;
}

function matchesRules(rules: PasteFilterRule[], item: PasteRecord, matchMode: string): boolean {
  const results = rules.map((rule) => matchesRule(rule, item));
  return matchMode.toUpperCase() === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function matchesSimpleFilter(item: PasteRecord, query: string, field?: string): boolean {
  const q = query.toLowerCase();
  if (field === 'name') return (item.name || '').toLowerCase().includes(q);
  if (field === 'content') return (item.content || '').toLowerCase().includes(q);
  if (field === 'id') return (item.id || '').toLowerCase().includes(q);
  if (field === 'owner') return (item.owner || '').toLowerCase().includes(q);
  return [item.name, item.content, item.id, item.owner].some((v) => String(v || '').toLowerCase().includes(q));
}

pastesRoutes.get('/api/pastes', async (c) => {
  const viewer = await requireSession(c);
  if (viewer instanceof Response) return viewer;

  const scope = resolveScope(c.req.query('scope') || undefined, viewer);
  const force = c.req.query('force') === '1';
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(1000, Math.max(1, Number.parseInt(c.req.query('limit') || '50', 10) || 50));
  const idsOnly = c.req.query('ids_only') === '1';
  const matchMode = c.req.query('matchMode') || 'AND';
  const filter = c.req.query('filter') || undefined;
  const filterField = c.req.query('filterField') || undefined;
  const sort = c.req.query('sort') || undefined;
  const dir = c.req.query('dir') === 'asc' ? 'asc' : 'desc';
  const type = c.req.query('type') || undefined;
  const filterRulesRaw = c.req.query('filterRules') || undefined;

  let filterRules: PasteFilterRule[] | undefined;
  if (filterRulesRaw) {
    try {
      const parsed = JSON.parse(filterRulesRaw);
      if (Array.isArray(parsed)) filterRules = parsed;
    } catch {
      filterRules = undefined;
    }
  }

  const hasRules = Array.isArray(filterRules) && filterRules.length > 0;
  const hasQuery = !!filter?.trim() || hasRules || !!sort || (!!type && type !== 'all');

  c.header('Cache-Control', 'no-store');

  if (!hasQuery && scope === 'all' && viewer.role === 'admin' && !idsOnly) {
    const result = await getCachedPage(page, limit, force);
    return c.json({
      total: result.total,
      page,
      limit,
      items: result.items.map((item) => withAccess(item, viewer)),
    });
  }

  const maxScan = Number(process.env.PREVIEW_MAX_SCAN || 10_000);
  const all = await getAllPastes();
  const scoped = selectVisible(all, viewer, scope);
  const scanned = scoped.slice(0, maxScan);
  let matched = filterByType(scanned, type);

  if (hasRules && filterRules) {
    matched = matched.filter((item) => matchesRules(filterRules!, item, matchMode));
  } else if (filter && filter.trim()) {
    matched = matched.filter((item) => matchesSimpleFilter(item, filter, filterField));
  }

  matched = sortForListing(matched, sort, dir);
  const total = matched.length;
  const start = (page - 1) * limit;
  const pageItems = matched.slice(start, start + limit);

  const items = idsOnly
    ? pageItems.map((p) => ({
        id: p.id,
        name: p.name,
        permanent: p.permanent,
        owner: p.owner ?? null,
        mine: p.owner === normalizeEmail(viewer.email),
      }))
    : pageItems.map((item) => withAccess(item, viewer));

  return c.json({ total, page, limit, items, truncated: scoped.length > maxScan });
});

pastesRoutes.delete('/api/pastes', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = body.ids;
  const filter = typeof body.filter === 'string' ? body.filter : undefined;
  const filterRules = Array.isArray(body.filterRules) ? (body.filterRules as PasteFilterRule[]) : undefined;
  const matchMode = String(body.matchMode || c.req.query('matchMode') || 'AND');
  const confirmRequested = body.confirm === true || body.confirm === 'true';
  const scope = resolveScope((body.scope as string) || c.req.query('scope') || undefined, session);

  const hasIds = Array.isArray(ids) && ids.length > 0;
  const hasFilter =
    (typeof filter === 'string' && filter.trim().length > 0) ||
    (Array.isArray(filterRules) && filterRules.length > 0);

  let toDeleteIds: string[] = [];
  let loadedPastes: PasteRecord[] | null = null;

  if (hasIds) {
    if (!(ids as unknown[]).every(isValidPasteId)) {
      return c.json({ error: 'One or more paste ids are invalid.' }, 400);
    }
    toDeleteIds = ids as string[];
  } else {
    if (!hasFilter && !confirmRequested) {
      return c.json(
        { error: 'Bulk deletion requires explicit confirmation (confirm: true) or a filter.' },
        400
      );
    }

    const all = await getAllPastes();
    loadedPastes = all;
    const type = c.req.query('type') || (body.type as string) || 'all';
    let base = selectVisible(all, session, scope);
    base = filterByType(base, type);

    if (filterRules && filterRules.length > 0) {
      toDeleteIds = base.filter((item) => matchesRules(filterRules, item, matchMode)).map((p) => p.id);
    } else if (filter && filter.trim()) {
      const field = (body.filterField as string) || c.req.query('filterField') || undefined;
      toDeleteIds = base.filter((item) => matchesSimpleFilter(item, filter, field)).map((p) => p.id);
    } else {
      toDeleteIds = base.map((p) => p.id);
    }
  }

  if (session.role !== 'admin') {
    const all = loadedPastes ?? (await getAllPastes());
    const allowedIds = new Set(all.filter((paste) => canEdit(paste, session)).map((p) => p.id));
    toDeleteIds = toDeleteIds.filter((id) => allowedIds.has(id));

    const permanentIds = new Set(all.filter((p) => p.permanent).map((p) => p.id));
    const permanentCount = toDeleteIds.filter((id) => permanentIds.has(id)).length;
    const limit = await getPermanentDeleteLimit(session.email);

    if (permanentCount > limit) {
      return c.json(
        {
          error: `You can delete at most ${limit} permanent paste(s) per operation (requested ${permanentCount}).`,
        },
        403
      );
    }
  }

  const deleted: string[] = [];
  for (const id of toDeleteIds) {
    await deletePaste(id);
    deleted.push(id);
    removePasteFromCache(id);
  }
  invalidateCache();

  return c.json({ deleted: deleted.length, ids: deleted });
});

// Optimized batch presence: checks in-memory heartbeats FIRST, so idle tables
// execute zero SQL queries instead of decompressing 50 rows every 5 seconds.
pastesRoutes.get('/api/pastes/presence', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;

  const rawIds = (c.req.query('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100)
    .filter(isValidPasteId);

  const activeMap = activeEntriesFor(rawIds, session.email);
  const candidateIds = Object.keys(activeMap);
  if (candidateIds.length === 0) {
    return c.json({ editors: {} });
  }

  const editors: Record<string, string[]> = {};
  for (const id of candidateIds) {
    const meta = await getPasteMetadata(id);
    if (meta && canEdit(meta, session)) {
      editors[id] = activeMap[id];
    }
  }

  return c.json({ editors });
});
