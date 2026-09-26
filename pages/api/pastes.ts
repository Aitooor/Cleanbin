import { NextApiRequest, NextApiResponse } from 'next';
import { savePaste, getPastes, deletePaste, getAllPastes } from '../../utils/db';
import { getPage, invalidateCache, removePasteFromCache } from '../../utils/pastesCache';
import { postMessage } from '../../utils/broadcast';
import { getSessionFromRequest, requireSession } from '../../utils/auth';
import { getPermanentDeleteLimit } from '../../utils/users';
import {
  canEdit,
  normalizeEmail,
  resolveScope,
  selectVisible,
  toAccessFields,
  type PasteViewer,
} from '../../utils/pasteAccess';
import { isValidPasteId, MAX_PASTE_CONTENT_LENGTH } from '../../utils/validation';

// Cap the request body size for this route (content is validated again per-request).
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

function isPermanentPaste(paste: any): boolean {
  return String(paste?.permanent) === 'true' || paste?.permanent === true;
}

function byCreatedAtDesc(a: any, b: any): number {
  return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
}

// The main listing has no per-type filter; this exists so the bulk-delete
// preview can show the exact All / Permanent / Temporary sets it will remove.
function filterByType(items: any[], type?: string): any[] {
  if (type === 'permanent') return items.filter(isPermanentPaste);
  if (type === 'temporary' || type === 'temp') return items.filter((item) => !isPermanentPaste(item));
  return items;
}

// Server-side ordering so pagination stays coherent (a client-side sort would
// only reorder the current page). Defaults to newest first.
function sortForListing(items: any[], sort?: string, dir?: string): any[] {
  if (!sort || sort === 'createdAt') {
    const sorted = [...items].sort(byCreatedAtDesc);
    return dir === 'asc' ? sorted.reverse() : sorted;
  }
  const sorted = [...items].sort((a, b) => {
    if (sort === 'name') return String(a?.name || '').localeCompare(String(b?.name || ''));
    if (sort === 'permanent') return (isPermanentPaste(a) ? 1 : 0) - (isPermanentPaste(b) ? 1 : 0);
    return 0;
  });
  return dir === 'asc' ? sorted : sorted.reverse();
}

// Adds the ownership fields the dashboard needs while keeping the raw paste
// shape used by the editor/preview.
function withAccess(item: any, viewer: PasteViewer) {
  return { ...item, ...toAccessFields(item, viewer) };
}

function getFieldValue(item: any, field?: string): string {
  if (field === 'name') return item?.name || '';
  if (field === 'content') return item?.content || '';
  if (field === 'id') return item?.id || '';
  if (field === 'owner') return item?.owner || '';
  return `${item?.name || ''} ${item?.content || ''} ${item?.id || ''} ${item?.owner || ''}`;
}

function matchesRule(rule: any, item: any): boolean {
  const value = String(rule?.value ?? '').toLowerCase();
  const fieldValue = String(getFieldValue(item, rule?.field));
  const lowerFieldValue = fieldValue.toLowerCase();
  let matched = false;
  if (rule?.op === 'contains') matched = lowerFieldValue.includes(value);
  else if (rule?.op === 'exact') matched = lowerFieldValue === value;
  else if (rule?.op === 'starts') matched = lowerFieldValue.startsWith(value);
  else if (rule?.op === 'regex') {
    try {
      matched = new RegExp(rule.value, 'i').test(fieldValue);
    } catch (e) {
      matched = false;
    }
  }
  return rule?.negate ? !matched : matched;
}

function matchesRules(rules: any[], item: any, matchMode: string): boolean {
  const results = rules.map((rule) => matchesRule(rule, item));
  return matchMode.toUpperCase() === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function matchesSimpleFilter(item: any, query: string, field?: string): boolean {
  const q = query.toLowerCase();
  if (field === 'name') return (item?.name || '').toLowerCase().includes(q);
  if (field === 'content') return (item?.content || '').toLowerCase().includes(q);
  if (field === 'id') return (item?.id || '').toLowerCase().includes(q);
  if (field === 'owner') return (item?.owner || '').toLowerCase().includes(q);
  return [item?.name, item?.content, item?.id, item?.owner].some((value) => String(value || '').toLowerCase().includes(q));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      // The listing is private: without a session the API must not expose other
      // people's pastes (nor their content).
      if (!(await requireSession(req, res))) return;
      const viewer = getSessionFromRequest(req);
      const scope = resolveScope((req.query.scope as string) || undefined, viewer);
      const force = req.query.force === '1';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const idsOnly = req.query.ids_only === '1';
      const matchMode = (req.query.matchMode as string) || 'AND';
      const filter = (req.query.filter as string) || undefined;
      const filterField = (req.query.filterField as string) || undefined;
      const sort = (req.query.sort as string) || undefined;
      const dir = (req.query.dir as string) === 'asc' ? 'asc' : 'desc';
      const type = (req.query.type as string) || undefined;
      const filterRulesRaw = (req.query.filterRules as string) || undefined;
      let filterRules: any[] | undefined;
      if (filterRulesRaw) {
        try {
          filterRules = JSON.parse(filterRulesRaw);
        } catch (e) {
          filterRules = undefined;
        }
      }
      const hasRules = Array.isArray(filterRules) && filterRules.length > 0;
      // Any query parameter beyond the plain listing forces the permission-aware
      // scan path; the fast in-memory page cache is only valid for the
      // unfiltered admin "everything" listing.
      const hasQuery = !!filter?.trim() || hasRules || !!sort || (!!type && type !== 'all');
      // If client provided a token (Cassandra), bypass cached pages and use DB directly
      const token = (req.query.token as string) || undefined;
      if (token) {
        const result = await getPastes(page, limit, token);
        const visible = selectVisible(result.items, viewer, scope).map((item) => withAccess(item, viewer));
        res.setHeader('Cache-Control', `private, no-store`);
        return res.status(200).json({ total: result.total, page, limit, items: visible, nextPageToken: result.nextPageToken || null });
      }
      // The fast in-memory page cache only covers the unfiltered "everything"
      // listing an admin sees. Every other scope is permission-filtered, which
      // requires reading the rows to decide what the viewer may see.
      if (!hasQuery && scope === 'all' && viewer?.role === 'admin') {
        const result = await getPage(page, limit, force);
        // Prevent client-side caching so dashboard always fetches fresh data immediately.
        res.setHeader('Cache-Control', 'no-store');
        return res
          .status(200)
          .json({ total: result.total, page, limit, items: result.items.map((item) => withAccess(item, viewer)) });
      }

      // Unified permission-aware listing: scope, type, text/rules and sort are
      // all applied before pagination so the same request powers the table and
      // the bulk-delete preview.
      const MAX_SCAN = Number(process.env.PREVIEW_MAX_SCAN || 10000);
      const all = await getAllPastes();
      // Permission filtering happens before the scan cap so a user can never
      // page past somebody else's pastes.
      const scoped = selectVisible(all, viewer, scope);
      const scanned = scoped.slice(0, MAX_SCAN);
      let matched = filterByType(scanned, type);
      if (hasRules) {
        matched = matched.filter((item: any) => matchesRules(filterRules as any[], item, matchMode));
      } else if (filter && filter.trim()) {
        matched = matched.filter((item: any) => matchesSimpleFilter(item, filter, filterField));
      }
      matched = sortForListing(matched, sort, dir);
      const total = matched.length;
      const start = (page - 1) * limit;
      const pageItems = matched.slice(start, start + limit);
      // if idsOnly requested, map to minimal representation
      const items = idsOnly
        ? pageItems.map((p: any) => ({ id: p.id, name: p.name, permanent: p.permanent, owner: p.owner ?? null, mine: !!viewer && p.owner === normalizeEmail(viewer.email) }))
        : pageItems.map((item: any) => withAccess(item, viewer));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ total, page, limit, items, truncated: scoped.length > MAX_SCAN });
    } catch (error) {
      console.error('GET /api/pastes error:', error);
      res.status(500).json({ message: 'Failed to fetch pastes' });
    }
    return;
  }
  if (req.method === 'POST') {
    try {
      const { id, content, name } = req.body || {};

      if (typeof content === 'string' && content.length > MAX_PASTE_CONTENT_LENGTH) {
        return res.status(413).json({ message: 'Paste content is too large' });
      }

      const session = getSessionFromRequest(req);
      const isLoggedIn = !!session;
      if (isLoggedIn && !name) {
        return res.status(400).json({ message: 'Name is required for permanent pastes.' });
      }

      const owner = session ? normalizeEmail(session.email) : null;
      await savePaste(id, content, name, isLoggedIn, owner);
      // Invalidate cache immediately so dashboard sees new paste
      invalidateCache();
      res.status(201).json({ message: 'Paste created' });
    } catch (error) {
      console.error('POST /api/pastes error:', error);
      res.status(500).json({ message: 'Failed to create paste' });
    }
    return;
  }
  if (req.method === 'DELETE') {
    try {
      // Destructive operation: a valid session is always required.
      const session = await requireSession(req, res);
      if (!session) return;

      // Accept JSON body with { ids?: string[], type?, filter?, filterRules?, confirm?: boolean }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ids: unknown = body.ids;
      const filter: string | undefined = typeof body.filter === 'string' ? body.filter : undefined;
      const filterRules: any[] | undefined = Array.isArray(body.filterRules) ? body.filterRules : undefined;
      const matchMode = (body.matchMode || (req.query.matchMode as string) || 'AND').toString();
      const confirmRequested = body.confirm === true || body.confirm === 'true';
      // The delete must target the same visibility scope the preview showed, so
      // a filtered "delete" can never reach pastes outside the current view.
      const scope = resolveScope((body.scope as string) || (req.query.scope as string) || undefined, session);

      const hasIds = Array.isArray(ids) && ids.length > 0;
      const hasFilter =
        (typeof filter === 'string' && filter.trim().length > 0) ||
        (Array.isArray(filterRules) && filterRules.length > 0);

      let toDeleteIds: string[] = [];
      // Keep the loaded snapshot around so the non-admin limit check does not
      // re-read the whole database.
      let loadedPastes: any[] | null = null;

      if (hasIds) {
        // Delete exactly the provided ids.
        if (!(ids as unknown[]).every(isValidPasteId)) {
          return res.status(400).json({ error: 'One or more paste ids are invalid.' });
        }
        toDeleteIds = ids as string[];
      } else {
        // No explicit ids: require an explicit filter or an explicit confirmation.
        if (!hasFilter && !confirmRequested) {
          return res.status(400).json({
            error: 'Bulk deletion requires explicit confirmation (confirm: true) or a filter.',
          });
        }

        const all = await getAllPastes().catch(() => null);
        if (!all) {
          return res.status(500).json({ message: 'Failed to load pastes for deletion' });
        }
        loadedPastes = all;

        const type = (req.query.type as string) || body.type || 'all';
        // Scope first, then type, then the text/rules filter: identical order to
        // the GET listing, so preview and delete always agree.
        let base = selectVisible(all, session, scope);
        if (type === 'permanent') {
          base = base.filter(isPermanentPaste);
        } else if (type === 'temporary' || type === 'temp') {
          base = base.filter((paste: any) => !isPermanentPaste(paste));
        }

        if (filterRules && filterRules.length > 0) {
          toDeleteIds = base.filter((item: any) => matchesRules(filterRules, item, matchMode)).map((p: any) => p.id);
        } else if (filter && filter.trim()) {
          const field = (body.filterField as string) || (req.query.filterField as string);
          toDeleteIds = base.filter((item: any) => matchesSimpleFilter(item, filter, field)).map((p: any) => p.id);
        } else {
          toDeleteIds = base.map((p: any) => p.id);
        }
      }

      // Non-admins may only delete pastes they can access (owned or shared) and
      // may only remove a bounded number of permanent pastes per operation.
      // Temporary pastes do not count towards the limit.
      if (session.role !== 'admin') {
        let all = loadedPastes;
        if (!all) {
          all = await getAllPastes().catch(() => null);
        }
        if (!all) {
          return res.status(500).json({ message: 'Failed to load pastes for deletion' });
        }

        const allowedIds = new Set(
          all.filter((paste: any) => canEdit(paste, session)).map((paste: any) => paste.id)
        );
        toDeleteIds = toDeleteIds.filter((id) => allowedIds.has(id));

        const permanentIds = new Set(
          all.filter(isPermanentPaste).map((paste: any) => paste.id)
        );
        const permanentCount = toDeleteIds.filter((id) => permanentIds.has(id)).length;
        const limit = await getPermanentDeleteLimit(session.email);

        if (permanentCount > limit) {
          return res.status(403).json({
            error: `You can delete at most ${limit} permanent paste(s) per operation (requested ${permanentCount}).`,
          });
        }
      }

      // perform deletions
      const deleted: string[] = [];
      for (const id of toDeleteIds) {
        try {
          await deletePaste(id);
          deleted.push(id);
          try {
            removePasteFromCache(id);
          } catch (e) {}
        } catch (err) {
          // continue on error
        }
      }

      // ensure cache consistency
      try {
        invalidateCache();
      } catch (e) {}

      // broadcast bulk deletion
      try {
        postMessage({ type: 'pastes_bulk_deleted', ids: deleted });
      } catch (e) {}

      return res.status(200).json({ deleted: deleted.length, ids: deleted });
    } catch (err) {
      console.error('DELETE /api/pastes error:', err);
      return res.status(500).json({ message: 'Failed to delete pastes' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
