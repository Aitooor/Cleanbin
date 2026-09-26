import { NextApiRequest, NextApiResponse } from 'next';
import { savePaste, getPastes, deletePaste, getAllPastes } from '../../utils/db';
import { getPage, invalidateCache, removePasteFromCache } from '../../utils/pastesCache';
import { postMessage } from '../../utils/broadcast';
import { getSessionFromRequest, requireSession } from '../../utils/auth';
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

function getFieldValue(item: any, field?: string): string {
  if (field === 'name') return item?.name || '';
  if (field === 'content') return item?.content || '';
  if (field === 'id') return item?.id || '';
  return `${item?.name || ''} ${item?.content || ''} ${item?.id || ''}`;
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
  return [item?.name, item?.content, item?.id].some((value) => String(value || '').toLowerCase().includes(q));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const force = req.query.force === '1';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const preview = req.query.preview === '1' || !!req.query.filterRules || !!req.query.filter;
      const idsOnly = req.query.ids_only === '1';
      const matchMode = (req.query.matchMode as string) || 'AND';
      // If client provided a token (Cassandra), bypass cached pages and use DB directly
      const token = (req.query.token as string) || undefined;
      if (token) {
        const result = await getPastes(page, limit, token);
        res.setHeader('Cache-Control', `public, max-age=5`);
        return res.status(200).json({ total: result.total, page, limit, items: result.items, nextPageToken: result.nextPageToken || null });
      }
      // If preview/filtering requested, perform server-side filtering and pagination
      if (preview) {
        // Accept filterRules as JSON string in query or simple filter/filterField
        const filter = (req.query.filter as string) || undefined;
        const filterField = (req.query.filterField as string) || undefined;
        const filterRulesRaw = (req.query.filterRules as string) || undefined;
        let filterRules: any[] | undefined;
        if (filterRulesRaw) {
          try {
            filterRules = JSON.parse(filterRulesRaw);
          } catch (e) {
            filterRules = undefined;
          }
        }
        // Fetch all items (limited to MAX_SCAN to avoid huge memory usage)
        const MAX_SCAN = Number(process.env.PREVIEW_MAX_SCAN || 10000);
        const all = await getAllPastes();
        const scanned = all.slice(0, MAX_SCAN);

        let matchedItems = scanned;
        if (Array.isArray(filterRules) && filterRules.length > 0) {
          matchedItems = scanned.filter((item) => matchesRules(filterRules, item, matchMode));
        } else if (filter && filter.trim()) {
          matchedItems = scanned.filter((item) => matchesSimpleFilter(item, filter, filterField));
        }
        const totalMatched = matchedItems.length;
        const start = (page - 1) * limit;
        const pageItems = matchedItems.slice(start, start + limit);
        // if idsOnly requested, map to minimal representation
        const items = idsOnly ? pageItems.map((p: any) => ({ id: p.id, name: p.name, permanent: p.permanent })) : pageItems;
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ total: totalMatched, page, limit, items, truncated: all.length > MAX_SCAN });
      }

      const result = await getPage(page, limit, force);
      // Prevent client-side caching so dashboard always fetches fresh data immediately.
      // Server still uses in-memory cache for efficiency, but clients should not reuse older responses.
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ total: result.total, page, limit, items: result.items });
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

      const isLoggedIn = !!getSessionFromRequest(req);
      if (isLoggedIn && !name) {
        return res.status(400).json({ message: 'Name is required for permanent pastes.' });
      }

      await savePaste(id, content, name, isLoggedIn);
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
      const session = requireSession(req, res);
      if (!session) return;

      // Accept JSON body with { ids?: string[], type?, filter?, filterRules?, confirm?: boolean }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ids: unknown = body.ids;
      const filter: string | undefined = typeof body.filter === 'string' ? body.filter : undefined;
      const filterRules: any[] | undefined = Array.isArray(body.filterRules) ? body.filterRules : undefined;
      const matchMode = (body.matchMode || (req.query.matchMode as string) || 'AND').toString();
      const confirmRequested = body.confirm === true || body.confirm === 'true';

      const hasIds = Array.isArray(ids) && ids.length > 0;
      const hasFilter =
        (typeof filter === 'string' && filter.trim().length > 0) ||
        (Array.isArray(filterRules) && filterRules.length > 0);

      let toDeleteIds: string[] = [];

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

        const type = (req.query.type as string) || body.type || 'all';
        let base = all;
        if (type === 'permanent') {
          base = all.filter(isPermanentPaste);
        } else if (type === 'temporary' || type === 'temp') {
          base = all.filter((paste: any) => !isPermanentPaste(paste));
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
